import { launch, BASE } from './browser.mjs';
const { browser, page, logs } = await launch({ context: { viewport: { width: 960, height: 540 } } });
await page.goto(BASE + 'index.html?shot=1');
await page.waitForFunction(() => window.__app && (window.__app.ready || window.__app.errors.length), null, { timeout: 90000 });
for (const [name, mode] of [['Pocket Hopper (tiny)', 'chute'], ['Lark-1 (single stage)', 'chute'], ['Lark-1 (single stage)', 'nochute']]) {
  const res = await page.evaluate(async ([name, mode]) => {
    const a = window.__app; a.loadTemplate(name); a.launch(); a.mode = 'manual'; const f = a.flight, p = f.phys; f.startCountdown(0.05); p.inputs.sas = true; const evs = []; let t = 0;
    const orig = f.handleEvent.bind(f); f.handleEvent = (ev) => { if (ev.t !== 'explosion' || true) evs.push({ t: +t.toFixed(1), e: ev.t, r: ev.reason, m: ev.msg }); orig(ev); };
    let phase = 'up', maxAlt = 0, chuteT = null, shot = false; const log = [];
    for (let i = 0; i < 30 * 400; i++) {
      f.update(1 / 30, 960, 540); t += 1 / 30; const tel = p.telemetry(); if (!tel) break; maxAlt = Math.max(maxAlt, tel.altitude);
      if (phase === 'up' && f.state === 'flying' && (tel.altitude > 600 || tel.liquid + tel.solid < 1)) { p.inputs.throttle = 0; phase = 'coast'; }
      if (phase === 'coast' && tel.vspeed < -20 && tel.radar < 3500 && mode === 'chute') { p.deployAllChutes(); phase = 'chute'; chuteT = t; }
      if (i % 300 === 0) log.push([+t.toFixed(0), +tel.altitude.toFixed(0), +tel.vspeed.toFixed(0), phase, tel.parts, +tel.heat.toFixed(2)]);
      if (phase === 'chute' && !shot && t - chuteT > 8) { shot = true; f.render(); window.__shot1 = true; }
      if (tel.landed && f.state === 'flying' && t > 15) { phase = 'landed'; for (let k = 0; k < 90; k++) f.update(1 / 30, 960, 540); break; }
    }
    const tel = p.telemetry(); return { name, mode, t: +t.toFixed(1), maxAlt: +maxAlt.toFixed(0), landed: tel && tel.landed, parts: tel && tel.parts, v: tel && +tel.speed.toFixed(2), log, evs: evs.filter(e => e.e !== 'liftoff'), errs: a.errors };
  }, [name, mode]);
  console.log(JSON.stringify(res).slice(0, 2500));
  await page.evaluate(() => { window.__app.flight.render(); }); await page.screenshot({ path: `/workspace/shots/land_${name.slice(0, 4)}_${mode}.png` });
  await page.evaluate(() => window.__app.backToEditor());
}
console.log(logs); await browser.close();
