# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Studify AI — turns public YouTube lectures into Socratic active-recall study sessions: auto-pausing player, AI-generated checkpoint questions, misconception-aware Q&A evaluation, Gemini-vision "explain screen", and PDF study notes export.

Two independent apps, run separately: FastAPI backend (`backend/`) + Vite/React frontend (`frontend/`).

## Commands

### Backend (`backend/`)
```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload   # dev server
python test_backend.py                                                 # e2e verification (hits live services)
pytest                                                                  # unit tests (backend/tests/)
pytest tests/test_segmenter_service.py -k heuristic                   # single test
```
Swagger UI at `http://localhost:8000/docs`, health check at `/api/health`.

Requires `GOOGLE_API_KEY` (Gemini) via `backend/.env` or environment — or a per-request `X-Gemini-Key` header from the frontend's API-key modal, which overrides the server key.

### Frontend (`frontend/`)
```bash
npm run dev       # Vite dev server, http://localhost:5173
npm run build     # tsc -b && vite build
npm run lint      # oxlint
npm run preview
```
`VITE_API_URL` env var points the frontend at the backend (defaults to `http://localhost:8000`).

## Architecture

### Backend: FastAPI, service-per-concern, routers are thin
`app/main.py` wires four routers, each owning one REST area and its own service module in `app/services/`:

| Router (prefix) | Service | Responsibility |
|---|---|---|
| `routes_video.py` (`/api/video`) | `transcript_service` + `segmenter_service` | URL → video_id, fetch transcript (`youtube-transcript-api`), Gemini semantic segmentation into 3–6 chapters with questions |
| `routes_video.py` visual endpoints | `visual_service` | yt-dlp + ffmpeg frame extraction, Gemini vision analysis ("explain screen", segment keyframes) — opt-in via `enable_visual_analysis`, degrades to 503 when the media toolchain is unavailable |
| `routes_qa.py` (`/api/qa`) | `evaluator_service` | Grades a student's answer against `expected_concept`, returns CORRECT/MISCONCEPTION/INCORRECT + mastery score + follow-up prompt |
| `routes_notes.py` (`/api/notes`) | `notes_service` + `pdf_service` | Merges transcript + Q&A history into Markdown notes, then ReportLab-compiles to PDF |
| `routes_voice.py` (`/api/voice`) | — | Audio transcription for spoken answers |

Request/response contracts for all routes live in one file: `app/models/schemas.py` (Pydantic). When changing an endpoint's shape, update the schema there — frontend's `frontend/src/types/index.ts` and `frontend/src/lib/api.ts` must be kept in sync manually (no codegen).

Gemini model selection falls back through `settings.gemini_candidate_models` (`app/core/config.py`); `segmenter_service` also has a pure heuristic fallback when Gemini segmentation fails, so segmentation always returns something.

`backend/.cache/` holds downloaded media, extracted frames, and transcript JSON keyed by `video_id`, with TTL via `media_cache_ttl_hours` — treat as disposable, not a data store.

### Frontend: single-page orchestration, no router
`App.tsx` owns the whole session state machine (video → segments → active segment → Q&A attempts → notes); components under `src/components/` are mostly presentational, driven by props/callbacks from `App.tsx`. `src/lib/api.ts` is the sole fetch boundary to the backend — every call reads `API_BASE` from `VITE_API_URL`. `src/lib/persistence.ts` / `sessionHistory.ts` handle local session resume; `src/contexts/ThemeContext.tsx` drives the light/dark token system in `index.css` (Tailwind v4).

The video player (`VideoPlayer.tsx`) auto-pauses the embedded YouTube IFrame player at each segment's `end_time` and won't let the student skip ahead until the active-recall checkpoint (`SocraticQuiz.tsx`) is resolved — this lock/unlock state is the core UX invariant; changes to segment timing or Q&A flow must preserve it.

### Cross-cutting
- CORS allow-list in `backend/app/core/config.py` (`cors_origins`) must include any new frontend deployment origin.
- Gemini API key can come from server env (`GOOGLE_API_KEY`) or be supplied per-session by the user via the Navbar's key modal, forwarded as `X-Gemini-Key` — don't assume a server key is always present.
- `.agent/skills/` is a large generic third-party skill library, not project-specific documentation — ignore it when orienting to this codebase.
