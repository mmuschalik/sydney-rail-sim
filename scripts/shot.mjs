// Usage: node scripts/shot.mjs <url> <out.png> [waitMs] [width] [height]
// Captures a screenshot of a page using the locally installed Google Chrome (WebGL via ANGLE/Metal).
import puppeteer from 'puppeteer-core';
const [url, out, wait = '4000', w = '1600', h = '900'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await new Promise((r) => setTimeout(r, +wait));
await page.screenshot({ path: out });
if (process.env.EVAL) console.log('EVAL:', JSON.stringify(await page.evaluate(process.env.EVAL)));
console.log(logs.slice(-40).join('\n'));
await browser.close();
