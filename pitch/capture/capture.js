/* Studify AI pitch screenshot capture.
 * Run: node D:\ZED_AI\pitch\capture\capture.js   (GEMINI_KEY env var optional)
 * Never logs the key. Writes PNGs + capture_report.txt + notes_sample.pdf to ..\assets
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('D:/ZED_AI/frontend/node_modules/puppeteer-core');

const APP = 'http://localhost:5173';
const API = 'http://localhost:8000';
const OUT = path.resolve(__dirname, '..', 'assets');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const KEY = process.env.GEMINI_KEY || '';
const PRESETS = [
  'https://www.youtube.com/watch?v=aircAruvnKk',
  'https://www.youtube.com/watch?v=1S0aBV-Waeo',
  'https://www.youtube.com/watch?v=iHzzSaoMx3E',
];

const report = [];
const log = (name, status, why = '') => {
  report.push(`${status.padEnd(8)} ${name}${why ? '  -- ' + why : ''}`);
  console.log(`${status} ${name}${why ? ' -- ' + why : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (s) => String(s || '').split(KEY && KEY.length > 8 ? KEY : '\u0000').join('***');

async function shot(name, fn) {
  try {
    await fn();
    log(name, 'OK');
  } catch (e) {
    log(name, 'FAILED', safe(e && e.message).split('\n')[0]);
  }
}

// Click first element matching selector whose text matches regex.
async function clickText(page, selector, re, timeout = 15000) {
  const src = re.source, flags = re.flags;
  await page.waitForFunction(
    (sel, s, f) => [...document.querySelectorAll(sel)].some((e) => new RegExp(s, f).test(e.innerText || e.textContent || '') && !e.disabled),
    { timeout }, selector, src, flags);
  await page.evaluate((sel, s, f) => {
    const el = [...document.querySelectorAll(sel)].find((e) => new RegExp(s, f).test(e.innerText || e.textContent || '') && !e.disabled);
    el.scrollIntoView({ block: 'center' });
    el.click();
  }, selector, src, flags);
}

async function hasText(page, re, timeout = 15000) {
  await page.waitForFunction((s, f) => new RegExp(s, f).test(document.body.innerText), { timeout }, re.source, re.flags);
}

async function newPage(browser, w, h, dsf = 1) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dsf });
  await page.evaluateOnNewDocument((key) => {
    try {
      localStorage.setItem('mindflow-theme', 'light');
      localStorage.setItem('mindflow-auto-read', '0');
      if (key) localStorage.setItem('gemini_api_key', key);
      else localStorage.setItem('mindflow-key-hint-dismissed', '1');
    } catch (e) {}
    // Mute speech so headless never narrates
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
  }, KEY);
  return page;
}

async function settle(page, ms = 800) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await sleep(ms);
}

async function startSession(page) {
  for (const url of PRESETS) {
    await page.goto(APP, { waitUntil: 'load', timeout: 90000 });
    await page.evaluate(() => localStorage.removeItem('mindflow-session-v1'));
    await page.reload({ waitUntil: 'load', timeout: 90000 });
    await page.waitForSelector('#youtube-url-input');
    await page.type('#youtube-url-input', url);
    await clickText(page, 'button', /Start Tutor/);
    try {
      await page.waitForFunction(() => /Chapter\s*\d+\s*of\s*\d+/.test(document.body.innerText), { timeout: 120000 });
      return url;
    } catch (e) {
      console.log('preset failed, trying next');
    }
  }
  throw new Error('no preset processed');
}

const getState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mindflow-session-v1') || 'null'));

async function answerCurrent(page, text) {
  await page.waitForSelector('#socratic-answer-textarea', { timeout: 20000 });
  const prev = await page.evaluate(() => [...document.querySelectorAll('[role=alert]')].map((e) => e.innerText).join('|'));
  await page.click('#socratic-answer-textarea');
  await page.evaluate(() => { const t = document.getElementById('socratic-answer-textarea'); t.value = ''; });
  await page.type('#socratic-answer-textarea', text, { delay: 2 });
  await clickText(page, 'button[type=submit]', /Submit/);
  await sleep(500);
  await page.waitForFunction((p) => {
    const t = document.body.innerText;
    const cur = [...document.querySelectorAll('[role=alert]')].map((e) => e.innerText).join('|');
    return /Concept Breakdown/i.test(t) && cur !== p;
  }, { timeout: 120000 }, prev);
  await sleep(1500);
  await waitOpaque(page);
}

// Wait until the feedback card and all ancestors are fully opaque (animations finished).
async function waitOpaque(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('[role=alert]');
    if (!el) return true;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (parseFloat(getComputedStyle(n).opacity) < 0.999) return false;
    }
    return true;
  }, { timeout: 10000 }).catch(() => {});
  await sleep(500);
}

async function closeExplain(page) {
  for (let i = 0; i < 4; i++) {
    const el = await page.$('[aria-label="Close visual explanation"]');
    if (!el) { await sleep(800); if (!(await page.$('[aria-label="Close visual explanation"]'))) return true; continue; }
    await el.click().catch(() => {});
    await sleep(1000);
  }
  return !(await page.$('[aria-label="Close visual explanation"]'));
}

async function enterFs(page) {
  const ok = await page.evaluate(() => {
    const b = document.querySelector('#player-shell [aria-label="Enter full screen"]');
    return !!b;
  });
  if (!ok) return false;
  const btns = await page.$$('#player-shell [aria-label="Enter full screen"]');
  await btns[0].click();
  await sleep(1200);
  return await page.evaluate(() => !!document.fullscreenElement);
}
async function exitFs(page) {
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
  await sleep(500);
}

// Make the paused-quiz overlay fit the screenshot: scroll its inner container to a position.
async function scrollOverlay(page, where) {
  await page.evaluate((w) => {
    const el = document.querySelector('#player-shell .no-scrollbar');
    if (el) el.scrollTop = w === 'bottom' ? el.scrollHeight : 0;
  }, where);
  await sleep(300);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(KEY ? 'Mode: Gemini key supplied' : 'Mode: fallback (no GEMINI_KEY)');
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
    defaultViewport: null,
  });
  let ctx = { qa: null, state: null };
  try {
    const page = await newPage(browser, 1920, 1080);

    // --- Landing ---
    await page.goto(APP, { waitUntil: 'load', timeout: 90000 });
    await page.evaluate(() => localStorage.removeItem('mindflow-session-v1'));
    await page.reload({ waitUntil: 'load', timeout: 90000 });
    await shot('01_landing_hero.png', async () => {
      await page.waitForSelector('#hero h1');
      await settle(page, 1800);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(OUT, '01_landing_hero.png') });
    });
    await shot('02_landing_features.png', async () => {
      const h = await page.evaluateHandle(() => [...document.querySelectorAll('section')].find((s) => s.querySelector('h3') && /Chapters that pace/.test(s.innerText)));
      const el = h.asElement();
      if (!el) throw new Error('feature section not found');
      await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await settle(page, 1800);
      await page.screenshot({ path: path.join(OUT, '02_landing_features.png') });
    });

    // --- Mobile ---
    await shot('10_mobile_390.png', async () => {
      const m = await newPage(browser, 390, 844, 2);
      await m.goto(APP, { waitUntil: 'load', timeout: 90000 });
      await m.evaluate(() => localStorage.removeItem('mindflow-session-v1'));
      await m.reload({ waitUntil: 'load', timeout: 90000 });
      await m.waitForSelector('#hero h1');
      await settle(m, 1800);
      await m.screenshot({ path: path.join(OUT, '10_mobile_390.png') });
      await m.close();
    });

    // --- Workspace ---
    let started = false;
    try {
      const used = await startSession(page);
      started = true;
      console.log('session started with preset index ' + PRESETS.indexOf(used));
    } catch (e) {
      for (const n of ['03_workspace_locked.png', '04_paused_quiz.png', '05_misconception.png', '06_correct_unlock.png', '07_explain_screen.png', '08_progress_dashboard.png', '09_notes_modal.png', 'notes_sample.pdf'])
        log(n, 'FAILED', 'could not start a session: ' + safe(e.message));
    }

    if (started) {
      ctx.state = await getState(page);
      await shot('03_workspace_locked.png', async () => {
        await page.waitForSelector('nav[aria-label="Topic chapters"]');
        // wait for YouTube iframe to render, then pause it so frame is stable
        await page.waitForSelector('#player-shell iframe', { timeout: 30000 }).catch(() => {});
        await sleep(5000);
        await page.evaluate(() => {
          try {
            const id = Object.keys(window).length && document.querySelector('#player-shell iframe').id;
            const p = window.YT.get(id);
            p.seekTo(40, true); p.pauseVideo();
          } catch (e) {}
        });
        await sleep(3500);
        await page.evaluate(() => { document.body.style.zoom = '0.9'; window.scrollTo(0, 0); });
        await settle(page, 500);
        await page.screenshot({ path: path.join(OUT, '03_workspace_locked.png') });
      });

      // Quiz
      let quizOpen = false;
      let fs_ = false;
      await shot('04_paused_quiz.png', async () => {
        await clickText(page, 'button', /Trigger Quiz Check Now/);
        await page.waitForSelector('#socratic-answer-textarea', { timeout: 20000 });
        quizOpen = true;
        await page.evaluate(() => { document.body.style.zoom = '1'; });
        fs_ = await enterFs(page);
        await settle(page, 1000);
        if (!fs_) { await page.evaluate(() => document.getElementById('player-shell').scrollIntoView({ block: 'start' })); await sleep(400); }
        await page.screenshot({ path: path.join(OUT, '04_paused_quiz.png') });
      });

      // Explain screen (needs media_ready)
      let mediaReady = false;
      try {
        const r = await fetch(API + '/api/video/visual/availability');
        mediaReady = !!(await r.json()).media_ready;
      } catch (e) {}
      if (process.env.EXPLAIN !== '1') log('07_explain_screen.png', 'SKIPPED', 'disabled by default: backend explain-frame fails on Windows (charmap codec) and leaves its overlay open');
      else if (!mediaReady) log('07_explain_screen.png', 'SKIPPED', 'visual availability media_ready=false');
      else if (!quizOpen) log('07_explain_screen.png', 'SKIPPED', 'quiz overlay not open');
      else {
        await shot('07_explain_screen.png', async () => {
          await clickText(page, 'button', /Explain screen/);
          await page.waitForFunction(() => {
            const d = document.querySelector('[role=dialog]');
            return d && /Visual Explanation/.test(d.innerText) && !d.querySelector('[role=status]');
          }, { timeout: 120000 });
          await sleep(1500);
          const txt = await page.evaluate(() => document.querySelector('[role=dialog]').innerText);
          if (!/Key concept|On-screen|Diagram|Equations/i.test(txt) && txt.length < 300) {
            const closed = await closeExplain(page);
            throw new Error('explain overlay had no content (overlay closed=' + closed + '): ' + txt.slice(0, 160).replace(/\n/g, ' '));
          }
          await page.screenshot({ path: path.join(OUT, '07_explain_screen.png') });
          console.log('explain closed:', await closeExplain(page));
        });
        // ensure explain dialog closed
      }

      const st0 = await getState(page);
      const seg0 = st0.session.segments[0];
      const q0 = seg0.questions[0];

      // Misconception: deliberately partial/wrong
      await shot('05_misconception.png', async () => {
        if (!quizOpen) throw new Error('quiz overlay not open');
        await answerCurrent(page, 'I think it is basically a digital brain that memorizes every picture it has seen and then looks the answer up, so it just stores the answers.');
        await scrollOverlay(page, 'top');
        if (!fs_) await page.evaluate(() => document.getElementById('player-shell').scrollIntoView({ block: 'start' }));
        await sleep(300);
        await page.screenshot({ path: path.join(OUT, '05_misconception.png') });
      });
      // verdict note
      const verdict = await page.evaluate(() => {
        const t = document.body.innerText;
        return { guided: /Misconception Focus|Guided Follow-Up/.test(t), refinement: /Conceptual Refinement/.test(t), score: (t.match(/Score:\s*\d+\/100/) || [''])[0] };
      });
      console.log('after wrong answer:', JSON.stringify(verdict));

      // Correct answer(s): loop until advance button appears (max attempts)
      await shot('06_correct_unlock.png', async () => {
        const good = `${q0.expected_concept} ${seg0.summary}`.replace(/\s+/g, ' ').slice(0, 700);
        for (let i = 0; i < 3; i++) {
          const done = await page.evaluate(() => !!document.querySelector('#socratic-answer-textarea') === false);
          if (done) break;
          await answerCurrent(page, good);
        }
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Proceed to Next|Advance to Next|Next Question|View Notes/.test(b.innerText)), { timeout: 20000 });
        await scrollOverlay(page, 'top');
        if (!fs_) await page.evaluate(() => document.getElementById('player-shell').scrollIntoView({ block: 'start' }));
        await sleep(400);
        await page.screenshot({ path: path.join(OUT, '06_correct_unlock.png') });
      });

      // Advance through remaining questions of chapter 1, then chapter 2 quiz to get more Q&A
      try {
        for (let guard = 0; guard < 4; guard++) {
          const label = await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')].find((b) => /Proceed to Next|Advance to Next|Next Question/.test(b.innerText));
            return b ? b.innerText : '';
          });
          if (!label) break;
          await clickText(page, 'button', /Proceed to Next|Advance to Next|Next Question/);
          await sleep(1200);
          // if another question in same chapter (overlay still open) answer it
          const open = await page.$('#socratic-answer-textarea');
          if (open) {
            const st = await getState(page);
            const seg = st.session.segments[st.activeSegmentIndex];
            const q = seg.questions[st.activeQuestionIndex] || seg.questions[0];
            await answerCurrent(page, `${q.expected_concept} ${seg.summary}`.replace(/\s+/g, ' ').slice(0, 700));
            continue;
          }
          break;
        }
        // second chapter quiz
        await clickText(page, 'button', /Trigger Quiz Check Now/);
        await page.waitForSelector('#socratic-answer-textarea', { timeout: 20000 });
        const st = await getState(page);
        const seg = st.session.segments[st.activeSegmentIndex];
        const q = seg.questions[st.activeQuestionIndex] || seg.questions[0];
        await answerCurrent(page, `${q.expected_concept} ${seg.summary}`.replace(/\s+/g, ' ').slice(0, 700));
      } catch (e) {
        console.log('extra Q&A step issue: ' + safe(e.message).split('\n')[0]);
      }
      ctx.state = await getState(page);
      console.log('qaHistory length:', (ctx.state && ctx.state.qaHistory || []).length);

      await exitFs(page);
      // Close quiz overlay by reloading (state persists; isPausedForQuiz resets)
      await page.reload({ waitUntil: 'load', timeout: 90000 });
      await page.waitForFunction(() => /Chapter\s*\d+\s*of/.test(document.body.innerText), { timeout: 30000 }).catch(async () => console.log('WARN: workspace not restored after reload; body: ' + (await page.evaluate(() => document.body.innerText.slice(0, 300))).split('\n').join(' ')));
      await sleep(1500);

      await shot('08_progress_dashboard.png', async () => {
        await clickText(page, 'button', /Analytics/);
        await page.waitForSelector('#progress-view-title', { timeout: 15000 });
        await settle(page, 1800);
        await page.screenshot({ path: path.join(OUT, '08_progress_dashboard.png') });
        await page.keyboard.press('Escape');
        await sleep(500);
      });

      await shot('09_notes_modal.png', async () => {
        await clickText(page, 'button', /Notes Preview|Study Notes/);
        await page.waitForSelector('#notes-modal-title', { timeout: 15000 });
        await page.waitForFunction(() => {
          const d = document.querySelector('[role=dialog]');
          return d && !d.querySelector('[class*=animate-pulse]') && d.innerText.length > 400;
        }, { timeout: 120000 });
        await settle(page, 1500);
        await page.screenshot({ path: path.join(OUT, '09_notes_modal.png') });
      });

      // --- PDF ---
      await shot('notes_sample.pdf', async () => {
        const st = ctx.state;
        if (!st || !st.qaHistory.length) throw new Error('no Q&A history to build notes from');
        const hdr = { 'Content-Type': 'application/json' };
        if (KEY) hdr['X-Gemini-Key'] = KEY;
        const gen = await fetch(API + '/api/notes/generate', {
          method: 'POST', headers: hdr,
          body: JSON.stringify({ video_title: st.session.title, video_id: st.session.video_id, segments: st.session.segments, qa_history: st.qaHistory }),
        });
        if (!gen.ok) throw new Error('notes/generate HTTP ' + gen.status);
        const md = (await gen.json()).markdown_notes;
        const keyframes = st.session.segments.filter((s) => s.keyframe_time != null).map((s) => ({ title: s.title, timestamp: s.keyframe_time, caption: (s.visual && s.visual.key_concept) || '' }));
        const pdf = await fetch(API + '/api/notes/download-pdf', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: st.session.title, markdown_content: md, video_id: st.session.video_id, keyframes }),
        });
        if (!pdf.ok) throw new Error('download-pdf HTTP ' + pdf.status);
        fs.writeFileSync(path.join(OUT, 'notes_sample.pdf'), Buffer.from(await pdf.arrayBuffer()));
      });
    }
  } catch (e) {
    log('RUN', 'FAILED', safe(e && e.message).split('\n')[0]);
  } finally {
    await browser.close().catch(() => {});
  }

  // Rasterize PDF
  try {
    const pdfPath = path.join(OUT, 'notes_sample.pdf');
    if (!fs.existsSync(pdfPath)) throw new Error('no pdf');
    const py = path.join(__dirname, 'rasterize.py');
    const r = require('child_process').spawnSync('python', [py, pdfPath, OUT], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').slice(0, 200));
    log('notes_page1.png/notes_page2.png', 'OK', (r.stdout || '').trim());
  } catch (e) {
    log('notes_page1.png/notes_page2.png', 'FAILED', safe(e.message));
  }

  const header = `Studify capture report - ${new Date().toISOString()} - mode: ${KEY ? 'Gemini key' : 'fallback'}\n`;
  fs.writeFileSync(path.join(OUT, 'capture_report.txt'), header + report.join('\n') + '\n');
  process.exit(0);
})();
