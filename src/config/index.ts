import dotenv from 'dotenv';

dotenv.config();

interface Config {
  openai: {
    apiKey: string;
    defaultModel: string;
    maxTranscriptLength: number;
  };
  database: {
    url: string;
  };
  server: {
    port: number;
    env: string;
  };
  performance: {
    cacheTtlSeconds: number;
    maxConcurrentRequests: number;
    requestTimeoutMs: number;
  };
  features: {
    enabled: boolean;
  };
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvVarAsNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvVarAsBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

export const config: Config = {
  openai: {
    apiKey: getEnvVar('OPENAI_API_KEY'),
    defaultModel: getEnvVar('DEFAULT_MODEL', 'gpt-5.2'),
    maxTranscriptLength: getEnvVarAsNumber('MAX_TRANSCRIPT_LENGTH', 1600000),
  },
  database: {
    url: getEnvVar('DATABASE_URL'),
  },
  server: {
    port: getEnvVarAsNumber('PORT', 3001),
    env: getEnvVar('NODE_ENV', 'development'),
  },
  performance: {
    cacheTtlSeconds: getEnvVarAsNumber('CACHE_TTL_SECONDS', 3600),
    maxConcurrentRequests: getEnvVarAsNumber('MAX_CONCURRENT_REQUESTS', 5),
    requestTimeoutMs: getEnvVarAsNumber('REQUEST_TIMEOUT_MS', 30000),
  },
  features: {
    enabled: getEnvVarAsBoolean('AI_FEATURES_ENABLED', true),
  },
};

export default config;