/**
 * Caption Extraction Service
 * Automatically extracts captions from Tobira's database and fetches caption files
 */

import axios from 'axios';
import { parseCaption, ParsedCaption } from '../utils/caption-parser';
import db from './database.service';
import { logger } from '../utils/monitoring';
import { normalizeLanguageCode } from '../utils/language';

export interface CaptionSource {
    eventId: string | number;
    uri: string;
    language: string;
}

export interface ExtractionResult {
    eventId: string | number;
    language: string;
    success: boolean;
    transcriptLength?: number;
    error?: string;
    source: 'opencast' | 'event_texts' | 'captions_array';
}

export class CaptionExtractorService {
    private db: typeof db;

    constructor(dbInstance: typeof db = db) {
        this.db = dbInstance;
    }

    /**
     * Get all events that have captions but no transcripts
     */
    async getEventsNeedingExtraction(): Promise<CaptionSource[]> {
        const query = `
            SELECT DISTINCT
                e.id as event_id,
                c.uri as uri,
                c.lang as language
            FROM all_events e
            CROSS JOIN LATERAL unnest(e.captions) AS c
            LEFT JOIN video_transcripts vt
                ON vt.event_id = e.id
                AND vt.language = c.lang
            WHERE
                array_length(e.captions, 1) > 0
                AND vt.id IS NULL
            ORDER BY e.id
            LIMIT 100
        `;

        try {
            const result = await this.db.query(query);
            return result.rows.map((row: any) => ({
                eventId: row.event_id,
                uri: row.uri,
                language: row.language || 'en'
            }));
        } catch (error) {
            logger.error('Failed to get events needing extraction:', error);
            return [];
        }
    }

    /**
     * Get captions from event_texts table (already parsed by Tobira)
     * Filters by language to get the correct caption text
     */
    async getFromEventTexts(eventId: string | number, language: string): Promise<string | null> {
        const query = `
            SELECT
                array_to_string(
                    array_agg(t.t ORDER BY t.span_start),
                    ' '
                ) as full_text
            FROM event_texts
            CROSS JOIN LATERAL unnest(texts) AS t
            WHERE event_id = $1 AND ty = 'caption' AND lang = $2
            GROUP BY event_id
        `;

        try {
            const result = await this.db.query(query, [eventId, language]);
            if (result.rows.length > 0 && result.rows[0].full_text) {
                return result.rows[0].full_text;
            }
            return null;
        } catch (error) {
            logger.error(`Failed to get event_texts for event ${eventId} in language ${language}:`, error);
            return null;
        }
    }

    /**
     * Fetch and parse caption file from URI
     */
    async fetchAndParseCaption(uri: string): Promise<ParsedCaption | null> {
        try {
            const response = await axios.get(uri, {
                timeout: 10000,
                responseType: 'text'
            });

            if (!response.data) {
                throw new Error('Empty response from caption URL');
            }

            const parsed = parseCaption(response.data);
            
            if (parsed.cues.length === 0) {
                throw new Error('No captions found in file');
            }

            return parsed;
        } catch (error) {
            logger.error(`Failed to fetch/parse caption from ${uri}:`, error);
            return null;
        }
    }

    /**
     * Extract caption for a single event
     * @param language - Required language code (e.g., "en-us", "de-de")
     */
    async extractForEvent(eventId: string | number, language: string): Promise<ExtractionResult> {
        const normalizedLang = normalizeLanguageCode(language);
        try {
            // Strategy 1: Check if already in event_texts (parsed by Tobira)
            const eventTextCaption = await this.getFromEventTexts(eventId, normalizedLang);
            
            if (eventTextCaption && eventTextCaption.length > 100) {
                // Save to video_transcripts
                await this.db.query(
                    `INSERT INTO video_transcripts (event_id, language, content, source)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (event_id, language)
                     DO UPDATE SET content = $3, source = $4, updated_at = NOW()`,
                    [eventId, normalizedLang, eventTextCaption, 'event_texts']
                );

                return {
                    eventId,
                    language: normalizedLang,
                    success: true,
                    transcriptLength: eventTextCaption.length,
                    source: 'event_texts'
                };
            }

            // Strategy 2: Fetch from captions array (filtered by language)
            const captionQuery = `
                SELECT c.uri as uri, c.lang as language
                FROM all_events e
                CROSS JOIN LATERAL unnest(e.captions) AS c
                WHERE e.id = $1 AND c.lang = $2
                LIMIT 1
            `;
            
            const captionResult = await this.db.query(captionQuery, [eventId, normalizedLang]);
            
            if (captionResult.rows.length > 0) {
                const uri = captionResult.rows[0].uri;
                const parsed = await this.fetchAndParseCaption(uri);
                
                if (parsed && parsed.fullText.length > 100) {
                    await this.db.query(
                        `INSERT INTO video_transcripts (event_id, language, content, source)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (event_id, language)
                         DO UPDATE SET content = $3, source = $4, updated_at = NOW()`,
                        [eventId, normalizedLang, parsed.fullText, 'captions_array']
                    );

                    return {
                        eventId,
                        language: normalizedLang,
                        success: true,
                        transcriptLength: parsed.fullText.length,
                        source: 'captions_array'
                    };
                }
            }

            return {
                eventId,
                language: normalizedLang,
                success: false,
                error: 'No captions found',
                source: 'captions_array'
            };

        } catch (error) {
            logger.error(`Failed to extract caption for event ${eventId}:`, error);
            return {
                eventId,
                language: normalizedLang,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                source: 'captions_array'
            };
        }
    }

    /**
     * Batch extract captions for multiple events
     */
    async extractBatch(limit: number = 10): Promise<ExtractionResult[]> {
        const events = await this.getEventsNeedingExtraction();
        const toProcess = events.slice(0, limit);
        
        logger.info(`Starting batch extraction for ${toProcess.length} events`);
        
        const results: ExtractionResult[] = [];
        
        for (const event of toProcess) {
            const result = await this.extractForEvent(event.eventId, event.language);
            results.push(result);
            
            // Small delay to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        const successful = results.filter(r => r.success).length;
        logger.info(`Batch extraction complete: ${successful}/${results.length} successful`);
        
        return results;
    }

    /**
     * Get extraction statistics
     */
    async getStats(): Promise<{
        totalEvents: number;
        eventsWithCaptions: number;
        eventsWithTranscripts: number;
        eventsNeedingExtraction: number;
    }> {
        const statsQuery = `
            SELECT 
                COUNT(DISTINCT e.id) as total_events,
                COUNT(DISTINCT CASE WHEN array_length(e.captions, 1) > 0 THEN e.id END) as events_with_captions,
                COUNT(DISTINCT vt.event_id) as events_with_transcripts
            FROM all_events e
            LEFT JOIN video_transcripts vt ON vt.event_id = e.id
        `;

        try {
            const result = await this.db.query(statsQuery);
            const row = result.rows[0];
            
            return {
                totalEvents: parseInt(row.total_events, 10),
                eventsWithCaptions: parseInt(row.events_with_captions, 10),
                eventsWithTranscripts: parseInt(row.events_with_transcripts, 10),
                eventsNeedingExtraction: parseInt(row.events_with_captions, 10) - parseInt(row.events_with_transcripts, 10)
            };
        } catch (error) {
            logger.error('Failed to get extraction stats:', error);
            return {
                totalEvents: 0,
                eventsWithCaptions: 0,
                eventsWithTranscripts: 0,
                eventsNeedingExtraction: 0
            };
        }
    }
}