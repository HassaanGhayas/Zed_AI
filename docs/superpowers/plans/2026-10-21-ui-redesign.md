# Studify UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove playback and overlay lag, replace the palette with the muted warm-ember theme, introduce real type, radius, and shadow tokens with self-hosted fonts, and make every component use them.

**Architecture:** Fix lag first without visual change (player time in a ref, quantized state, solid scrims, no infinite animations). Then swap token values in `frontend/src/index.css` (names stay), self-host fonts, restyle the `ui/` primitives, and migrate screens to the primitives. Each rule the spec bans is enforced by a vitest source-scan test added by the task that makes it true.

**Tech Stack:** React 19, Vite 8, Tailwind v4 (`@theme` in `index.css`), vitest 5, motion 12, `@fontsource` packages.

**Spec:** `docs/superpowers/specs/2026-10-21-ui-redesign-design.md`

All paths are relative to `D:\ZED_AI\frontend` unless they start with `docs/`.

## Global Constraints

- Frontend only. No backend, schema, or `src/lib/api.ts` contract changes.
- Checkpoint lock invariant: the student cannot move past an unresolved segment end. Never weaken it.
- Palette, dark: base `#1a1816`, raised `#232019`, line `#34302a`, text `#e8e3dc`, muted text `#a39b8f`, accent `#e0663f`, text on accent `#1a1816`, success `#7fb08a`, warning `#d9a85a`.
- Palette, light: base `#f4f0e8`, raised `#fbf8f2`, line `#ddd5c6`, text `#2a2622`, muted text `#6e655a`, accent `#b8532f`, text on accent `#ffffff`, success `#3f7a52`, warning `#8a5a14`.
- Contrast: body and primary text at least 7:1; muted, status, and accent text at least 4.5:1. If a hex fails, nudge it the smallest amount that passes and list each change in the commit message.
- Fonts: Source Sans 3 (body), Fraunces (headings, question prompts, notes), JetBrains Mono (code), all self-hosted via `@fontsource`. No Google Fonts links.
- Minimum text size 12px. Banned class patterns by the end: `text-[10px]`, `text-[11px]`, `transition-all`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`, bare `rounded`, `backdrop-blur` (except as allowed in Task 4), `animate-pulse` outside `ui/Skeleton.tsx`, infinite CSS animations in `index.css`.
- Two themes only (dark, light). No sepia.
- Lag bar: player re-renders at most 1 per second during playback; no dropped frames opening Insights or the notes modal.
- Reduced motion must keep working (`prefers-reduced-motion` rule in `index.css`, `MotionConfig reducedMotion="user"`).
- Do not stage the owner's unrelated uncommitted changes. Stage files by explicit path.

## Review Focus

- The video ends before the last segment's `end_time` (YouTube `ENDED` state): the checkpoint must still fire. Pinned in Task 1 and Task 2.
- Keyboard seek (±5 s, ±30 s) must use the live player time, not the once-per-second state. Pinned in Task 2.
- Auth disabled (no Supabase env vars): Navbar shows no Sign in, Insights, or account menu and does not crash. Pinned in Task 10.
- Phone width (375px): Navbar overflow menu, badges at 12px, and the quiz card must not overflow horizontally. Pinned in Task 12.
- Switching theme mid-session keeps the stored choice and applies without a flash of the wrong theme. Pinned in Task 5.

---

### Task 0: Baseline and branch

**Files:** none changed.

- [ ] **Step 1:** In `D:\ZED_AI`, run `git switch -c ui-redesign`. If the owner's uncommitted work blocks anything, leave it in place; do not stash or commit it.
- [ ] **Step 2:** In `frontend/`, run `npm run lint`, `npm run build`, `npm test`. Record pass/fail counts and any existing failures in `docs/superpowers/plans/2026-10-21-ui-redesign-baseline.md`.
- [ ] **Step 3:** Commit the baseline note: `git add docs/superpowers/plans/2026-10-21-ui-redesign-baseline.md docs/superpowers/specs docs/superpowers/plans/2026-10-21-ui-redesign.md` then `git commit -m "docs: ui redesign spec, plan, baseline"`.

### Task 1: Checkpoint-lock decision function with tests

**Files:**
- Create: `src/lib/playerBoundary.ts`
- Test: `src/lib/playerBoundary.test.ts`

**Interfaces:**
- Produces: `evaluateBoundary(input: BoundaryInput): BoundaryDecision`
  - `BoundaryInput = { time: number; segmentEnd: number; duration: number | undefined; settled: boolean; isPausedForQuiz: boolean; isSegmentResolved: boolean }`
  - `BoundaryDecision = { effectiveEnd: number; pause: boolean; seekTo: number | null; fireBoundary: boolean }`

This function is a pure extraction of the decision logic currently inline in `src/components/VideoPlayer.tsx:198-230`. Behavior must be identical.

- [ ] **Step 1: Write the failing tests** in `src/lib/playerBoundary.test.ts`:
  - `reaching segmentEnd while playing pauses and fires boundary`
  - `not settled returns no actions`
  - `non-finite time while unresolved pauses, never fires boundary`
  - `non-finite time while resolved does nothing`
  - `jump past end by more than 0.5 while unresolved seeks back to effectiveEnd and fires boundary`
  - `jump past end while resolved does not seek back`
  - `quiz open and time more than 0.5 past end seeks to effectiveEnd and pauses`
  - `quiz open does not fire boundary again`
  - `duration shorter than segmentEnd clamps effectiveEnd to duration - 0.5` (final segment overshoot case)
  - `effectiveEnd never below 0`
- [ ] **Step 2:** Run `npx vitest run src/lib/playerBoundary.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `evaluateBoundary` in `src/lib/playerBoundary.ts` to reproduce the logic from `VideoPlayer.tsx:198-230` exactly (effectiveEnd = `duration ? Math.min(segmentEnd, Math.max(0, duration - 0.5)) : segmentEnd`).
- [ ] **Step 4:** Run the same command. Expected: all PASS.
- [ ] **Step 5:** `git add src/lib/playerBoundary.ts src/lib/playerBoundary.test.ts && git commit -m "test(frontend): extract and pin checkpoint boundary decision"`

### Task 2: Player polling without per-tick re-render

**Files:**
- Modify: `src/components/VideoPlayer.tsx:71, 174-245, 418-439, 485-514, 708`
- Test: `src/lib/playerTime.test.ts`, `src/lib/playerTime.ts` (create)

**Interfaces:**
- Consumes: `evaluateBoundary` from Task 1.
- Produces: `quantizeSeconds(time: number): number` in `src/lib/playerTime.ts` (returns `Math.floor(time)` for finite non-negative input, `0` otherwise).

- [ ] **Step 1: Write failing tests** in `src/lib/playerTime.test.ts`: `quantizeSeconds floors finite values`, `quantizeSeconds returns 0 for NaN, Infinity, negatives`.
- [ ] **Step 2:** Run `npx vitest run src/lib/playerTime.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `quantizeSeconds` in `src/lib/playerTime.ts`.
- [ ] **Step 4:** In `VideoPlayer.tsx`: add `currentTimeRef = useRef(0)`; in the interval, assign `currentTimeRef.current = time` every tick and call `setCurrentTime(quantizeSeconds(time))` (React bails out when the value is unchanged, so state changes at most once per second). Replace the inline boundary block with `evaluateBoundary(...)` and apply its decision (`pause` → `pauseVideo()`, `seekTo` → `seekTo(value, true)`, `fireBoundary` → `onBoundaryReachedRef.current()`). Keep the existing `getPlayerState` keep-paused check and the fail-closed `catch`.
- [ ] **Step 5:** Remove `onBoundaryReached` from the interval effect dependency array and read `isPausedForQuiz`/`isSegmentResolved` through refs (add `isSegmentResolvedRef` alongside `isPausedForQuizRef`) so the interval is only rebuilt when `activeSegment` changes.
- [ ] **Step 6:** Keyboard seeks (`seekTo(currentTime ± 5/30)`) must read `currentTimeRef.current`, not state.
- [ ] **Step 7:** Make the progress fill and marker animate smoothly between one-second states: use `transform: scaleX()`/`translateX()` with `transition: transform 1s linear` instead of `width`/`left` transitions at `VideoPlayer.tsx:499,514`.
- [ ] **Step 8:** Run `npm test`, `npm run lint`, `npm run build`. Expected: all pass (same as baseline plus new tests).
- [ ] **Step 9:** Manual check with `npm run dev`: play a preset video; confirm the player pauses at the segment end, the quiz opens, and a native-control seek past the end is pulled back. Confirm the ENDED case: seek near the end of the last segment, let the video finish, quiz still opens.
- [ ] **Step 10:** `git add src/lib/playerTime.ts src/lib/playerTime.test.ts src/components/VideoPlayer.tsx && git commit -m "perf(frontend): stop per-tick player re-renders, keep checkpoint lock"`

### Task 3: App render scope

**Files:**
- Modify: `src/App.tsx` (handlers passed to `VideoPlayer` and `SocraticQuiz`, around lines 322 and 554-570), `src/components/VideoPlayer.tsx` (export wrapped in `React.memo`)

- [ ] **Step 1:** Wrap `handleBoundaryReached`, `handleRewatchSegment`, `handlePlayingChange`, `handleVideoProgress` in `useCallback` with correct dependencies; export `VideoPlayer` as `React.memo(VideoPlayer)`.
- [ ] **Step 2:** In dev, add a temporary `console.count('VideoPlayer render')` at the top of `VideoPlayer`. Play for 10 seconds. Expected: at most 1 count per second after the first second. Remove the log.
- [ ] **Step 3:** Run `npm test`, `npm run lint`, `npm run build`.
- [ ] **Step 4:** `git add src/App.tsx src/components/VideoPlayer.tsx && git commit -m "perf(frontend): memoize player and its handlers"`

### Task 4: Remove costly effects

**Files:**
- Modify: `src/index.css` (infinite keyframes `drift`, `headline-shimmer`, `owl-blink`, `cta-breathe` and their classes), `src/components/VideoInput.tsx:66-67,87`, `src/components/VideoPlayer.tsx:518,581`, `src/components/Navbar.tsx:77`, `src/components/ui/Modal.tsx:43`, `src/components/NotesModal.tsx:253`, `src/components/ProgressView.tsx:158`, every `transition-all` and `animate-pulse` use
- Test: `src/designRules.test.ts` (create)

- [ ] **Step 1: Write failing tests** in `src/designRules.test.ts` that scan `src/**/*.{ts,tsx,css}` (excluding `*.test.*`) and assert zero matches, one `it` per rule: `no transition-all`, `no backdrop-blur`, `no animate-pulse outside ui/Skeleton.tsx`, `no infinite keyframe animations in index.css`.
- [ ] **Step 2:** Run `npx vitest run src/designRules.test.ts`. Expected: FAIL listing offenders.
- [ ] **Step 3:** Replace each `backdrop-blur` with a solid scrim using the existing `bg-surface` color at 85-90% opacity (never over the YouTube iframe with blur). Delete the infinite animations and the two `blur-3xl` blobs. Replace each `transition-all` with the specific properties that change (for example `transition-[color,background-color,border-color]`). Replace `animate-pulse` on non-skeleton elements with a static state; keep it only in `ui/Skeleton.tsx`.
- [ ] **Step 4:** Run `npx vitest run src/designRules.test.ts`. Expected: PASS.
- [ ] **Step 5:** Run `npm test`, `npm run lint`, `npm run build`. Manual check: landing page, player, notes modal, Insights open without visual breakage.
- [ ] **Step 6:** In the Chrome performance panel, open the notes modal and Insights during playback; confirm no long frames. Record the result in the PR description.
- [ ] **Step 7:** `git add src && git commit -m "perf(frontend): remove blur, infinite animations, transition-all"` (stage explicit changed paths).

### Task 5: Color, type, radius, shadow tokens

**Files:**
- Modify: `src/index.css:3-109, 265-303` (palette values, selector hacks)
- Modify: `src/contexts/ThemeContext.tsx` only if the theme attribute logic needs the no-flash fix below
- Modify: `index.html` (inline no-flash theme script if absent)
- Test: `src/lib/contrast.test.ts` (create)

**Interfaces:**
- Produces (token names stay; values change): `--color-surface`, `--color-raised`, `--color-sunken`, `--color-line`, `--color-line-soft`, `--color-ink`, `--color-ink-muted`, `--color-ink-faint`, `--color-accent`, `--color-accent-hover`, `--color-on-accent`, `--color-success`, `--color-warning`, `--color-danger`.
- Produces (new): `--text-xs` 0.75rem, `--text-sm` 0.875rem, `--text-base` 1rem, `--text-lg` 1.125rem, `--text-xl` 1.375rem, `--text-2xl` 1.75rem, `--text-display` clamp(2rem, 5vw, 3rem); `--radius-md` 0.625rem, `--radius-lg` 0.875rem; `--shadow-card`, `--shadow-pop`.

- [ ] **Step 1: Write failing test** in `src/lib/contrast.test.ts`: parse the dark (`@theme`) and light (`[data-theme="light"]`) token values from `src/index.css` and assert WCAG ratios: `ink` on `surface` and on `raised` at least 7; `ink-muted` on `surface` at least 7; `ink-faint` on `surface` at least 4.5; `accent` on `surface` at least 4.5; `on-accent` on `accent` at least 4.5; `success`, `warning`, `danger` on `surface` at least 4.5; for both themes. Name tests `dark: ink on surface >= 7` and so on.
- [ ] **Step 2:** Run it. Expected: FAIL (old palette values and missing tokens).
- [ ] **Step 3:** Apply the Global Constraints palette to `@theme` (dark) and `[data-theme="light"]`. Choose `sunken`, `line-soft`, `ink-muted`, `accent-hover`, and `danger` to match (builder's call; muted red for danger, for example `#e07a72` dark and `#b0382f` light). Remove the light-mode ember-ramp remap and the selector hacks at `index.css:265-276,303`; switch the affected components to tokens as part of this task.
- [ ] **Step 4:** Add the type, radius, and shadow tokens above. Update the body `font-feature-settings` (remove Inter-only features). Keep `prefers-reduced-motion` rule.
- [ ] **Step 5:** Run `npx vitest run src/lib/contrast.test.ts`. If a pair fails, nudge that hex minimally and record each change in the commit message. Expected: PASS.
- [ ] **Step 6: Theme-flash check.** Ensure `index.html` sets `data-theme` from stored preference in a blocking inline script before first paint. Manual check: set light, hard-reload, no dark flash.
- [ ] **Step 7:** Run `npm test`, `npm run lint`, `npm run build`. Manual check: both themes render without unreadable text.
- [ ] **Step 8:** `git add src/index.css index.html src/contexts/ThemeContext.tsx src/lib/contrast.test.ts && git commit -m "feat(frontend): muted ember palette and type/radius/shadow tokens"`

### Task 6: Self-hosted fonts

**Files:**
- Modify: `package.json`, `package-lock.json`, `index.html:12-15`, `src/main.tsx`, `src/index.css:10-12`

- [ ] **Step 1:** Run `npm view @fontsource-variable/source-sans-3 version`, `npm view @fontsource-variable/fraunces version`, `npm view @fontsource/jetbrains-mono version` to confirm names, then `npm install @fontsource-variable/source-sans-3 @fontsource-variable/fraunces @fontsource/jetbrains-mono`.
- [ ] **Step 2:** Import in `src/main.tsx`: Source Sans 3 variable (latin subset), Fraunces variable (latin subset, include the `opsz` axis file if available), JetBrains Mono 400 and 500.
- [ ] **Step 3:** Set `--font-sans` to `"Source Sans 3 Variable"`, `--font-display` to `"Fraunces Variable"` (check the exact family names the packages register) with the existing fallbacks.
- [ ] **Step 4:** Delete the three Google Fonts `<link>` lines from `index.html`.
- [ ] **Step 5:** Apply `font-display` (Fraunces) to question prompts in `SocraticQuiz.tsx`, notes headings in `NotesModal.tsx`, and page headings. Use size-aware tracking: `tracking-tight` on large headings, none on body; body `leading-relaxed` (about 1.6).
- [ ] **Step 6:** Run `npm run build`. In dev tools Network, confirm no request to `fonts.googleapis.com`. Confirm fonts render (computed `font-family`).
- [ ] **Step 7:** `git add package.json package-lock.json index.html src/main.tsx src/index.css src/components/SocraticQuiz.tsx src/components/NotesModal.tsx && git commit -m "feat(frontend): self-host Source Sans 3, Fraunces, JetBrains Mono"`

### Task 7: Restyle `ui/` primitives

**Files:**
- Modify: `src/components/ui/Button.tsx`, `Card.tsx`, `Badge.tsx`, `Modal.tsx`, `ProgressBar.tsx`, `Skeleton.tsx`, `SegmentedControl.tsx`
- Test: extend `src/designRules.test.ts`

- [ ] **Step 1: Add failing rules** to `src/designRules.test.ts` limited to `src/components/ui/`: no `rounded-xl|2xl|3xl`, no bare `rounded`, no `text-[`, no `shadow-lg|xl|2xl`, no `bg-gradient`, no `!` important modifiers.
- [ ] **Step 2:** Run it. Expected: FAIL (`Button.tsx:13` gradient and `shadow-lg`, `ProgressBar.tsx:12` gradient).
- [ ] **Step 3:** `Button`: flat `bg-accent text-on-accent hover:bg-accent-hover` primary; secondary and ghost use tokens; radius `rounded-md`; keep `min-h-[44px]` and the press feedback (`active:scale-[0.97]`), drop `hover:-translate-y-0.5`. `Card`: `rounded-lg`, `bg-raised`, `border border-line-soft`, `shadow-card`. `Badge`: `text-xs`, `rounded-full`. `Modal`: one scrim token (`bg-surface/80`), `rounded-lg`, `shadow-pop`. `ProgressBar`: flat `bg-accent` fill, keep the `scaleX` animation.
- [ ] **Step 4:** Run the rules, `npm test`, `npm run lint`, `npm run build`. Expected: pass.
- [ ] **Step 5:** `git add src/components/ui src/designRules.test.ts && git commit -m "refactor(frontend): ui primitives use design tokens"`

### Task 8: Migrate quiz and player

**Files:**
- Modify: `src/components/SocraticQuiz.tsx`, `src/components/VideoPlayer.tsx`, `src/components/SegmentNav.tsx`, `src/components/AiTutorPanel.tsx`
- Test: extend `src/designRules.test.ts`

- [ ] **Step 1: Add failing rules** scoped to these files: no `text-[10px]`, `text-[11px]`, `rounded-xl|2xl|3xl`, bare `rounded`, raw `bg-white|bg-black|text-red-` classes, `rgba(`, or `!`-important modifiers (such as `px-2.5!`, `!bg-`, `!border-0`).
- [ ] **Step 2:** Run. Expected: FAIL with offenders listed.
- [ ] **Step 3:** Replace ad hoc button/card/badge markup with `Button`, `Card`, `Badge`. Use `text-xs` (12px) as the smallest size. Replace raw colors with tokens (scrims use `bg-surface/80`; control overlays on video use `bg-surface/80 text-ink`). Remove `!` overrides; if a primitive cannot express a style used by three or more call sites, add one variant to the primitive instead.
- [ ] **Step 4:** Run the rules, `npm test`, `npm run lint`, `npm run build`. Manual check: play a segment, answer correctly, answer with a misconception, open "Explain screen" if available; both themes.
- [ ] **Step 5:** Re-run the Task 2 Step 9 lock check (pause at end, no skipping, ENDED case).
- [ ] **Step 6:** `git add` the four component files and `src/designRules.test.ts`, then `git commit -m "refactor(frontend): quiz and player use design system"`

### Task 9: Migrate landing and notes

**Files:**
- Modify: `src/components/VideoInput.tsx`, `src/components/landing/*`, `src/components/NotesModal.tsx`, `src/components/ProgressView.tsx`, `src/components/ErrorBoundary.tsx`, `src/App.tsx` (skeletons and fallbacks)
- Test: extend `src/designRules.test.ts`

- [ ] **Step 1:** Add the same scoped rules as Task 8 for these paths. Run; expect FAIL.
- [ ] **Step 2:** Migrate to primitives and tokens as in Task 8 Step 3. Landing headline uses `font-display` with `--text-display` and negative tracking; remove the shimmering gradient text (use solid `text-ink`).
- [ ] **Step 3:** Run the rules, `npm test`, `npm run lint`, `npm run build`. Manual check of landing, notes modal, progress view in both themes.
- [ ] **Step 4:** `git add` the modified files and `git commit -m "refactor(frontend): landing, notes, progress use design system"`

### Task 10: Navbar, account menu, Cloud library

**Files:**
- Modify: `src/components/Navbar.tsx`, `src/components/CloudLibrary.tsx`, `src/components/ThemeToggle.tsx`
- Test: `src/components/Navbar.test.tsx` (create), extend `src/designRules.test.ts`

- [ ] **Step 1: Write failing tests** in `Navbar.test.tsx`, rendering the way `src/components/ui/RollingNumber.test.tsx` does:
  - `auth disabled: renders theme and API key controls, no Sign in, no Insights, no account menu`
  - `auth enabled and signed out: renders Sign in`
  - `auth enabled and signed in: opening the account menu shows Review weak spots and Sign out`
  Mock `useAuth` from `src/contexts/AuthContext.tsx` to supply `enabled` and user state.
- [ ] **Step 2:** Run `npx vitest run src/components/Navbar.test.tsx`. Expected: FAIL or the existing behavior fails a new assertion; if it passes already, keep it as a regression pin and continue.
- [ ] **Step 3:** Replace raw `<button>` elements with `Button` (add a `size="sm"` or `icon` variant only if three or more call sites need it). Menu: `rounded-lg`, `shadow-pop`, `bg-raised`. Remove `transition-all` leftovers and `shadow-2xl`. Add scoped design rules for these files.
- [ ] **Step 4:** Run tests, lint, build. Manual check with the mocked auth states in dev.
- [ ] **Step 5:** `git add src/components/Navbar.tsx src/components/Navbar.test.tsx src/components/CloudLibrary.tsx src/components/ThemeToggle.tsx src/designRules.test.ts && git commit -m "refactor(frontend): navbar and cloud library use design system"`

### Task 11: Insights and Review

**Files:**
- Modify: `src/components/AnalyticsView.tsx`, `src/components/ReviewQueue.tsx`, `src/components/ReviewModal.tsx`
- Test: extend `src/designRules.test.ts`

- [ ] **Step 1:** Add scoped rules (as Task 8) for these files; run; expect FAIL (`text-[10px]` and `text-[11px]` at `AnalyticsView.tsx:298,537,552,612`, `ReviewModal.tsx:89`, `ReviewQueue.tsx:189`, `px-3!` at `ReviewQueue.tsx:157`).
- [ ] **Step 2:** Migrate to primitives and tokens. Chart colors keep reading CSS variables (`var(--color-accent)`, `var(--color-line-soft)`); confirm they follow the new palette in both themes. Let dense areas reflow at 12px minimum.
- [ ] **Step 3:** Keep the guard that stops two `ReviewQueue` instances mounting together (`ReviewQueue.tsx:38-42`, comment near `App.tsx:483`).
- [ ] **Step 4:** Run tests, lint, build. Manual check of Insights and Review in both themes.
- [ ] **Step 5:** `git add` the three files and `src/designRules.test.ts`, then `git commit -m "refactor(frontend): insights and review use design system"`

### Task 12: Motion root, reduced motion, final verification

**Files:**
- Modify: `src/main.tsx`, `src/components/AnalyticsView.tsx:86` (remove local `MotionRoot`)
- Test: extend `src/designRules.test.ts`; screenshots under `docs/superpowers/plans/screens/`

- [ ] **Step 1:** Mount `MotionRoot` in `src/main.tsx` around the app; remove the wrapper from `AnalyticsView.tsx`.
- [ ] **Step 2:** Add whole-source rules to `src/designRules.test.ts`: no `text-[10px]`, `text-[11px]`; no `rounded-xl|2xl|3xl` or bare `rounded`; no `!`-important utility modifiers; no `bg-gradient`. Run; fix remaining offenders anywhere in `src`.
- [ ] **Step 3:** Run `npm run lint`, `npm run build`, `npm test`. Expected: all pass, with test count at or above baseline.
- [ ] **Step 4:** With `npm run dev`, set the browser to emulate `prefers-reduced-motion: reduce`; confirm slides and springs become instant or crossfades.
- [ ] **Step 5:** Screenshots in dark and light at 1280px and 375px: landing, player with quiz open, notes modal, Insights, account menu (auth enabled via mocked client, and auth disabled). Check no horizontal scroll at 375px.
- [ ] **Step 6:** Run axe: write a short Node script using the existing `axe-core` and `puppeteer-core` devDependencies against the dev server landing page; fix any contrast violations introduced.
- [ ] **Step 7:** Re-run the checkpoint lock manual check (Task 2 Step 9) and the profiler check (Task 3 Step 2).
- [ ] **Step 8:** `git add src docs/superpowers/plans/screens && git commit -m "chore(frontend): motion root at app level, final design gates"`

### Task 13: New logo (concept D, "book that plays")

Added after the owner chose concept D from sketches. Owner request, outside the original spec.

**Files:**
- Modify: `frontend/src/components/ui/Logo.tsx`, `frontend/public/favicon.svg`
- Modify (only if they reference owl-specific markup or comments): `frontend/src/components/VideoInput.tsx` (comment at ~line 64 mentions the owl mark), `frontend/src/components/Navbar.tsx`, `frontend/src/components/landing/LandingFooter.tsx`
- Test: `frontend/src/components/ui/Logo.test.tsx` (create)

**Interfaces:**
- Produces: `Logo({ className?: string })` keeps its current signature and default `className = 'w-5 h-5'`; renders an `<svg viewBox="0 0 24 24" aria-hidden="true">` using `currentColor`, so callers keep controlling color.

Mark geometry (from the approved sketch, stroke width 1.8, round caps and joins, `fill="none"` unless noted): open-book outline `M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z`; spine `M12 6v13`; play triangle on the right page `M14.6 9.4 L17.6 11.3 L14.6 13.2Z` filled with `currentColor` (stroke width 1, round join). The builder may refine proportions for optical balance at 16-20px, keeping the same concept.

- [ ] **Step 1: Write failing test** `Logo.test.tsx`, rendering like `ui/RollingNumber.test.tsx`: `Logo renders an svg with viewBox "0 0 24 24" and aria-hidden`, `Logo applies a custom className`, `Logo contains no owl geometry` (no `<circle>` elements and no `<line>` elements in the markup).
- [ ] **Step 2:** Run `npx vitest run src/components/ui/Logo.test.tsx`. Expected: FAIL (current owl uses circles and lines).
- [ ] **Step 3:** Replace `Logo.tsx` body with the concept D mark; update the doc comment (drop the owl rationale; say the mark is a book with a play symbol for video-led study).
- [ ] **Step 4:** Replace `public/favicon.svg` with a 48x48 rounded tile (`rx="12"`, fill `#e0663f`) containing the same mark scaled to about 60% in `#1a1816`, stroke width scaled to stay about 3.6 at 48px.
- [ ] **Step 5:** Update any owl wording in comments at the callers listed above; no behavior change. Check Navbar and LandingFooter render the Logo inside a tile or alone with token colors (`text-accent` or `text-on-accent`), not hard-coded ember classes that no longer match.
- [ ] **Step 6:** Run `npm test`, `npm run lint`, `npm run build`. Expected: pass.
- [ ] **Step 7:** `git add` the changed paths and commit `feat(frontend): new book-with-play logo and favicon`.
