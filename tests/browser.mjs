// Headless browser harness. usage: node tests/browser.mjs <script-name>
import { createRequire } from 'module'; const require = createRequire('/workspace/rt/');
const { chromium } = require('playwright-core');
export async function launch(opts = {}) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await browser.newContext(opts.context || { viewport: { width: 1366, height: 800 } });
  const page = await ctx.newPage(); const logs = [], fails = [], reqs = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  page.on('requestfailed', r => fails.push('FAILED ' + r.url()));
  page.on('response', r => { reqs.push([r.status(), r.url()]); });
  return { browser, ctx, page, logs, fails, reqs };
}
export const BASE = process.env.BASE || 'http://127.0.0.1:8123/';
