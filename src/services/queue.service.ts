/**
 * Queue Service using BullMQ
 * Handles async processing of AI tasks (summaries, quizzes, caption extraction)
 * Redis is OPTIONAL - if not available, the service gracefully disables queue features
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config';
import db from './database.service';
import { openai } from './openai.service';
import cache from './cache.service';
import { CaptionExtractorService } from './caption-extractor.service';
import { logger } from '../utils/monitoring';

// Job data types
interface SummaryJobData {
  eventId: string;
  language: string;
  forceRegenerate?: boolean;
}

interface QuizJobData {
  eventId: string;
  language: string;
  forceRegenerate?: boolean;
}

interface CaptionExtractionJobData {
  eventId: number;
  language: string;
}

interface BatchCaptionExtractionJobData {
  limit: number;
}

// Track if queue system is available
let queueEnabled = false;
let connection: Redis | null = null;
let summaryQueue: Queue | null = null;
let quizQueue: Queue | null = null;
let captionQueue: Queue | null = null;
let summaryWorker: Worker | null = null;
let quizWorker: Worker | null = null;
let captionWorker: Worker | null = null;
let summaryEvents: QueueEvents | null = null;
let quizEvents: QueueEvents | null = null;
let captionEvents: QueueEvents | null = null;

/**
 * Check if queue system is available
 */
export function isQueueEnabled(): boolean {
  return queueEnabled;
}

/**
 * Initialize queue system (called by the app on startup)
 * Gracefully handles Redis connection failures
 */
export async function initializeQueues(): Promise<boolean> {
  try {
    // Attempt to create Redis connection with timeout
    connection = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: null,
      retryStrategy: (times) => {
        // Only retry a few times during initialization
        if (times > 3) {
          return null; // Stop retrying
        }
        return Math.min(times * 100, 1000);
      },
      connectTimeout: 2000, // 2 second timeout
      lazyConnect: true, // Don't connect immediately
    });

    // Test connection
    await connection.connect();
    await connection.ping();

    // Create queues
    summaryQueue = new Queue('ai-summaries', { connection });
    quizQueue = new Queue('ai-quizzes', { connection });
    captionQueue = new Queue('caption-extraction', { connection });

    // Queue events for monitoring
    summaryEvents = new QueueEvents('ai-summaries', { connection });
    quizEvents = new QueueEvents('ai-quizzes', { connection });
    captionEvents = new QueueEvents('caption-extraction', { connection });

    // Create workers
    summaryWorker = new Worker<SummaryJobData>(
      'ai-summaries',
      async (job: Job<SummaryJobData>) => {
        const { eventId, language, forceRegenerate } = job.data;
        
        logger.info(`Processing summary job for event ${eventId}`, { language });

        try {
          if (!forceRegenerate) {
            const existing = await db.getSummary(eventId, language);
            if (existing) {
              logger.info(`Summary already exists for event ${eventId}, skipping`);
              return { status: 'skipped', reason: 'already_exists' };
            }
          }

          const transcript = await db.getTranscript(eventId, language);
          if (!transcript) {
            throw new Error('No transcript found');
          }

          await job.updateProgress(30);
          const result = await openai.generateSummary(transcript);
          await job.updateProgress(70);

          await db.saveSummary(
            eventId,
            result.content,
            result.model,
            language,
            result.processingTime
          );

          const cacheKey = `summary:${eventId}:${language}`;
          await cache.set(cacheKey, result.content);
          await job.updateProgress(100);

          logger.info(`Summary generated successfully for event ${eventId}`);

          return {
            status: 'completed',
            eventId,
            language,
            processingTime: result.processingTime,
            model: result.model,
          };
        } catch (error: any) {
          logger.error(`Failed to generate summary for event ${eventId}:`, error);
          throw error;
        }
      },
      {
        connection,
        concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '2', 10),
        limiter: {
          max: 10,
          duration: 60000,
        },
      }
    );

    quizWorker = new Worker<QuizJobData>(
      'ai-quizzes',
      async (job: Job<QuizJobData>) => {
        const { eventId, language, forceRegenerate } = job.data;
        
        logger.info(`Processing quiz job for event ${eventId}`, { language });

        try {
          if (!forceRegenerate) {
            const existing = await db.query(
              'SELECT id FROM ai_quizzes WHERE event_id = $1 AND language = $2',
              [eventId, language]
            );
            if (existing.rows.length > 0) {
              logger.info(`Quiz already exists for event ${eventId}, skipping`);
              return { status: 'skipped', reason: 'already_exists' };
            }
          }

          const transcript = await db.getTranscript(eventId, language);
          if (!transcript) {
            throw new Error('No transcript found');
          }

          await job.updateProgress(30);
          const result = await openai.generateQuiz(transcript);
          await job.updateProgress(70);

          await db.query(
            `INSERT INTO ai_quizzes (event_id, language, quiz_data, model, processing_time_ms)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (event_id, language) 
             DO UPDATE SET 
               quiz_data = $3,
               model = $4,
               processing_time_ms = $5,
               updated_at = NOW()`,
            [eventId, language, JSON.stringify(result.quizData), result.model, result.processingTime]
          );

          const cacheKey = `quiz:${eventId}:${language}`;
          await cache.set(cacheKey, result.quizData);
          await job.updateProgress(100);

          logger.info(`Quiz generated successfully for event ${eventId}`);

          return {
            status: 'completed',
            eventId,
            language,
            processingTime: result.processingTime,
            model: result.model,
            questionCount: result.quizData.questions.length,
          };
        } catch (error: any) {
          logger.error(`Failed to generate quiz for event ${eventId}:`, error);
          throw error;
        }
      },
      {
        connection,
        concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '1', 10),
        limiter: {
          max: 5,
          duration: 60000,
        },
      }
    );

    captionWorker = new Worker<CaptionExtractionJobData | BatchCaptionExtractionJobData>(
      'caption-extraction',
      async (job: Job<CaptionExtractionJobData | BatchCaptionExtractionJobData>) => {
        logger.info(`Processing caption extraction job`, job.data);

        try {
          const extractor = new CaptionExtractorService(db);

          if ('limit' in job.data) {
            const results = await extractor.extractBatch(job.data.limit);
            const successful = results.filter(r => r.success).length;

            logger.info(`Batch extraction complete: ${successful}/${results.length} successful`);

            return {
              status: 'completed',
              type: 'batch',
              total: results.length,
              successful,
              results,
            };
          } else {
            const { eventId, language } = job.data;
            const result = await extractor.extractForEvent(eventId, language);

            if (result.success) {
              logger.info(`Caption extracted successfully for event ${eventId}`);
            } else {
              logger.warn(`Caption extraction failed for event ${eventId}: ${result.error}`);
            }

            return {
              status: result.success ? 'completed' : 'failed',
              type: 'single',
              ...result,
            };
          }
        } catch (error: any) {
          logger.error(`Caption extraction job failed:`, error);
          throw error;
        }
      },
      {
        connection,
        concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '3', 10),
      }
    );

    // Set up event listeners
    summaryEvents.on('completed', ({ jobId }) => {
      logger.info(`Summary job completed: ${jobId}`);
    });

    summaryEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error(`Summary job failed: ${jobId}`, { reason: failedReason });
    });

    quizEvents.on('completed', ({ jobId }) => {
      logger.info(`Quiz job completed: ${jobId}`);
    });

    quizEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error(`Quiz job failed: ${jobId}`, { reason: failedReason });
    });

    captionEvents.on('completed', ({ jobId }) => {
      logger.info(`Caption extraction job completed: ${jobId}`);
    });

    captionEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error(`Caption extraction job failed: ${jobId}`, { reason: failedReason });
    });

    queueEnabled = true;
    logger.info('Queue system initialized successfully');
    return true;
  } catch (error: any) {
    logger.warn('Queue system unavailable (Redis not connected). Queue features disabled.', { error: error.message });
    queueEnabled = false;
    
    // Clean up any partial connections
    if (connection) {
      try {
        await connection.quit();
      } catch (e) {
        // Ignore cleanup errors
      }
      connection = null;
    }
    
    return false;
  }
}

/**
 * Add a summary generation job to the queue
 */
export async function enqueueSummaryGeneration(
  eventId: string,
  language: string = 'en',
  forceRegenerate: boolean = false
): Promise<string> {
  if (!queueEnabled || !summaryQueue) {
    throw new Error('Queue system is not available. Redis is not connected.');
  }

  const job = await summaryQueue.add(
    'generate-summary',
    { eventId, language, forceRegenerate },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    }
  );

  return job.id!;
}

/**
 * Add a quiz generation job to the queue
 */
export async function enqueueQuizGeneration(
  eventId: string,
  language: string = 'en',
  forceRegenerate: boolean = false
): Promise<string> {
  if (!queueEnabled || !quizQueue) {
    throw new Error('Queue system is not available. Redis is not connected.');
  }

  const job = await quizQueue.add(
    'generate-quiz',
    { eventId, language, forceRegenerate },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    }
  );

  return job.id!;
}

/**
 * Add a caption extraction job to the queue
 */
export async function enqueueCaptionExtraction(
  eventId: number,
  language: string = 'en'
): Promise<string> {
  if (!queueEnabled || !captionQueue) {
    throw new Error('Queue system is not available. Redis is not connected.');
  }

  const job = await captionQueue.add(
    'extract-caption',
    { eventId, language },
    {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 5000,
      },
      removeOnComplete: 50,
      removeOnFail: 100,
    }
  );

  return job.id!;
}

/**
 * Add a batch caption extraction job
 */
export async function enqueueBatchCaptionExtraction(limit: number = 10): Promise<string> {
  if (!queueEnabled || !captionQueue) {
    throw new Error('Queue system is not available. Redis is not connected.');
  }

  const job = await captionQueue.add(
    'extract-batch',
    { limit },
    {
      attempts: 1,
      removeOnComplete: 20,
    }
  );

  return job.id!;
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  if (!queueEnabled || !summaryQueue || !quizQueue || !captionQueue) {
    return {
      enabled: false,
      message: 'Queue system is not available. Redis is not connected.',
    };
  }

  const [summaryWaiting, summaryActive, summaryCompleted, summaryFailed] = await Promise.all([
    summaryQueue.getWaitingCount(),
    summaryQueue.getActiveCount(),
    summaryQueue.getCompletedCount(),
    summaryQueue.getFailedCount(),
  ]);

  const [quizWaiting, quizActive, quizCompleted, quizFailed] = await Promise.all([
    quizQueue.getWaitingCount(),
    quizQueue.getActiveCount(),
    quizQueue.getCompletedCount(),
    quizQueue.getFailedCount(),
  ]);

  const [captionWaiting, captionActive, captionCompleted, captionFailed] = await Promise.all([
    captionQueue.getWaitingCount(),
    captionQueue.getActiveCount(),
    captionQueue.getCompletedCount(),
    captionQueue.getFailedCount(),
  ]);

  return {
    enabled: true,
    summaries: {
      waiting: summaryWaiting,
      active: summaryActive,
      completed: summaryCompleted,
      failed: summaryFailed,
    },
    quizzes: {
      waiting: quizWaiting,
      active: quizActive,
      completed: quizCompleted,
      failed: quizFailed,
    },
    captions: {
      waiting: captionWaiting,
      active: captionActive,
      completed: captionCompleted,
      failed: captionFailed,
    },
  };
}

/**
 * Graceful shutdown
 *
 * Order matters: BullMQ Queues/Workers/QueueEvents share the `connection`
 * passed in initializeQueues() and internally duplicate it for blocking
 * commands. If `connection.quit()` resolves before workers finish draining,
 * those duplicated subscribers fire commands at a closed parent and ioredis
 * emits an unhandled error. See issue #3.
 */
export async function closeQueues() {
  if (!queueEnabled) {
    return;
  }

  logger.info('Closing queues and workers...');

  // 1. Stop workers first — drains in-flight jobs and stops polling for new ones.
  await Promise.all(
    [summaryWorker, quizWorker, captionWorker]
      .filter((w): w is Worker => w !== null)
      .map((w) => w.close())
  );

  // 2. Close queues and event subscribers (each holds its own duplicated client).
  await Promise.all(
    [
      summaryQueue,
      quizQueue,
      captionQueue,
      summaryEvents,
      quizEvents,
      captionEvents,
    ]
      .filter((q): q is Queue | QueueEvents => q !== null)
      .map((q) => q.close())
  );

  // 3. Tear down the shared connection last. Fall back to disconnect() if
  //    quit() rejects (e.g. server already gone) so shutdown still completes.
  if (connection) {
    try {
      await connection.quit();
    } catch {
      connection.disconnect();
    }
  }

  logger.info('Queues closed successfully');
}