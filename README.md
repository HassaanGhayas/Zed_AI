# 🎓 MindFlow AI - Active Recall Socratic Video Tutor

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
   - Merges the video transcript takeaways with the student's verified answers.
   - Formats study notes with refined grammar, executive summary, callout tips, and active recall review cards.
   - One-click compile to printable PDF using pure-Python ReportLab.

---

## 🛠️ Architecture & Tech Stack

```
d:/ZED_AI/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes_video.py      # Video ingestion, transcript extraction, and segmentation
│   │   │   ├── routes_qa.py         # Socratic Q&A evaluation and misconception feedback
│   │   │   └── routes_notes.py      # Personalized notes synthesis and PDF export
│   │   ├── core/
│   │   │   └── config.py            # Environment configuration & Gemini settings
│   │   ├── models/
│   │   │   └── schemas.py           # Pydantic data schemas
│   │   ├── services/
│   │   │   ├── transcript_service.py# youtube-transcript-api fetcher
│   │   │   ├── segmenter_service.py # Gemini semantic topic segmenter
│   │   │   ├── evaluator_service.py # Socratic misconception evaluator
│   │   │   ├── notes_service.py     # Markdown study notes generator
│   │   │   └── pdf_service.py       # ReportLab PDF styling & compilation
│   │   └── main.py                  # FastAPI application entrypoint
│   ├── test_backend.py              # End-to-end backend verification test
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.tsx           # Navigation bar & Gemini API key modal
│   │   │   ├── VideoInput.tsx       # YouTube URL input & curated educational presets
│   │   │   ├── VideoPlayer.tsx      # YouTube IFrame player with auto-pause boundary protection
│   │   │   ├── SegmentNav.tsx       # Chapter progress & lock/unlock status
│   │   │   ├── SocraticQuiz.tsx     # Interactive active-recall & misconception resolution
│   │   │   └── NotesModal.tsx       # Markdown notes preview & PDF download
│   │   ├── lib/
│   │   │   └── api.ts               # Backend API client
│   │   ├── types/
│   │   │   └── index.ts             # TypeScript definitions
│   │   ├── App.tsx                  # Main orchestration component
│   │   └── index.css                # Tailwind CSS v4 styling
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

---

## ⚡ Quickstart Guide

### 1. Start the Backend (FastAPI)

```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
- Interactive Swagger documentation: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/api/health`

### 2. Start the Frontend (Vite + React)

In a separate terminal:
```bash
cd frontend
npm run dev
```
- Open `http://localhost:5173` in your browser.

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
