import { launch, BASE } from './browser.mjs';
const { browser, page, logs } = await launch({ context: { viewport: { width: 700, height: 1000 }, deviceScaleFactor: 2 } });
await page.goto(BASE + 'index.html?shot=1');
await page.waitForFunction(() => window.__app && (window.__app.ready || window.__app.errors.length), null, { timeout: 90000 });
for (const [name, tag] of [['Starship (Super Heavy + Ship)', 'ss'], ['Falcon 9 (Dragon, landing booster)', 'f9']]) {
  await page.evaluate((n) => { const a = window.__app; a.loadTemplate(n); a.workshop.select(null); }, name);
  await page.waitForTimeout(2000);
  await page.evaluate(() => { for (const s of ['#inventory', '#side', '#toolbar', '#toasts', '.toast', '#topbar', '#bottombar', '#statusbar']) document.querySelectorAll(s).forEach(e => e.style.display = 'none'); const r = window.__app.workshop.rig; const b = new window.__app.THREE.Box3(); for (const v of window.__app.workshop.views.values()) b.expandByObject(v.group); r.target.set(0, b.min.y + 1.0, 0); r.dist = 7; r.el = 0.04; r.az = 0.5; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `/workspace/shots/base_${tag}.png` });
}
console.log(logs, await page.evaluate(() => window.__app.errors)); await browser.close();
