// Studify AI pitch deck builder. Run: node build_deck.js  -> Studify_AI_Pitch.pptx
// Design: light ivory, ember accent, Cambria headings + Calibri body (safe fonts), 16:9 wide.
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const fa = require("react-icons/fa");

const A = (f) => path.join(__dirname, "assets", f);
const has = (f) => fs.existsSync(A(f));

const C = {
  bg: "FAF9F7", ink: "15130F", muted: "57534A", faint: "7D786D",
  ember: "FF4D1F", deep: "BA300F", tint: "FFF1EA", sunken: "F0EEEB",
  line: "E5E2DD", white: "FFFFFF", dark: "0B0A09", ok: "15803D", warn: "8A5A00",
};
const HEAD = "Cambria", BODY = "Calibri";
const W = 13.333, H = 7.5, MX = 0.7;

async function icon(Comp, color, size = 256) {
  const svg = renderToStaticMarkup(React.createElement(Comp, { color: "#" + color, size: String(size) }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

(async () => {
  // logo (owl tile) from favicon
  const favicon = fs.readFileSync(path.join(__dirname, "..", "frontend", "public", "favicon.svg"));
  fs.mkdirSync(path.join(__dirname, "assets"), { recursive: true });
  await sharp(favicon, { density: 600 }).resize(512, 512).png().toFile(A("logo.png"));

  // crop screenshots to the relevant region so UI text stays legible at slide size
  fs.mkdirSync(A("crops"), { recursive: true });
  const CROPS = {
    "c_quiz.png": ["04_paused_quiz.png", 600, 20, 720, 500],
    "c_feedback.png": ["05_misconception.png", 600, 205, 720, 650],
    "c_video.png": ["03_workspace_locked.png", 413, 60, 1094, 616],
    "c_dash.png": ["08_progress_dashboard.png", 537, 150, 418, 375],
    "c_notes.png": ["09_notes_modal.png", 576, 267, 768, 547],
    "c_pdf.png": ["notes_page2.png", 0, 0, 1224, 520],
  };
  for (const [out, [src, left, top, width, height]] of Object.entries(CROPS)) {
    if (!has(src)) continue;
    await sharp(A(src)).extract({ left, top, width, height }).png().toFile(A("crops/" + out));
  }

  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.title = "Studify AI - AI Hackathon Pakistan 2026";
  pres.author = "Team Studify AI";

  const TOTAL = 11;
  const shadow = () => ({ type: "outer", color: "000000", opacity: 0.12, blur: 10, offset: 2, angle: 90 });

  function base(slide, n, tag) {
    slide.background = { color: C.bg };
    slide.addImage({ path: A("logo.png"), x: MX, y: 0.38, w: 0.4, h: 0.4, altText: "Studify AI logo" });
    slide.addText("Studify AI", { x: MX + 0.5, y: 0.38, w: 2.4, h: 0.4, fontFace: HEAD, fontSize: 14, bold: true, color: C.ink, margin: 0, valign: "middle", isTextBox: true });
    if (tag) {
      slide.addShape(pres.ShapeType.roundRect, { x: W - MX - 2.3, y: 0.4, w: 2.3, h: 0.36, rectRadius: 0.18, fill: { color: C.tint }, line: { color: C.tint } });
      slide.addText(tag, { x: W - MX - 2.3, y: 0.4, w: 2.3, h: 0.36, fontFace: BODY, fontSize: 11, bold: true, color: C.deep, align: "center", valign: "middle", charSpacing: 2, margin: 0, isTextBox: true });
    }
    slide.addText(typeof n === "number" ? String(n) + " / " + TOTAL : "Backup " + n, { x: W - MX - 1.2, y: H - 0.5, w: 1.2, h: 0.3, fontFace: BODY, fontSize: 10, color: C.faint, align: "right", margin: 0, isTextBox: true });
  }
  function title(slide, text, opts = {}) {
    slide.addText(text, { x: MX, y: opts.y || 1.0, w: opts.w || W - 2 * MX, h: opts.h || 1.2, fontFace: HEAD, fontSize: opts.size || 36, bold: true, color: C.ink, margin: 0, valign: "top", isTextBox: true });
  }
  // screenshot with soft frame; placeholder if the file is missing
  function shot(slide, file, x, y, w, h, label) {
    slide.addShape(pres.ShapeType.roundRect, { x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12, rectRadius: 0.1, fill: { color: C.white }, line: { color: C.line, width: 1 }, shadow: shadow() });
    if (has(file)) {
      slide.addImage({ path: A(file), x, y, w, h, sizing: { type: "cover", w, h }, altText: label });
    } else {
      slide.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { color: C.sunken }, line: { color: C.line } });
      slide.addText("[ screenshot: " + file + " ]", { x, y, w, h, fontFace: BODY, fontSize: 14, color: C.faint, align: "center", valign: "middle", isTextBox: true });
    }
  }
  function card(slide, x, y, w, h, fill = C.white) {
    slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: C.line, width: 1 }, shadow: shadow() });
  }
  function num(slide, n, x, y, d = 0.5) {
    slide.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: C.ember }, line: { color: C.ember } });
    slide.addText(String(n), { x, y, w: d, h: d, fontFace: HEAD, fontSize: 18, bold: true, color: C.white, align: "center", valign: "middle", margin: 0, isTextBox: true });
  }

  // ---------- 1. Title ----------
  {
    const s = pres.addSlide();
    s.background = { color: C.bg };
    s.addShape(pres.ShapeType.ellipse, { x: 8.6, y: -1.6, w: 7.2, h: 7.2, fill: { color: C.ember, transparency: 12 }, line: { color: C.ember, transparency: 100 } });
    s.addShape(pres.ShapeType.ellipse, { x: 10.6, y: 3.6, w: 4.6, h: 4.6, fill: { color: C.deep, transparency: 20 }, line: { color: C.deep, transparency: 100 } });
    s.addImage({ path: A("logo.png"), x: MX, y: 0.8, w: 0.9, h: 0.9, altText: "Studify AI logo" });
    s.addText("Studify AI", { x: MX, y: 2.2, w: 8, h: 1.3, fontFace: HEAD, fontSize: 66, bold: true, color: C.ink, margin: 0, isTextBox: true });
    s.addText("Don't just watch lectures. Learn from them.", { x: MX, y: 3.55, w: 7.8, h: 1.0, fontFace: HEAD, fontSize: 28, italic: true, color: C.deep, margin: 0, valign: "top", isTextBox: true });
    s.addText("An AI tutor that pauses any YouTube lecture, asks you to explain it, and finds exactly where your understanding broke.", { x: MX, y: 4.7, w: 7.4, h: 0.9, fontFace: BODY, fontSize: 16, color: C.muted, margin: 0, valign: "top", isTextBox: true });
    s.addText("AI Hackathon Pakistan 2026  |  Education track", { x: MX, y: 6.15, w: 7.5, h: 0.35, fontFace: BODY, fontSize: 13, bold: true, color: C.ink, margin: 0, isTextBox: true });
    s.addText("Muhammad Alyan (Team Lead)  |  Abdullah (Frontend)  |  Hassan Bin Gheas (Backend)", { x: MX, y: 6.5, w: 9, h: 0.35, fontFace: BODY, fontSize: 12, color: C.muted, margin: 0, isTextBox: true });
    s.addNotes("[~15 s] Hi judges, we're Team Studify AI, Education track. One line: we built an AI tutor that makes learners more capable, not more dependent. Everything today is working software, and I'll show it in the demo.");
  }

  // ---------- 2. Impact: the problem ----------
  {
    const s = pres.addSlide();
    base(s, 2, "IMPACT");
    title(s, "Watching a lecture feels like learning.\nMost of the time, it isn't.", { h: 1.4 });
    const ic1 = await icon(fa.FaPlayCircle, C.deep), ic2 = await icon(fa.FaRobot, C.deep);
    const gap = 0.3, cw = (W - 2 * MX - gap) / 2, cy = 2.9, ch = 3.6;
    const data = [
      { ic: ic1, h: "Passive video", p: "You nod along, the video ends, and you can't explain what you just watched. Nothing forces you to recall it.", t: "Illusion of learning" },
      { ic: ic2, h: "Answer-giving AI", p: "Ask, get the answer, move on. The tool does the thinking, and the learner grows more dependent with every use.", t: "Outsourced thinking" },
    ];
    data.forEach((d, i) => {
      const x = MX + i * (cw + gap);
      card(s, x, cy, cw, ch);
      s.addImage({ data: d.ic, x: x + 0.4, y: cy + 0.4, w: 0.65, h: 0.65, altText: d.h });
      s.addText(d.h, { x: x + 1.3, y: cy + 0.4, w: cw - 1.6, h: 0.65, fontFace: HEAD, fontSize: 26, bold: true, color: C.ink, margin: 0, valign: "middle", isTextBox: true });
      s.addText(d.p, { x: x + 0.4, y: cy + 1.35, w: cw - 0.8, h: 1.4, fontFace: BODY, fontSize: 19, color: C.ink, margin: 0, valign: "top", isTextBox: true });
      s.addText(d.t, { x: x + 0.4, y: cy + 2.85, w: cw - 0.8, h: 0.5, fontFace: HEAD, fontSize: 20, bold: true, italic: true, color: C.deep, margin: 0, valign: "middle", isTextBox: true });
    });
    s.addNotes("[~30 s] Two failure modes. Video lectures are passive: you feel like you understood, but nothing forced recall. And the popular fix, AI that just hands out answers, makes it worse: the tool does the thinking. For students, especially where access to good tutors is limited, that dependence is the real risk. Note: add a sourced statistic here if the team has one; we deliberately didn't invent one.");
  }

  // ---------- 3. Idea ----------
  {
    const s = pres.addSlide();
    base(s, 3, "IMPACT");
    title(s, "Our idea: the AI asks.\nThe learner answers.", { h: 1.4 });
    const gap = 0.7, bw = (W - 2 * MX - gap) / 2, by = 2.9, bh = 3.7;
    const bx = [MX, MX + bw + gap];
    card(s, bx[0], by, bw, bh, C.sunken);
    s.addText("Typical AI study tool", { x: bx[0] + 0.4, y: by + 0.3, w: bw - 0.8, h: 0.5, fontFace: HEAD, fontSize: 24, bold: true, color: C.ink, margin: 0, isTextBox: true });
    ["Ask", "Get the answer", "Forget it"].forEach((t, i) => {
      s.addShape(pres.ShapeType.roundRect, { x: bx[0] + 0.4, y: by + 1.15 + i * 0.8, w: bw - 0.8, h: 0.62, rectRadius: 0.1, fill: { color: C.white }, line: { color: C.line } });
      s.addText(t, { x: bx[0] + 0.6, y: by + 1.15 + i * 0.8, w: bw - 1.2, h: 0.62, fontFace: BODY, fontSize: 19, color: C.muted, margin: 0, valign: "middle", isTextBox: true });
    });
    card(s, bx[1], by, bw, bh, C.tint);
    s.addText("Studify AI", { x: bx[1] + 0.4, y: by + 0.3, w: bw - 0.8, h: 0.5, fontFace: HEAD, fontSize: 24, bold: true, color: C.deep, margin: 0, isTextBox: true });
    ["Pause at a key idea", "Explain it in your words", "Get diagnosed, try again"].forEach((t, i) => {
      s.addShape(pres.ShapeType.roundRect, { x: bx[1] + 0.4, y: by + 1.15 + i * 0.8, w: bw - 0.8, h: 0.62, rectRadius: 0.1, fill: { color: C.white }, line: { color: C.ember, width: 1.5 } });
      s.addText(t, { x: bx[1] + 0.6, y: by + 1.15 + i * 0.8, w: bw - 1.2, h: 0.62, fontFace: BODY, fontSize: 19, bold: true, color: C.ink, margin: 0, valign: "middle", isTextBox: true });
    });
    s.addText("vs", { x: MX + bw, y: by + 1.6, w: gap, h: 0.6, fontFace: HEAD, fontSize: 24, italic: true, color: C.ink, align: "center", margin: 0, isTextBox: true });
    s.addNotes("[~25 s] Our insight is to flip the roles. Studify never gives the answer first. It pauses the lecture, asks the student to explain the idea, finds the gap in their understanding, and asks again. Capability comes from retrieval and correction, which is active recall, a well-studied learning technique.");
  }

  // ---------- 4. How it works ----------
  {
    const s = pres.addSlide();
    base(s, 4, "CREATIVE AI");
    title(s, "Any YouTube lecture becomes a Socratic session", { h: 0.8, size: 32 });
    const steps = [
      ["Pause", "The player stops at each chapter end and locks skipping."],
      ["Ask", "AI writes recall questions from what the lecture said."],
      ["Diagnose", "Your answer is judged for understanding, not keywords."],
      ["Re-ask", "A sharper follow-up targets the gap, then the chapter unlocks."],
    ];
    const sw = 5.1, sh = 1.12, sy = 1.95, sg = 0.14;
    steps.forEach((st, i) => {
      const y = sy + i * (sh + sg);
      card(s, MX, y, sw, sh);
      num(s, i + 1, MX + 0.2, y + 0.3, 0.52);
      s.addText([{ text: st[0], options: { fontFace: HEAD, fontSize: 20, bold: true, color: C.ink, breakLine: true } }, { text: st[1], options: { fontFace: BODY, fontSize: 14, color: C.muted } }], { x: MX + 0.95, y, w: sw - 1.1, h: sh, margin: 0, valign: "middle", isTextBox: true });
    });
    // crop is 720x590 -> aspect 1.22
    const ih = 4.4, iw = ih * (720 / 500);
    shot(s, "crops/c_quiz.png", W - MX - iw, 1.95, iw, ih, "Video paused at a chapter boundary with a recall question");
    s.addNotes("[~40 s] Paste any public YouTube lecture. We pull the captions and Gemini splits it into 3 to 6 chapters, anchored to real caption timestamps. The player pauses at each chapter end and will not let you skip ahead until you answer. Questions come from what the lecture said, not from generic prompts.");
  }

  // ---------- 5. Evaluator ----------
  {
    const s = pres.addSlide();
    base(s, 5, "CREATIVE AI");
    title(s, "It diagnoses the\nmisconception", { w: 6.2, h: 1.3, size: 34 });
    const chips = [["CORRECT", C.ok], ["MISCONCEPTION", C.warn], ["INCORRECT", C.deep]];
    chips.forEach((c, i) => {
      const cwid = [1.45, 2.2, 1.6][i], cx = MX + [0, 1.6, 3.95][i];
      s.addShape(pres.ShapeType.roundRect, { x: cx, y: 2.55, w: cwid, h: 0.44, rectRadius: 0.22, fill: { color: C.white }, line: { color: c[1], width: 1.5 } });
      s.addText(c[0], { x: cx, y: 2.55, w: cwid, h: 0.44, fontFace: BODY, fontSize: 12, bold: true, color: c[1], align: "center", valign: "middle", margin: 0, isTextBox: true });
    });
    const pts = [
      "A 0-100 mastery score, plus what you understood, what is missing, and which mental model is wrong.",
      "Follow-ups adapt: first a rephrase, then a narrower question aimed at the misconception.",
      "After 3 attempts the chapter is flagged Needs Review and you move on. The server enforces that limit.",
    ];
    pts.forEach((t, i) => {
      num(s, i + 1, MX, 3.4 + i * 1.15, 0.42);
      s.addText(t, { x: MX + 0.65, y: 3.35 + i * 1.15, w: 5.0, h: 1.05, fontFace: BODY, fontSize: 16, color: C.ink, margin: 0, valign: "top", isTextBox: true });
    });
    // tall crop 720x900 -> aspect 0.8
    const ih = 5.05, iw = ih * (720 / 650);
    shot(s, "crops/c_feedback.png", W - MX - iw, 1.55, iw, ih, "Misconception verdict with a guided follow-up question");
    s.addNotes("[~45 s] This is the core of the product. The evaluator returns one of three verdicts, a mastery score, and lists what you understood, what is missing, and which misconception you hold. The follow-up gets narrower with each attempt. The three-attempt ceiling is enforced on the server, not trusted to the model, and we never mark an answer correct just because attempts ran out. That keeps the learner honest and unblocked.");
  }

  // ---------- 6. Multimodal ----------
  {
    const s = pres.addSlide();
    base(s, 6, "CREATIVE AI");
    title(s, "It sees the screen and hears you", { h: 0.8, size: 34 });
    const icEye = await icon(fa.FaEye, C.deep), icMic = await icon(fa.FaMicrophone, C.deep), icCards = await icon(fa.FaLayerGroup, C.deep);
    const cols = [
      { ic: icEye, h: "Explain this screen", p: "Gemini vision reads the paused frame: equations to LaTeX, diagrams, and on-screen text." },
      { ic: icMic, h: "Answer out loud", p: "Speak your explanation. Browsers without speech support fall back to Gemini audio transcription." },
      { ic: icCards, h: "Keyframe flashcards", p: "Each chapter's key frame becomes an active-recall flashcard that feeds your notes." },
    ];
    const gap = 0.25, cw = (W - 2 * MX - 2 * gap) / 3, cy = 2.15, ch = 3.3;
    cols.forEach((c, i) => {
      const x = MX + i * (cw + gap);
      card(s, x, cy, cw, ch);
      s.addShape(pres.ShapeType.ellipse, { x: x + 0.35, y: cy + 0.35, w: 0.95, h: 0.95, fill: { color: C.tint }, line: { color: C.tint } });
      s.addImage({ data: c.ic, x: x + 0.6, y: cy + 0.6, w: 0.45, h: 0.45, altText: c.h });
      s.addText(c.h, { x: x + 0.35, y: cy + 1.5, w: cw - 0.7, h: 0.5, fontFace: HEAD, fontSize: 22, bold: true, color: C.ink, margin: 0, valign: "middle", isTextBox: true });
      s.addText(c.p, { x: x + 0.35, y: cy + 2.05, w: cw - 0.7, h: 1.1, fontFace: BODY, fontSize: 16, color: C.ink, margin: 0, valign: "top", isTextBox: true });
    });
    s.addShape(pres.ShapeType.roundRect, { x: MX, y: 5.85, w: W - 2 * MX, h: 0.8, rectRadius: 0.12, fill: { color: C.tint }, line: { color: C.tint } });
    s.addText("If media tools are unavailable, Studify keeps working in text-only mode. Nothing blocks the learner.", { x: MX + 0.4, y: 5.85, w: W - 2 * MX - 0.8, h: 0.8, fontFace: BODY, fontSize: 17, italic: true, color: C.deep, margin: 0, valign: "middle", isTextBox: true });
    s.addNotes("[~30 s] Lectures are visual, so the tutor is too. Explain this screen sends the paused frame to Gemini vision and returns the equation as LaTeX, the diagram description, and the key concept. Students can answer by voice. Everything degrades gracefully: if media tools are unavailable, text-only mode still works.");
  }

  // ---------- 7. Outcome ----------
  {
    const s = pres.addSlide();
    base(s, 7, "IMPACT");
    title(s, "The result: notes in your own words,\nwith your gaps marked", { h: 1.3, size: 32 });
    // dashboard crop 418x470 (0.89); notes modal crop 768x547 (1.404)
    const dh = 2.9, dw = dh * (418 / 375);
    const nh = 3.6, nw = nh * (768 / 547);
    shot(s, "crops/c_dash.png", MX, 2.8, dw, dh, "Progress dashboard with chapters finished and mastery");
    shot(s, "crops/c_notes.png", MX + dw + 0.4, 2.45, nw, nh, "Personalised study notes with PDF download");
    const tx = MX + dw + 0.4 + nw + 0.45, tw = W - MX - tx;
    s.addText("Your words.\nYour gaps.\nYour next step.", { x: tx, y: 2.45, w: tw, h: 3.6, fontFace: HEAD, fontSize: 28, italic: true, bold: true, color: C.deep, margin: 0, valign: "middle", isTextBox: true });
    s.addText("Built from the student's own answers, polished for grammar, with a Concepts to Revisit list for every misconception. Exported as a themed PDF.", { x: MX, y: 6.3, w: W - 2 * MX - 1.4, h: 0.7, fontFace: BODY, fontSize: 16, color: C.ink, margin: 0, valign: "top", isTextBox: true });
    s.addNotes("[~30 s] At the end the student gets study notes assembled from their own answers, polished for grammar but preserving their ideas, with a Concepts to Revisit list for every misconception we found. They download it as a PDF. The dashboard shows mastery per chapter, so they know what to review before an exam. Screens shown are from a real session on the 3Blue1Brown neural-network lecture.");
  }

  // ---------- 8. Viability ----------
  {
    const s = pres.addSlide();
    base(s, 8, "VIABILITY");
    title(s, "Built to keep working in the real world", { h: 0.8, size: 34 });
    const box = (x, y, w, h, head, sub, fill, lineC) => {
      s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: lineC, width: 1.2 }, shadow: shadow() });
      s.addText([{ text: head, options: { fontFace: HEAD, fontSize: 18, bold: true, color: C.ink, breakLine: true } }, { text: sub, options: { fontFace: BODY, fontSize: 14, color: C.muted } }], { x: x + 0.15, y, w: w - 0.3, h, margin: 0, valign: "middle", align: "center", isTextBox: true });
    };
    const arrow = (x1, y1, x2, y2) => s.addShape(pres.ShapeType.line, { x: x1, y: Math.min(y1, y2), w: x2 - x1, h: Math.abs(y2 - y1), flipV: y2 < y1, line: { color: C.deep, width: 2, endArrowType: "triangle" } });
    const rw = 2.85;
    box(MX, 2.0, 3.2, 1.5, "Learner's browser", "React 19, Vite, Tailwind\nLive on Vercel", C.white, C.line);
    box(4.75, 2.0, 3.5, 1.5, "FastAPI backend", "Transcripts, chaptering, grading,\nvision, notes + PDF", C.tint, C.ember);
    box(W - MX - rw, 1.75, rw, 1.0, "Gemini models", "Fallback chain of 3", C.white, C.line);
    box(W - MX - rw, 3.0, rw, 1.0, "YouTube", "Captions, frames", C.white, C.line);
    arrow(MX + 3.2, 2.75, 4.75, 2.75);
    arrow(8.25, 2.5, W - MX - rw, 2.25);
    arrow(8.25, 3.0, W - MX - rw, 3.5);
    const feats = [
      ["Always works", "If Gemini fails, heuristic fallbacks still chapter, grade, and write notes."],
      ["No accounts needed", "Stateless backend. Session resume lives in the browser."],
      ["Bring your own key", "Users can supply a free Gemini key per session."],
      ["Accessible", "WCAG AA contrast, focus traps, 44px touch targets, light and dark."],
    ];
    const fg = 0.2, fw = (W - 2 * MX - 3 * fg) / 4;
    feats.forEach((f, i) => {
      const x = MX + i * (fw + fg), y = 4.4;
      card(s, x, y, fw, 2.0);
      s.addText(f[0], { x: x + 0.2, y: y + 0.15, w: fw - 0.4, h: 0.5, fontFace: HEAD, fontSize: 18, bold: true, color: C.deep, margin: 0, valign: "middle", isTextBox: true });
      s.addText(f[1], { x: x + 0.2, y: y + 0.7, w: fw - 0.4, h: 1.2, fontFace: BODY, fontSize: 14, color: C.ink, margin: 0, valign: "top", isTextBox: true });
    });
    s.addText("Built with Qoder, Alibaba Cloud's agentic coding platform.", { x: MX, y: 6.65, w: 9, h: 0.35, fontFace: BODY, fontSize: 14, italic: true, color: C.ink, margin: 0, isTextBox: true });
    s.addNotes("[~40 s] Viability. Thin React front end on Vercel, FastAPI backend, no database. The AI layer is a fallback chain of Gemini models, and if all of them fail, heuristic fallbacks keep the core flow alive, so a demo or a classroom never dead-ends. Users can bring their own key. We built it with Alibaba Cloud's Qoder agentic coding platform. The model layer is swappable, which is why Qwen on Model Studio is first on our roadmap. Be ready: we did not deploy on Alibaba Cloud, so say that plainly if asked.");
  }

  // ---------- 9. Demo ----------
  {
    const s = pres.addSlide();
    base(s, 9, "DEMO");
    title(s, "See it in 90 seconds", { h: 0.8, size: 34 });
    const pw = 8.6, ph = pw * (616 / 1094);
    shot(s, "crops/c_video.png", (W - pw) / 2, 1.7, pw, ph, "Demo poster frame: the study player");
    s.addText("Recorded demo, 90 seconds", { x: (W - pw) / 2, y: 1.7 + ph + 0.2, w: pw, h: 0.35, fontFace: BODY, fontSize: 16, color: C.muted, align: "center", margin: 0, isTextBox: true });
    s.addNotes("[~90 s] Play the recording. Narrate: paste a lecture, chapters appear, video pauses and locks, wrong answer gets a misconception diagnosis, a better answer unlocks the next chapter, Explain screen, then download the PDF notes. Backup: if video fails, the screenshots on slides 4 to 7 show each step. Keep studify_demo.mp4 in the same folder as this deck and link the poster image to it (Insert > Link) before presenting.");
  }

  // ---------- 10. Honest limits + roadmap ----------
  {
    const s = pres.addSlide();
    base(s, 10, "VIABILITY");
    title(s, "Honest limits, and what comes next", { h: 0.8, size: 34 });
    const gap = 0.3, cw = (W - 2 * MX - gap) / 2, cy = 2.0, ch = 4.3;
    card(s, MX, cy, cw, ch);
    s.addText("Today's limits", { x: MX + 0.4, y: cy + 0.3, w: cw - 0.8, h: 0.5, fontFace: HEAD, fontSize: 24, bold: true, color: C.ink, margin: 0, isTextBox: true });
    const lim = ["Needs YouTube captions on the video", "Very long lectures: only the first part of the transcript is used for chaptering", "Frame analysis needs a video download, which YouTube can block from cloud IPs", "No sign-in or rate limiting yet; test coverage is partial"];
    s.addText(lim.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < lim.length - 1, paraSpaceAfter: 10 } })), { x: MX + 0.4, y: cy + 1.0, w: cw - 0.8, h: 3.1, fontFace: BODY, fontSize: 17, color: C.ink, margin: 0, valign: "top", isTextBox: true });
    card(s, MX + cw + gap, cy, cw, ch, C.tint);
    s.addText("Roadmap", { x: MX + cw + gap + 0.4, y: cy + 0.3, w: cw - 0.8, h: 0.5, fontFace: HEAD, fontSize: 24, bold: true, color: C.deep, margin: 0, isTextBox: true });
    const road = ["Qwen on Alibaba Cloud Model Studio as a second model backend", "Urdu and regional-language lectures and questions", "Teacher view: class-level misconception reports", "Spaced-repetition review of flagged concepts"];
    s.addText(road.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < road.length - 1, paraSpaceAfter: 10 } })), { x: MX + cw + gap + 0.4, y: cy + 1.0, w: cw - 0.8, h: 3.1, fontFace: BODY, fontSize: 17, color: C.ink, margin: 0, valign: "top", isTextBox: true });
    s.addNotes("[~25 s] We would rather tell you the limits than have you find them. It needs captions, very long lectures are truncated for chaptering, and frame analysis depends on downloading video. Next steps: Qwen on Model Studio as a second model backend, Urdu and regional languages, and a teacher view. Roadmap items are plans, not shipped features.");
  }

  // ---------- 11. Team + close ----------
  {
    const s = pres.addSlide();
    s.background = { color: C.bg };
    s.addShape(pres.ShapeType.ellipse, { x: 10.9, y: 4.6, w: 4.6, h: 4.6, fill: { color: C.ember, transparency: 12 }, line: { color: C.ember, transparency: 100 } });
    s.addImage({ path: A("logo.png"), x: MX, y: 0.5, w: 0.7, h: 0.7, altText: "Studify AI logo" });
    s.addImage({ path: A("logo.png"), x: 10.0, y: 1.3, w: 2.6, h: 2.6, altText: "Studify AI owl logo" });
    s.addText("Capable learners,\nnot dependent ones.", { x: MX, y: 1.5, w: 10, h: 2.1, fontFace: HEAD, fontSize: 54, bold: true, color: C.ink, margin: 0, valign: "top", isTextBox: true });
    const team = [["Muhammad Alyan", "Team Lead"], ["Abdullah", "Frontend Developer"], ["Hassan Bin Gheas", "Backend Developer"]];
    team.forEach((t, i) => {
      const x = MX + i * 3.3, y = 3.9;
      card(s, x, y, 3.1, 1.2);
      s.addText([{ text: t[0], options: { fontFace: HEAD, fontSize: 20, bold: true, color: C.ink, breakLine: true } }, { text: t[1], options: { fontFace: BODY, fontSize: 15, color: C.muted } }], { x: x + 0.25, y, w: 2.7, h: 1.2, margin: 0, valign: "middle", isTextBox: true });
    });
    s.addText("Try it: studify-ai-three.vercel.app", { x: MX, y: 5.5, w: 9.5, h: 0.55, fontFace: BODY, fontSize: 26, bold: true, color: C.deep, margin: 0, isTextBox: true });
    s.addText("github.com/HassaanGhayas/Zed_AI", { x: MX, y: 6.12, w: 9.5, h: 0.45, fontFace: BODY, fontSize: 20, bold: true, color: C.deep, margin: 0, isTextBox: true });
    s.addText("Thank you. Questions?", { x: MX, y: 6.6, w: 9, h: 0.4, fontFace: HEAD, fontSize: 18, italic: true, color: C.ink, margin: 0, isTextBox: true });
    s.addNotes("[~15 s] Studify AI exists so learners become more capable, not more dependent. It is live, you can try it now, and we would love your questions. 3-minute cut: slides 1, 3, 4, 5, 9, 11. 5-minute cut: add 2, 6, 7, 8.");
  }

  // ---------- Backup A: evaluator rules ----------
  {
    const s = pres.addSlide();
    base(s, "A", "BACKUP");
    title(s, "Backup: how an answer is graded", { h: 0.8, size: 32 });
    const rows = [
      ["Inputs", "Question, expected concept, chapter summary, transcript excerpt, student answer, attempt number, prior attempts"],
      ["Outputs", "Status, mastery score 0-100, understood / missing / misconceptions, retry question, advance and review flags"],
      ["Attempt 1", "Rephrase the question to guide toward missing concepts"],
      ["Attempt 2", "Narrower question aimed at the identified misconception"],
      ["Attempt 3", "No retry. Flag Needs Review and let the student move on. Never auto-marked correct"],
      ["No Gemini", "Keyword-overlap heuristic evaluator keeps the flow alive"],
    ];
    rows.forEach((r, i) => {
      const y = 1.85 + i * 0.84;
      s.addShape(pres.ShapeType.roundRect, { x: MX, y, w: 2.0, h: 0.68, rectRadius: 0.1, fill: { color: C.tint }, line: { color: C.tint } });
      s.addText(r[0], { x: MX, y, w: 2.0, h: 0.68, fontFace: HEAD, fontSize: 17, bold: true, color: C.deep, align: "center", valign: "middle", margin: 0, isTextBox: true });
      s.addText(r[1], { x: MX + 2.3, y, w: W - 2 * MX - 2.3, h: 0.68, fontFace: BODY, fontSize: 16, color: C.ink, valign: "middle", margin: 0, isTextBox: true });
    });
    s.addNotes("Backup for Q&A on the evaluator.");
  }

  // ---------- Backup B: API surface ----------
  {
    const s = pres.addSlide();
    base(s, "B", "BACKUP");
    title(s, "Backup: API surface and resilience", { h: 0.8, size: 32 });
    const hdr = (t) => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.deep }, fontFace: BODY, fontSize: 15 } });
    const cell = (t, b) => ({ text: t, options: { fontFace: BODY, fontSize: 14, color: C.ink, bold: !!b } });
    const rowsT = [
      [hdr("Endpoint"), hdr("What it does")],
      [cell("POST /api/video/process", 1), cell("URL to captions to 3-6 chapters with questions")],
      [cell("POST /api/qa/evaluate", 1), cell("Socratic grading with adaptive follow-up")],
      [cell("POST /api/video/explain-frame", 1), cell("Gemini vision on the paused frame")],
      [cell("POST /api/video/segment-visual", 1), cell("Key frame analysis plus a flashcard")],
      [cell("POST /api/voice/transcribe", 1), cell("Spoken answer to text")],
      [cell("POST /api/notes/generate | download-pdf", 1), cell("Personalised notes, then themed PDF")],
    ];
    s.addTable(rowsT, { x: MX, y: 1.9, w: 7.6, colW: [3.8, 3.8], border: { type: "solid", color: C.line, pt: 1 }, fill: { color: C.white }, rowH: 0.62, margin: 0.1 });
    card(s, 8.6, 1.9, W - MX - 8.6, 4.3, C.tint);
    s.addText([
      { text: "Resilience", options: { fontFace: HEAD, fontSize: 20, bold: true, color: C.deep, breakLine: true, paraSpaceAfter: 8 } },
      { text: "3-model Gemini fallback chain", options: { bullet: true, breakLine: true, paraSpaceAfter: 6 } },
      { text: "Timeline repair for hallucinated timestamps", options: { bullet: true, breakLine: true, paraSpaceAfter: 6 } },
      { text: "Transcript cache, retries, best caption track", options: { bullet: true, breakLine: true, paraSpaceAfter: 6 } },
      { text: "Heuristic chaptering, grading, and notes", options: { bullet: true } },
    ], { x: 8.9, y: 2.1, w: W - MX - 8.6 - 0.6, h: 3.9, fontFace: BODY, fontSize: 16, color: C.ink, margin: 0, valign: "top", isTextBox: true });
    s.addNotes("Backup for Q&A on architecture.");
  }

  await pres.writeFile({ fileName: path.join(__dirname, "Studify_AI_Pitch.pptx") });
  console.log("wrote Studify_AI_Pitch.pptx");
})().catch((e) => { console.error(e); process.exit(1); });
