# Brag plan — Studify AI

**What:** Paste a YouTube lecture; the video pauses at every key idea and makes you explain it. Misconceptions get diagnosed, then you export PDF notes.
**For:** students who watch lectures and forget them.
**Angle:** "Watching feels like learning. Explaining proves it." (the product's own tagline). Tone: `polished` with a punchy edge. Hard cuts on beats, dip-through-background transitions.
**Hook (0–3.5s):** the tagline lights up word by word, second line in ember.
**Punchline:** callback, "Explaining proves it." + "Paste a lecture link".
**Share caption:** see share-copy.txt.

## Identity (from `frontend/src/index.css`)
"Muted Ember": surface `#1a1816`, raised `#232019`, ink `#e8e3dc`, accent `#e0663f`, success `#7fb08a`, warning `#d9a85a`. Fonts: Fraunces (display), Source Sans 3, JetBrains Mono — real font files from `node_modules`. Logo = `public/favicon.svg`.

## Music
120 BPM (beat 0.5s, bar 2s), A minor: Am F C G Am F C G Am G Am. Pad + 8th-note pluck arp, soft kick/bass from 3.5s, hats from 8s. SFX (typing ticks, clicks, chimes) are in key and on the 16th grid, all in one reverb space.

## Storyboard (22s, every cut on a beat)
| t | Scene | Content |
|---|---|---|
| 0–3.5 | Hook | "Watching feels like learning." lights word by word → "Explaining proves it." |
| 3.5–8 | Reveal | Badge "Active recall, not passive watching", H1 "Remember any YouTube lecture, without rewatching it", "The video pauses. You explain the idea." |
| 8–12 | Paste | URL types into the real hero input, Start Tutor → chapter list (1 active, 2 locked) |
| 12–17 | Pause + explain | Conceptual question, typed answer, Submit → MISCONCEPTION verdict |
| 17–19.5 | Notes | Study-notes page builds, "Your notes. Your own answers.", Download PDF → saved |
| 19.5–22 | Outro | Logo, "Studify AI", "Explaining proves it.", CTA "Paste a lecture link" |

UI text is the product's own copy. Placeholder URL and the sample answer/verdict are illustrative; no real people, keys or accounts shown.
