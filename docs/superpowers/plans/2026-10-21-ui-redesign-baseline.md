# UI Redesign Baseline (branch ui-redesign, from feat/supabase-analytics)

Run in `frontend/` before any redesign changes.

| Command | Result | Details |
|---|---|---|
| `npm run lint` (oxlint) | PASS (exit 0), warnings only, 0 errors | 8 pre-existing warnings (see below) |
| `npm run build` (tsc -b && vite build) | PASS (exit 0) | 2952 modules; chunk >500 kB warning (index 953.76 kB, AnalyticsView 455.48 kB); lottie-web direct `eval` warnings |
| `npm test` (vitest run) | PASS (exit 0) | Test Files 9 passed (9); Tests 91 passed (91) |

No failures. Pre-existing lint warnings (verbatim first lines):

- src/components/SocraticQuiz.tsx:125:5: warning react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency: 'stt'
- src/components/VideoPlayer.tsx:113:16 and :156:18: warning eslint(no-unused-vars): Catch parameter 'e' is caught but never used.
- src/components/VideoPlayer.tsx:91:7: warning react(set-state-in-effect)
- src/components/VideoPlayer.tsx:136:15: warning react-hooks(exhaustive-deps): missing dependencies 'onPlayerReady', 'activeSegment.start_time'
- src/contexts/ThemeContext.tsx:40:14: warning react(only-export-components)
- src/hooks/useSpeechRecognition.ts:65:13 and :67:14: warning react(refs): Cannot access refs during render
