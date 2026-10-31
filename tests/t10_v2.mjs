// New example rockets: editor view, pad, ascent, staging, booster landing. usage: node tests/t10_v2.mjs [nameFragment]
import { launch, BASE } from './browser.mjs';
const only = (process.argv[2] || '').toLowerCase();
const { browser, page, logs } = await launch({ context: { viewport: { width: 1280, height: 720 } } });
await page.goto(BASE + 'index.html?shot=1');
await page.waitForFunction(() => window.__app && (window.__app.ready || window.__app.errors.length), null, { timeout: 90000 });
const names = await page.evaluate(() => window.__app.templateNames);
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
const shot = async (file) => { await page.evaluate(() => window.__app.flight.render()); await page.screenshot({ path: `/workspace/shots/${file}.png` }); };
for (const name of names.filter(n => /falcon|starship/i.test(n) && n.toLowerCase().includes(only))) {
  const sl = slug(name);
  await page.evaluate((n) => { const a = window.__app; a.loadTemplate(n); a.workshop.frame(); }, name); await page.waitForTimeout(400);
  await page.screenshot({ path: `/workspace/shots/v2_${sl}_editor.png` });
  const info = await page.evaluate(() => { const a = window.__app; return { v: a.design.validate().map(v => v.level + ':' + v.msg), stats: a.design.stats(), parts: a.design.parts.size }; });
  console.log('==', name, JSON.stringify(info).slice(0, 700));
  await page.evaluate(() => { const a = window.__app; a.launch(); a.mode = 'manual'; const f = a.flight, p = f.phys; f.startCountdown(0.05); p.inputs.sas = true; window.__t = 0; window.__ev = []; const o = f.handleEvent.bind(f); f.handleEvent = (ev) => { if (ev.t !== 'explosion' || true) window.__ev.push({ t: +window.__t.toFixed(1), e: ev.t, m: ev.msg, r: ev.reason, f: ev.fired }); o(ev); }; });
  await page.evaluate(() => { const f = window.__app.flight; f.update(1 / 30, 1280, 720); f.rig.dist = Math.max(f.rig.dist, 30); });
  await shot(`v2_${sl}_pad`);
  const adv = (cond, max = 30 * 700) => page.evaluate(([cond, max]) => { const a = window.__app, f = a.flight, p = f.phys; const fn = new Function('p', 'f', 't', 'return ' + cond); for (let i = 0; i < max; i++) { f.update(1 / 30, 1280, 720); window.__t += 1 / 30; if (fn(p, f, window.__t)) return { ok: true, t: +window.__t.toFixed(1) }; } return { ok: false, t: +window.__t.toFixed(1) }; }, [cond, max]);
  console.log('liftoff', await adv('p.telemetry().altitude > 30 && f.state === "flying"')); await page.evaluate(() => { window.__app.flight.rig.dist = 40; }); await shot(`v2_${sl}_liftoff`);
  console.log('ascent', await adv('p.telemetry().altitude > 4000')); await shot(`v2_${sl}_ascent`);
  console.log('stage', await adv('p.bodies.length > 1')); console.log(' +1.5s'); await adv('t > ' + (await page.evaluate(() => window.__t)) + ' + 1.5', 200); await shot(`v2_${sl}_staging`);
  console.log('after', JSON.stringify(await page.evaluate(() => { const p = window.__app.flight.phys; return p.bodies.map(b => ({ n: b.name, parts: b.parts.length, rec: b.recoverable, al: b.autoland, ctl: b.hasControl, active: b === p.active })); })));
  // watch booster: switch camera control to the booster
  await page.evaluate(() => { const p = window.__app.flight.phys; const b = p.bodies.find(x => x.recoverable); if (b) { p.switchActive(); } });
  console.log('burn', await adv('p.active.apBurn || !p.active.autoland')); await page.evaluate(() => { const f = window.__app.flight; f.rig.dist = 45; }); await shot(`v2_${sl}_landing_burn`);
  console.log('near ground', await adv('p.active.clearance < 25 || !p.active.autoland')); await shot(`v2_${sl}_landing_near`);
  console.log('touch', await adv('!p.active.autoland && p.active.contactCount > 0', 30 * 120)); await adv('t > 0', 60);
  const fin = await page.evaluate(() => { const p = window.__app.flight.phys; const b = p.active; return { parts: b.parts.length, landed: b.landed, vy: +b.vel.y.toFixed(2), alt: +b.pos.y.toFixed(2), errs: window.__app.errors, events: window.__ev.filter(e => e.e !== 'liftoff').slice(0, 30) }; });
  console.log('final', JSON.stringify(fin)); await shot(`v2_${sl}_landed`);
  await page.evaluate(() => window.__app.backToEditor());
}
console.log('console', logs); await browser.close();
