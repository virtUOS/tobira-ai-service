# Tobira AI Service

AI-powered microservice for the Tobira video portal, providing automatic video summarization and quiz generation using OpenAI's API.

## Features

- **Video Summarization** - AI-generated summaries from video transcripts
- **Quiz Generation** - Interactive quizzes from video content
- **Cumulative Quizzes** - Combined quizzes for series videos (all videos up to current)
- **Series Bulk Generation** - Generate content for all videos in a series at once
- **Automatic Caption Extraction** - Pull transcripts from Tobira's caption data
- **Queue System** - Async processing with BullMQ and Redis
- **Content Moderation** - User flagging and admin review system
- **Admin Dashboard** - Web-based monitoring and management

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```bash
OPENAI_API_KEY=your-openai-api-key
DATABASE_URL=postgresql://tobira:tobira@localhost:5432/tobira
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Apply Database Schema

```bash
psql -U tobira -d tobira -h localhost -f schema.sql
```

### 4. Start the Service

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

The service runs on `http://localhost:3001`

## API Endpoints

### Health & Status
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/status` | GET | Feature flags and metrics |

### Transcripts
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/transcripts/upload` | POST | Upload transcript |
| `/api/transcripts/:eventId` | GET | Get transcript |

### Summaries
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/summaries/generate/:eventId` | POST | Generate AI summary |
| `/api/summaries/:eventId` | GET | Get existing summary |

### Quizzes
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/quizzes/generate/:eventId` | POST | Generate AI quiz |
| `/api/quizzes/:eventId` | GET | Get existing quiz |

### Cumulative Quizzes
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cumulative-quizzes/generate/:eventId` | POST | Generate quiz combining all series videos up to this one |
| `/api/cumulative-quizzes/:eventId` | GET | Get cumulative quiz |

### Captions
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/captions/extract/:eventId` | POST | Extract caption |
| `/api/captions/extract-batch` | POST | Batch extract captions |
| `/api/captions/stats` | GET | Extraction statistics |

### Queue
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/queue/summary/:eventId` | POST | Queue summary generation |
| `/api/queue/quiz/:eventId` | POST | Queue quiz generation |
| `/api/queue/stats` | GET | Queue statistics |

### Series
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/series/:seriesId/videos` | GET | List videos in a series |
| `/api/admin/series/:seriesId/generate` | POST | Generate content for all videos in series |

### Admin
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/config` | GET | AI configuration |
| `/api/admin/features` | GET/PUT | Feature toggles |
| `/api/admin/flags` | GET | Flagged content |
| `/admin/admin.html` | - | Admin dashboard UI |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *required* | OpenAI API key |
| `DATABASE_URL` | *required* | PostgreSQL connection string |
| `REDIS_HOST` | localhost | Redis host |
| `REDIS_PORT` | 6379 | Redis port |
| `PORT` | 3001 | Service port |
| `DEFAULT_MODEL` | gpt-5.2 | OpenAI model |
| `CACHE_TTL_SECONDS` | 3600 | Cache duration |

### Database Configuration

Feature toggles can be controlled via the `ai_config` table:

```sql
UPDATE ai_config SET value = 'true' WHERE key = 'features_enabled';
UPDATE ai_config SET value = 'true' WHERE key = 'summary_enabled';
UPDATE ai_config SET value = 'true' WHERE key = 'quiz_enabled';
```

## Project Structure

```
tobira-ai-service/
├── src/
│   ├── config/           # Configuration
│   ├── services/         # Core services
│   │   ├── database.service.ts
│   │   ├── openai.service.ts
│   │   ├── cache.service.ts
│   │   ├── queue.service.ts
│   │   └── caption-extractor.service.ts
│   ├── utils/            # Utilities
│   └── index.ts          # Express server
├── public/
│   └── admin.html        # Admin dashboard
├── tests/                # Tests
├── schema.sql            # Database schema
├── .env.example          # Environment template
└── README.md
```

## Development

```bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Type checking
npm run build
```

## Authors

[VirtUOS](https://www.virtuos.uni-osnabrueck.de/) - Center for Digital Teaching, Campus Management and Higher Education Didactics at Osnabrück University

## License

Same as Tobira - see LICENSE file.

## Disclaimer

This project was developed with the assistance of generative AI, primarily using Anthropic's Claude models (Sonnet 4.5 and Opus 4.5). All AI-generated code has been reviewed and tested.