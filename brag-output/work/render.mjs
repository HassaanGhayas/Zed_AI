import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire('D:/ZED_AI/frontend/package.json');
const puppeteer = require('puppeteer-core');

const FPS = 30;
const DUR = 22;
const dir = 'D:/ZED_AI/brag-output/work';
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;

const browser = await puppeteer.launch({
  headless: true, pipe: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--no-sandbox', '--allow-file-access-from-files', '--force-device-scale-factor=1'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(dir, 'scene.html')).href);
await page.waitForFunction('window.ready === true');
const frames = only ?? Array.from({ length: FPS * DUR }, (_, i) => i);
for (const i of frames) {
  await page.evaluate((t) => window.render(t), i / FPS);
  await page.screenshot({ path: `${dir}/frames/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 93 });
}
await browser.close();
console.log('done', frames.length);
