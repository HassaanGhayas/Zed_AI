# 🎓 Studify AI - Active Recall Socratic Video Tutor

An end-to-end interactive learning platform that transforms public YouTube educational lectures into segmented, active-recall study sessions. The player automatically pauses at conceptual topic boundaries, challenges the learner with Socratic questions, diagnoses misconceptions constructively, and synthesizes personalized notes exportable as formatted PDF documents.

---

## 🚀 Key Features

1. **Public YouTube Ingestion**:
   - Accepts any public YouTube video link (`watch?v=`, `youtu.be/`, shorts, or embed).
   - Automatically retrieves video metadata (title, author, thumbnail) and fetches official or auto-generated timestamped subtitles using `youtube-transcript-api`.

2. **AI Semantic Segmentation**:
   - Analyzes time-coded transcripts using Gemini (with algorithmic heuristic fallback).
   - Dynamically partitions lectures into 3–6 logical pedagogical chapters with exact start and end timestamps.
   - Formulates targeted active recall conceptual questions for each segment.

3. **Synchronized Auto-Pause Video Player**:
   - Embedded YouTube IFrame player with active time boundary monitoring.
   - Automatically halts playback when reaching the segment's `end_time`.
   - Prevents skipping ahead until the student completes the active recall exercise.

4. **Socratic Q&A & Adaptive Misconception Loop**:
   - **Correct Answer**: Affirms the student's reasoning and unlocks the next question or chapter.
   - **Incorrect / Misconception**: Identifies the specific flaw in the student's mental model, explains the concept with reference to the video segment, and prompts them with a guided follow-up question to reformulate their response.

5. **Personalized Study Notes & PDF Export**:
   - Merges the video transcript takeaways, keyframe visual insights, and the student's verified answers.
   - Formats study notes with refined grammar, executive summary, callout tips, and active recall review cards.
   - One-click compile to printable PDF using pure-Python ReportLab.

6. **Gemini Vision "Explain Screen"**:
   - Captures the current video frame and asks Gemini to explain the on-screen equation, diagram, or slide in context.
   - Surfaces a visual explanation overlay without leaving fullscreen playback.

7. **Voice Input & AI Tutor Panel**:
   - Optional microphone-driven answers for the active-recall checkpoints.
   - A live tutor panel tracks segment progress, current recall stage, and quick chapter jumps.

8. **Analytics Dashboard, Theming & Accessibility**:
   - Progress view summarizing mastered vs. flagged checkpoints across the session.
   - Light/dark theme toggle with WCAG AA-oriented contrast, semantic design tokens, ARIA landmarks/live regions, `sr-only` headings, and 44px minimum touch targets.

---

## 🛠️ Architecture & Tech Stack

```
d:/ZED_AI/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes_video.py      # Video ingestion, transcript extraction, and segmentation
│   │   │   ├── routes_qa.py         # Socratic Q&A evaluation and misconception feedback
│   │   │   ├── routes_notes.py      # Personalized notes synthesis and PDF export
│   │   │   └── routes_voice.py      # Voice input transcription for spoken answers
│   │   ├── core/
│   │   │   ├── config.py            # Environment configuration & Gemini settings
│   │   │   └── rate_limit.py        # Per-IP rate limiting middleware
│   │   ├── models/
│   │   │   └── schemas.py           # Pydantic data schemas
│   │   ├── services/
│   │   │   ├── transcript_service.py# youtube-transcript-api fetcher
│   │   │   ├── segmenter_service.py # Gemini semantic topic segmenter
│   │   │   ├── evaluator_service.py # Socratic misconception evaluator
│   │   │   ├── _model_race.py       # Parallel Gemini model fallback helper
│   │   │   ├── notes_service.py     # Markdown study notes generator
│   │   │   ├── visual_service.py    # Gemini vision keyframe "explain screen" analysis
│   │   │   └── pdf_service.py       # ReportLab PDF styling & compilation
│   │   └── main.py                  # FastAPI application entrypoint
│   ├── tests/                       # pytest unit tests (no network or API key needed)
│   ├── test_backend.py              # End-to-end backend verification test (live services)
│   ├── Dockerfile / .dockerignore   # Backend container image
│   ├── .env.example                 # Backend environment template
│   ├── requirements.txt
│   └── requirements-dev.txt         # Adds pytest
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.tsx           # Navigation bar, theme toggle & Gemini API key modal
│   │   │   ├── VideoInput.tsx       # YouTube URL input & curated educational presets
│   │   │   ├── VideoPlayer.tsx      # YouTube IFrame player with auto-pause & visual explanation overlay
│   │   │   ├── SegmentNav.tsx       # Chapter progress & lock/unlock status
│   │   │   ├── AiTutorPanel.tsx     # Live recall-stage status & chapter quick jumps
│   │   │   ├── SocraticQuiz.tsx     # Interactive active-recall & misconception resolution
│   │   │   ├── ProgressView.tsx     # Analytics dashboard of mastered vs. flagged checkpoints
│   │   │   ├── ThemeToggle.tsx      # Light/dark theme switch
│   │   │   └── NotesModal.tsx       # Markdown notes preview & PDF download
│   │   ├── lib/
│   │   │   ├── api.ts               # Backend API client
│   │   │   ├── api.test.ts          # API client tests (vitest)
│   │   │   ├── persistence.ts       # Local session resume
│   │   │   └── persistence.test.ts
│   │   ├── types/
│   │   │   └── index.ts             # TypeScript definitions
│   │   ├── App.tsx                  # Main orchestration component
│   │   └── index.css                # Tailwind CSS v4 styling
│   ├── .env.example                 # Frontend environment template
│   ├── package.json
│   └── vite.config.ts
├── .github/workflows/ci.yml         # CI: backend pytest, frontend lint/test/build
├── LICENSE
└── README.md
```

---

## Setup

Prerequisites: Python 3.12+, Node.js 22+, and a Gemini API key.

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                                  # then set GOOGLE_API_KEY
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (separate terminal)
cd frontend
npm ci
cp .env.example .env                                  # optional locally
npm run dev
```

- Frontend: `http://localhost:5173`
- Swagger docs: `http://localhost:8000/docs`, health check: `http://localhost:8000/api/health`
- Instead of a server key, users can paste their own Gemini key in the Navbar; it is sent per request as `X-Gemini-Key`.

## Environment Variables

Backend (`backend/.env`, see `backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_API_KEY` | empty | Gemini API key (optional if clients send `X-Gemini-Key`) |
| `WEBSHARE_PROXY_USERNAME` / `WEBSHARE_PROXY_PASSWORD` | empty | Webshare proxy for transcript fetching from cloud IPs |
| `YOUTUBE_PROXY` | empty | Generic proxy URL for YouTube requests |
| `YOUTUBE_COOKIES_TXT` | empty | Path to a Netscape cookies.txt (or its contents) |
| `YOUTUBE_COOKIES_CONTENT` | empty | Cookies file contents as an env value |
| `ENABLE_VISUAL_ANALYSIS` | `true` | Toggle yt-dlp/ffmpeg frame analysis |
| `MEDIA_CACHE_TTL_HOURS` | `72` | Lifetime of cached media and frames |
| `RATE_LIMIT_ENABLED` | `true` | Toggle per-IP rate limiting |
| `RATE_LIMIT_PER_MINUTE` | `30` | Requests per IP per minute, per endpoint group |
| `RATE_LIMIT_FRAME_PER_MINUTE` | `120` | Limit for frame image endpoints |
| `MAX_AUDIO_BYTES` | `10485760` | Max voice upload size (10 MB) |
| `UVICORN_RELOAD` | off | Dev-only auto-reload |
| `SUPABASE_URL` | empty | Optional. Enables Supabase auth verification (JWKS) and the shared transcript/segment cache |
| `SUPABASE_SERVICE_KEY` | empty | Optional. Service role key, server-side only |
| `SUPABASE_JWT_SECRET` | empty | Optional. Only for legacy HS256 Supabase projects |

Supabase is optional; with these unset the backend behaves exactly as without it. The schema lives in `supabase/migrations/0001_init.sql`. With it configured, `DELETE /api/me/data` (Bearer token required) erases the caller's synced sessions and Q&A attempts.

Learning analytics (needs Supabase and migrations `0001`-`0003` applied manually; routes return `503 {"detail":"Supabase not configured"}` otherwise). All require a Bearer token and are rate limited:

| Route | Purpose |
|---|---|
| `POST /api/analytics/record` | Record a graded attempt; updates per-concept spaced-repetition state |
| `POST /api/analytics/study-time` | Add study seconds to a day (atomic RPC `add_study_seconds`, capped at 24h) |
| `GET /api/analytics/summary?days=30` | Retention, velocity, consistency, decay, projected curve, domain mastery |
| `GET /api/analytics/due?limit=20` | Concepts due for review with their original question |
| `GET /api/analytics/export?format=csv\|pdf&days=30` | Progress export (no answers included) |

`DELETE /api/me/data` also erases concepts, review events, study days and settings.

Frontend (`frontend/.env`, see `frontend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Backend base URL, no trailing slash |

CORS origins and Gemini model candidates live in `backend/app/core/config.py`.

## Running Tests and CI

```bash
cd backend && pytest                     # unit tests, no network or API key required
cd frontend && npm run lint && npm test && npm run build
```

GitHub Actions (`.github/workflows/ci.yml`) runs both on every push and pull request to `main`.

## Docker

```bash
cd backend
docker build -t studify-backend .
docker run --rm -p 8000:8000 --env-file .env studify-backend
# custom port: docker run --rm -e PORT=9000 -p 9000:9000 --env-file .env studify-backend
```

The image runs as a non-root user and includes a `/api/health` healthcheck. Only the bundled demo transcripts in `backend/.cache/transcripts/` are baked in; other cache content is excluded.

## Deployment Notes

- **Frontend**: deploy `frontend/` to Vercel (root directory `frontend`) and set `VITE_API_URL` to the backend URL. No rewrites are needed because the app is a single page.
- **Backend**: deploy the container to any host that sets `PORT`.
- **CORS**: add the frontend origin to `cors_origins` in `backend/app/core/config.py`.
- **Rate limiting**: the container starts uvicorn with `--proxy-headers --forwarded-allow-ips='*'` so limits apply to real client IPs behind a reverse proxy. Only expose it behind a trusted proxy.
- **YouTube blocking**: cloud IPs are often blocked from fetching transcripts. Set the proxy variables (preferred) or the cookies variables listed above.

## License

MIT, see [LICENSE](LICENSE).

---

## 🧪 Running Verification Tests

```bash
cd backend
python test_backend.py
```
This tests:
- YouTube URL parsing
- Subtitle extraction & heuristic/AI segmentation
- Socratic evaluator misconception detection
- Markdown notes generation
- PDF binary compilation
