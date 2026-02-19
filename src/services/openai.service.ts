import OpenAI from 'openai';
import { config } from '../config';

/**
 * Prompts optimized for educational video content
 */
const SUMMARY_PROMPT = `You are an educational content summarizer specialized in processing video lectures and educational materials.

Your task is to generate a concise and informative summary of the provided video transcript.

IMPORTANT: The summary MUST be written in the SAME LANGUAGE as the transcript. If the transcript is in German, answer in German. If it is in English, answer in English, and so on.

Requirements:
- Length: 200-400 words.
- Structure: Start with a brief overview, followed by 3-5 key points, and end with a brief conclusion.
- Tone: Maintain an educational, clear, and engaging tone.
- Focus: Highlight main concepts, important insights, and actionable takeaways.
- Format: Use clear, distinct paragraphs. Bullet points may be used only when directly listing items.
- Language: Ensure the summary matches the transcript language exactly.

Output Verbosity:
- Respond with 3–5 concise paragraphs totaling 200–400 words.
- Bullet lists, if needed, should not exceed 5 items with 1 line each.
- Prioritize complete, actionable answers within the length limits specified above.

Transcript:
{transcript}

Summary:`;

const QUIZ_PROMPT = `Developer: You are an educational quiz generator. Your task is to create an interactive quiz based on the supplied video transcript.

Core Requirement: All quiz content—questions, answer options, explanations—must be in the same language as the transcript. Detect the transcript language automatically and generate the entire quiz in that language. For example, if the transcript is in German, the quiz must be entirely in German; if in English, the quiz must be entirely in English.

Quiz Generation Requirements:
- Create 8–10 questions in total per quiz.
- Maintain a mix of question types: approximately 60% multiple choice and 40% true/false.
- Distribute difficulty as follows: 30% easy, 50% medium, 20% hard.
- Each question must include:
    - Question text
    - For multiple choice: an array of options
    - The correct answer (integer index for multiple choice, boolean for true/false)
    - A brief explanation
    - An approximate timestamp (in seconds) indicating when the question's topic first appears in the video
    - A difficulty rating ("easy", "medium", or "hard")
- Prioritize questions that assess genuine understanding over rote memorization.
- Ensure the quiz language exactly matches the transcript language.

Input: The transcript content will be provided in the variable {transcript}. Analyze {transcript} to detect its language and sufficient detail for quiz generation.

If the transcript is missing, empty, or lacks enough information to produce at least eight distinct questions, respond with a JSON object that includes only an "error" field explaining the issue (e.g., "Insufficient transcript content for quiz generation."). Do not return a partial or incomplete quiz.

Output Specification:
- Output only valid JSON strictly conforming to the following structure (do not use markdown or code blocks):

If a valid quiz can be generated:
{
  "questions": [
    {
      "id": "q1",
      "type": "multiple_choice",
      "question": "...",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": 0,
      "explanation": "...",
      "timestamp": 120,
      "difficulty": "easy"
    },
    {
      "id": "q2",
      "type": "true_false",
      "question": "...",
      "correct_answer": true,
      "explanation": "...",
      "timestamp": 350,
      "difficulty": "medium"
    }
  ]
}

If there is an error:
{
  "error": "Error message here."
}

Output Verbosity: Output only valid JSON, no commentary or markdown. Keep explanations per question concise (2 sentences max). For partial or error responses, keep to 1 short sentence. Prioritize complete, actionable answers within these caps; do not omit required detail even if user input is minimal.

Transcript:
{transcript}`;

interface GenerationResult {
  content: string;
  model: string;
  processingTime: number;
  tokensUsed?: number;
}

interface QuizData {
  questions: Array<{
    id: string;
    type: string;
    question: string;
    options?: string[];
    correct_answer: number | boolean;
    explanation: string;
    timestamp: number;
    difficulty: string;
  }>;
}

class OpenAIService {
  private client: OpenAI;
  private defaultModel: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
      timeout: config.performance.requestTimeoutMs,
    });
    this.defaultModel = config.openai.defaultModel;
  }

  /**
   * Check if model uses the new responses API (GPT-5.1)
   */
  private isResponsesApiModel(model: string): boolean {
    return model.startsWith('gpt-5');
  }

  /**
   * Generate AI summary of video transcript
   */
  async generateSummary(transcript: string, model?: string): Promise<GenerationResult> {
    const startTime = Date.now();
    const useModel = model || this.defaultModel;

    // Validate transcript length
    if (transcript.length === 0) {
      throw new Error('Transcript is empty');
    }

    if (transcript.length > config.openai.maxTranscriptLength) {
      throw new Error(`Transcript too long (max ${config.openai.maxTranscriptLength.toLocaleString()} characters)`);
    }

    const prompt = SUMMARY_PROMPT.replace('{transcript}', transcript);

    try {
      let summary: string;
      let tokensUsed: number | undefined;

      // Use new responses API for GPT-5.x models
      if (this.isResponsesApiModel(useModel)) {
        const result = await this.client.responses.create({
          model: useModel,
          input: prompt,
          reasoning: { effort: 'medium' },
        });

        summary = result.output_text?.trim() || '';
        tokensUsed = undefined; // responses API does not expose token usage directly
      } else {
        // Fallback to chat completions API for older models
        const response = await this.client.chat.completions.create({
          model: useModel,
          messages: [
            {
              role: 'system',
              content: 'You are an expert educational content summarizer.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 1,
          max_completion_tokens: 600,
        });

        summary = response.choices[0].message.content?.trim() || '';
        tokensUsed = response.usage?.total_tokens;
      }

      const processingTime = Date.now() - startTime;

      return {
        content: summary,
        model: useModel,
        processingTime,
        tokensUsed,
      };
    } catch (error: any) {
      console.error('OpenAI API error:', error);
      throw new Error(`Failed to generate summary: ${error.message}`);
    }
  }

  /**
   * Generate interactive quiz from transcript
   */
  async generateQuiz(transcript: string, model?: string): Promise<{
    quizData: QuizData;
    model: string;
    processingTime: number;
  }> {
    const startTime = Date.now();
    const useModel = model || this.defaultModel;

    if (transcript.length === 0) {
      throw new Error('Transcript is empty');
    }

    const prompt = QUIZ_PROMPT.replace('{transcript}', transcript);

    try {
      let content: string;

      // Use new responses API for GPT-5.x models
      if (this.isResponsesApiModel(useModel)) {
        const result = await this.client.responses.create({
          model: useModel,
          input: prompt,
          reasoning: { effort: 'medium' },
        });

        content = result.output_text?.trim() || '{}';
      } else {
        // Fallback to chat completions API for older models
        const response = await this.client.chat.completions.create({
          model: useModel,
          messages: [
            {
              role: 'system',
              content: 'You are an expert educational quiz generator. Return only valid JSON.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 1,
          max_completion_tokens: 2500,
        });

        content = response.choices[0].message.content?.trim() || '{}';
      }
      
      // Clean up potential markdown code blocks
      const jsonContent = content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const quizData = JSON.parse(jsonContent) as QuizData;
      const processingTime = Date.now() - startTime;

      // Validate quiz structure
      if (!quizData.questions || !Array.isArray(quizData.questions)) {
        throw new Error('Invalid quiz format: missing questions array');
      }

      if (quizData.questions.length < 5) {
        throw new Error('Quiz must have at least 5 questions');
      }

      return {
        quizData,
        model: useModel,
        processingTime,
      };
    } catch (error: any) {
      console.error('OpenAI quiz generation error:', error);
      throw new Error(`Failed to generate quiz: ${error.message}`);
    }
  }

  /**
   * Check if API key is valid by making a test request
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.models.list();
      console.log('OpenAI API connection successful');
      return true;
    } catch (error: any) {
      console.error('OpenAI API connection failed:', error.message);
      return false;
    }
  }

  /**
   * Get available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map(model => model.id);
    } catch (error) {
      console.error('Failed to list models:', error);
      return [];
    }
  }
}

// Export singleton instance
export const openai = new OpenAIService();
export default openai;