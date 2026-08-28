# Personalised AI Tutor

An AI-powered tutor that turns any public YouTube lecture into an interactive, topic-by-topic learning experience — extracting key concepts, asking questions, evaluating understanding, diagnosing misconceptions, and generating personalised notes.

## How It Works

```
Lecture Link → Extract Topics → Ask Question → Student Answers →
Evaluate Understanding → Explain Gap → Targeted Retry → Personalised Notes → Next Topic
```

The student submits a public YouTube lecture link. The system extracts 3–5 structured topics, then walks through each one in a loop: ask a conceptual question, evaluate the student's answer, explain any gaps, offer a targeted retry if needed, and generate personalised notes once understanding is demonstrated.

## Tech Stack

- **Frontend:** Next.js, React, Tailwind CSS
- **Backend:** Python, FastAPI
- **AI Layer:** Google Gemini API
- **Database:** PostgreSQL / Supabase

## Architecture

```
Browser → Next.js → FastAPI → Gemini API → Backend Validation → Database → Frontend
```

The frontend communicates with the backend exclusively through REST APIs — AI credentials never touch the client. FastAPI keeps AI calls separate from core learning logic, so the backend (not the model) controls what happens next in the learning flow.

### AI Jobs

Instead of one large prompt, the system uses six focused Gemini calls:

1. Lecture understanding
2. Question generation
3. Understanding evaluation
4. Misconception analysis
5. Adaptive retry
6. Personalised notes generation

AI evaluation calls return structured JSON (`result`, `understanding_score`, `missing_concepts`, `misconception`, `feedback`, `should_retry`), which the backend validates before updating the student's learning state.

### Data Model

```
Topic → Question → Answer → Evaluation → Retry → Notes
```

## Reliability Principles

- API keys stored in environment variables, never in frontend code
- URL and input validation before processing
- AI responses validated before updating learning state
- Hard retry limits to prevent endless loops
- Modular AI layer — the model/provider can be swapped without rewriting core logic

## Project Status

**MVP in active development.** The current build targets a single supported public YouTube lecture, demonstrating the full feedback-and-retry learning loop end-to-end.

### Delivery Plan

- [x] **Phase 1 — Setup:** Frontend/backend scaffolding, database connection, REST communication, Gemini API access
- [ ] **Phase 2 — Lecture Processing:** Lecture link input, URL validation, topic extraction
- [ ] **Phase 3 — Learning Loop:** Learning screens, question generation, answer evaluation
- [ ] **Phase 4 — Feedback + Retry:** Misconception detection, targeted explanations, retry logic
- [ ] **Phase 5 — Personalised Notes:** Notes generation, full flow integration

## Getting Started

> Setup instructions coming soon.

## License

> TBD
