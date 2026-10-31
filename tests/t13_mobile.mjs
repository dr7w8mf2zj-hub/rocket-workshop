// Mobile test (touch emulation): inventory touch-drag, flight touch controls layout, no errors/404s. usage: node tests/t13_mobile.mjs
import { launch, BASE } from './browser.mjs';
const res = []; const ok = (n, c, x = '') => { res.push(!!c); console.log(c ? 'PASS' : 'FAIL', n, x); };
for (const [tag, vp] of [['land', { width: 844, height: 390 }], ['port', { width: 390, height: 844 }]]) {
  const { browser, ctx, page, logs, fails, reqs } = await launch({ context: { viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } });
  await page.goto(BASE + 'index.html?touch=1&shot=1'); await page.waitForFunction(() => window.__app && (window.__app.ready || window.__app.errors.length), null, { timeout: 90000 });
  console.log('==', tag, JSON.stringify(vp), await page.evaluate(() => ({ lod: window.__app.texLod, q: window.__app.settings.quality, coarse: matchMedia('(pointer: coarse)').matches })));
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await page.screenshot({ path: `/workspace/shots/mob_${tag}_editor.png` });
  await page.tap('#mobileBtns [data-open="inventory"]'); await page.waitForTimeout(500);
  await page.screenshot({ path: `/workspace/shots/mob_${tag}_inventory.png` });
  const before = await page.evaluate(() => window.__app.design.parts.size);
  const g = await page.locator('.card[data-type="liquid_engine"] .grip').boundingBox();
  await touch('touchStart', g.x + g.width / 2, g.y + g.height / 2);
  const tx = vp.width * 0.75, ty = vp.height * 0.4;
  for (let i = 1; i <= 12; i++) { await touch('touchMove', g.x + (tx - g.x) * i / 12, g.y + (ty - g.y) * i / 12); await page.waitForTimeout(40); }
  await touch('touchEnd'); await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__app.design.parts.size);
  ok(tag + ' touch-drag from inventory adds a part', after === before + 1, `${before}->${after}`);
  // tap on card adds too
  await page.tap('#mobileBtns [data-open="inventory"]').catch(() => {}); await page.waitForTimeout(400);
  const c2 = page.locator('.card[data-type="fuel_tank"]'); if (await c2.count()) { await c2.first().tap(); await page.waitForTimeout(400); ok(tag + ' tap card adds', (await page.evaluate(() => window.__app.design.parts.size)) === after + 1); }
  // flight
  await page.evaluate(() => { const a = window.__app; a.loadTemplate('Falcon 9 (Dragon, landing booster)'); }); await page.waitForTimeout(300);
  await page.screenshot({ path: `/workspace/shots/mob_${tag}_falcon_editor.png` });
  await page.evaluate(() => { const a = window.__app; a.launch(); }); await page.waitForTimeout(1500);
  await page.screenshot({ path: `/workspace/shots/mob_${tag}_flight_pad.png` });
  const lay = await page.evaluate(() => { const vis = [...document.querySelectorAll('#touchBtns button')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return { id: b.id, x: r.x, y: r.y, w: r.width, h: r.height }; }); const bad = vis.filter(r => r.x < -1 || r.y < -1 || r.x + r.w > innerWidth + 1 || r.y + r.h > innerHeight + 1); let ov = []; for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) { const a = vis[i], b = vis[j]; if (a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) ov.push(a.id + '/' + b.id); } return { n: vis.length, bad: bad.map(b => b.id), ov, minSize: Math.min(...vis.map(v => Math.min(v.w, v.h))) }; });
  ok(tag + ' touch buttons inside viewport & not overlapping', lay.bad.length === 0 && lay.ov.length === 0, JSON.stringify(lay));
  await page.tap('#goLaunch'); await page.waitForTimeout(300); await page.waitForTimeout(2500);
  const st = await page.evaluate(() => ({ state: window.__app.flight.state, thr: window.__app.flight.phys.telemetry().thrust }));
  ok(tag + ' STAGE tap ignites', st.state === 'flying' || st.thr > 0 || st.state === 'countdown', JSON.stringify(st));
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `/workspace/shots/mob_${tag}_flight_ascent.png` });
  const bad = reqs.filter(([s]) => s >= 400);
  ok(tag + ' no console errors / 404s', logs.length === 0 && bad.length === 0 && fails.length === 0, JSON.stringify({ logs, bad, fails, errs: await page.evaluate(() => window.__app.errors) }).slice(0, 300));
  await browser.close();
}
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL');
