# Studify AI UI redesign: design

Date: 2026-10-21
Scope: `frontend/` only. No backend or API contract changes.

## Intent

Students use Studify in long study sessions. The owner reports four problems with the current interface:

1. Parts feel sloppy.
2. Text feels generic.
3. The app sometimes lags.
4. Colors are tiring to look at over long sessions.

The redesign fixes all four while keeping the existing brand (warm ember orange) and the core UX invariant: the player auto-pauses at each segment's `end_time` and the student cannot skip ahead until the active-recall checkpoint (`SocraticQuiz.tsx`) is resolved.

## Evidence from audits (state as of 2026-10-21, including uncommitted changes)

Lag:
- `VideoPlayer.tsx` polls every 250ms and calls `setCurrentTime` each tick, re-rendering the 732-line player about 4 times per second during playback. The interval effect depends on `onBoundaryReached`, an inline function in `App.tsx`, so the interval is torn down and rebuilt on every App render.
- `App.tsx` has about 15 `useState` calls and almost no memoization, so state changes re-render the whole tree.
- `backdrop-blur` appears 9 times, including two full-size overlays above the YouTube iframe (`VideoPlayer.tsx:518`, `:581`).
- Infinite animations: `cta-breathe` (animates `box-shadow`), `headline-shimmer` (animates `background-position`), `drift`, two `blur-3xl` blobs in `VideoInput.tsx`, and about 12 `animate-pulse` uses.
- `transition-all` appears 36 times.
- The new code (Insights, Review queue, Cloud library, Account menu) adds no blur or infinite animations.

Sloppy:
- No radius, shadow, or type-scale tokens. Radius mixes 7 values. There are about 90 arbitrary values, including 37 uses of `text-[10px]` and `text-[11px]`, and many `!important` overrides.
- `ui/Button`, `Card`, and `Badge` exist but large components bypass them. `Navbar` and `CloudLibrary` use raw `<button>` elements.
- Light mode is patched with selector hacks matching Tailwind utility classes (`index.css:265-276`, `:303`).
- `ProgressBar.tsx:12` hardcodes an ember gradient.

Generic text: body is Inter (default look), Fraunces is used only about 19 times, and fonts load from the Google Fonts CDN, which blocks rendering.

Color: dark mode is `#0b0a09` with `#f7f5f2` text (near-maximum contrast) and a saturated `#ff4d1f` accent.

## Goals

- Remove perceptible lag during video playback and when opening overlays.
- One consistent token system (color, type, radius, shadow, spacing) used by every component.
- Calmer palette for long sessions, in light and dark.
- Distinctive, readable typography with a real type scale.
- Self-hosted fonts.

## Non-goals

- No backend, schema, or API changes.
- No new features or new screens.
- No router or state-library migration.
- No switch of accent hue (the owner chose to keep ember).

## Anti-goals (failure even if it technically works)

- Any change that lets the student skip past an unresolved checkpoint.
- Lower accessibility: body text must stay AAA, `prefers-reduced-motion` must keep working.
- Visual changes that make the app look like a different product.
- Regressions when auth is disabled (Supabase env vars unset) or enabled.

## Decisions made by the owner

- Palette: option 1, "warm ember, muted".
  - Dark: base `#1a1816`, raised `#232019`, line `#34302a`, text `#e8e3dc`, muted text `#a39b8f`, accent `#e0663f`, text on accent `#1a1816`.
  - Light: base `#f4f0e8`, raised `#fbf8f2`, line `#ddd5c6`, text `#2a2622`, muted text `#6e655a`, accent `#b8532f`, text on accent `#ffffff`.
  - Status colors, both modes: success `#7fb08a` dark and `#3f7a52` light; warning `#d9a85a` dark and `#8a5a14` light. Danger is a muted red chosen by the builder to match.
- Target body contrast about 11:1 to 13:1, not 18:1.
- Fonts (approved after viewing a specimen): Source Sans 3 for body, Fraunces for headings, question prompts, and notes. JetBrains Mono for code stays. Self-host through `@fontsource`.

## Builder's calls (not yet confirmed by the owner)

- Type scale of 6 steps; radius tokens `sm`, `md`, `lg`; two shadow levels.

## Builder's calls from the review round (owner to check)

- Lag bar: player render count drops from about 4 per second to at most 1 per second during playback, with no dropped frames when opening Insights or the notes modal in the Chrome performance panel. Surviving `backdrop-blur` uses must sit over static content and show no frame drops in that panel; otherwise remove them.
- The progress bar and time readout may update once per second. The checkpoint clamp keeps using the ref value, so it stays exact.
- Add characterization tests for the checkpoint lock (including the video-ends-before-`end_time` case) before touching `VideoPlayer.tsx` or `App.tsx`.
- Contrast: body text and primary UI text must reach AAA (7:1). Muted text, status colors, and accent text must reach AA (4.5:1). If a given hex fails its bar, adjust it by the smallest amount that passes and list each change in the PR description. Check with a script using the WCAG formula.
- Type scale minimum is 12px. Dense UI (badges, Insights, Review, Cloud library) may reflow slightly. Enforce the ban on `text-[10px]` and `text-[11px]` with a grep check in the verification step, not a lint rule.
- Component migration: simplify bespoke styles to fit the existing `ui/` primitives. Add a variant or prop only when three or more call sites need the same style. Primitives used by landing and notes views are in scope when they use ad hoc styles.
- Phase 5 is cleanup: move `MotionRoot` to `main.tsx`, confirm reduced-motion behavior, and add crossfades only where a transition would otherwise pop. No new animations.
- The sepia theme is out of scope. Keep the structure two-theme.
- Auth-enabled verification uses a mocked Supabase client in a dev-only harness. No real account is needed.
- Baseline: run `npm run lint`, `npm run build`, and `npm test` first and record the result, so regressions are separable from existing failures.

## Plan

### Phase 1: fix lag (no visual change)

- `VideoPlayer.tsx`: keep playback time in a ref; update React state only when the whole second or the active segment changes. Wrap `onBoundaryReached` in `useCallback` in `App.tsx` so the interval is stable. Keep the lock/unlock behavior and the scrubber clamp exactly as they are.
- Reduce `App.tsx` re-render scope: move fast-changing state down or into the components that use it, and memoize heavy children.
- Replace `backdrop-blur` over the iframe with solid scrims. Remove the other blur uses unless they sit on static content and are measured to be cheap.
- Delete `cta-breathe`, `headline-shimmer`, `drift`, and the `blur-3xl` blobs. Limit `animate-pulse` to skeletons.
- Replace `transition-all` with specific property lists.

### Phase 2: tokens in `frontend/src/index.css`

- Replace the palette with the values above, as semantic tokens used by both themes. Remove the light-mode selector hacks.
- Add type-scale, radius, and shadow tokens. Forbid `text-[10px]` and `text-[11px]`.
- Replace the hardcoded gradient in `ui/ProgressBar.tsx`.

### Phase 3: typography

- Install `@fontsource` packages, import them in `main.tsx` or `index.css`, and remove the Google Fonts links from `index.html`.
- Size-aware tracking (tight on large text, near 0 on body), line height about 1.6 on body copy.

### Phase 4: components

- Make `ui/Button`, `Card`, and `Badge` the single source of style. Migrate `Navbar`, `CloudLibrary`, `ReviewQueue`, `ReviewModal`, `SocraticQuiz`, `ProgressView`, and `AnalyticsView`.
- Remove `!important` overrides. Use one modal scrim token.
- Order: quiz and player, landing, Navbar and account menu, Insights and Review.

### Phase 5: motion and polish

- Move `MotionRoot` from `AnalyticsView` to `main.tsx` before using `m.*` components elsewhere (it is `strict`).
- Springs only for touch-driven elements, critically damped by default; short crossfades under reduced motion.
- Check both auth states (Supabase configured and not) and both themes.

## Verification

- `npm run lint`, `npm run build`, `npm test` (vitest) must pass.
- Run the Vite dev server and take screenshots of landing, player, quiz, notes, Insights, and the account menu in light and dark.
- Measure React render counts for the player before and after Phase 1.
- Manually confirm the checkpoint lock still holds.

## Risks and notes

- `VideoPlayer.tsx` also has a pseudo-fullscreen fallback and `disablekb: 1`; keep both.
- `ReviewQueue` must not mount twice at once (two instances clobber the review study source). Keep the existing guard.
- `onLocalDataForeign` in `App.tsx` does not reset `isAnalyticsOpen`; leave as is unless a redesign change touches it.
- The working tree has many uncommitted backend and frontend changes. Commit or stash the owner's work before large refactors so the redesign diff stays reviewable.

## Left to the builder

Exact token names, exact font weights, the shadow values, the danger color, and which `backdrop-blur` uses survive after measurement.
