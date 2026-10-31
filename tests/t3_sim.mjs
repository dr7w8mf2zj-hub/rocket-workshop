import { launch, BASE } from './browser.mjs';
const { browser, page, logs, fails, reqs } = await launch({ context: { viewport: { width: 960, height: 540 } } });
await page.goto(BASE + 'index.html?shot=1');
await page.waitForFunction(() => window.__app && (window.__app.ready || window.__app.errors.length), null, { timeout: 90000 });
const names = await page.evaluate(() => window.__app.templateNames);
console.log(names);
const which = process.argv[2] ? [names[+process.argv[2]]] : names;
for (const name of which) {
  await page.evaluate((n) => { const a = window.__app; a.loadTemplate(n); a.launch(); a.mode = 'manual'; a.flight.startCountdown(0.05); a.log = []; }, name);
  const res = await page.evaluate(async (tag) => {
    const a = window.__app, f = a.flight, p = f.phys; const out = []; let t = 0; let shots = []; let maxAlt = 0; const evs = [];
    const orig = f.handleEvent.bind(f); f.handleEvent = (ev) => { evs.push({ t: +t.toFixed(1), e: ev.t, i: ev.index, f: ev.fired, r: ev.reason, m: ev.msg }); orig(ev); };
    p.inputs.sas = true; let lastStageT = -10;
    for (let i = 0; i < 30 * 220; i++) {
      f.update(1 / 30, 960, 540); t += 1 / 30;
      const tel = p.telemetry(); if (tel) maxAlt = Math.max(maxAlt, tel.altitude);
      if (f.state === 'flying' && tel) {
        if (tel.thrust < 1 && tel.stage < tel.stageCount && t - lastStageT > 1.5 && tel.altitude > 100) { p.activateStage(); lastStageT = t; }
        if (t > 8 && t < 30 && p.inputs) { p.inputs.pitch = 0; }
        // gentle gravity turn: pitch over between 5..40 s via camera-relative yaw towards +x? use SAS target tilt
        if (t > 6 && !a._tilted) { a._tilted = true; p.inputs.yaw = 0.3; setTimeout(() => {}, 0); }
        if (t > 7 && a._tilted && !a._untilted) { a._untilted = true; p.inputs.yaw = 0; }
      }
      if (i % 600 === 0 && tel) out.push({ t: +t.toFixed(0), alt: +tel.altitude.toFixed(0), v: +tel.speed.toFixed(0), fuel: +(tel.liquid + tel.solid).toFixed(0), stage: tel.stage, bodies: tel.bodies, thr: +(tel.thrust / 1000).toFixed(0), pitch: 0 });
      if (i === 30 * 12 || i === 30 * 60) { f.render(); shots.push(i); }
      if (tel && tel.landed && t > 20) { out.push({ landed: t }); break; }
    }
    a._tilted = a._untilted = false;
    return { out, maxAlt, evs: evs.filter(e => e.e !== 'explosion').slice(0, 25), explosions: evs.filter(e => e.e === 'explosion').length, errs: a.errors };
  }, name);
  console.log('==', name); console.log(JSON.stringify(res, null, 0).slice(0, 3500));
  await page.evaluate(() => { const a = window.__app; a.flight.render(); });
  await page.screenshot({ path: `/workspace/shots/sim_${names.indexOf(name)}.png` });
  await page.evaluate(() => { window.__app.backToEditor(); });
}
console.log('logs', logs.slice(0, 10), fails);
await browser.close();
