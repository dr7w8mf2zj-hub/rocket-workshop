import { launch, BASE } from './browser.mjs';
const { browser, page } = await launch({ context: { viewport: { width: 640, height: 400 } } });
await page.goto(BASE + 'index.html?shot=1');
await page.waitForFunction(() => window.__app && (window.__app.ready || window.__app.errors.length), null, { timeout: 90000 });
for (const shield of [false, true]) console.log(shield, await page.evaluate(async (shield) => {
  const a = window.__app; a.loadTemplate('Atlas-II (two stage)');
  if (shield) { // add a heat shield under the pod's decoupler? simply attach below the engine of stage 2 not possible; add to bottom of the main root via quickAdd
    const ws = a.workshop; const eng = [...a.design.parts.values()].filter(p => p.type === 'liquid_engine_vac')[0]; ws.select(eng.id); ws.quickAdd('heat_shield'); }
  a.launch(); a.mode = 'manual'; const f = a.flight, p = f.phys; f.startCountdown(0.05); p.inputs.sas = true; let t = 0; const evs = []; let maxHeat = 0, maxQ = 0, minParts = 99;
  const orig = f.handleEvent.bind(f); f.handleEvent = (ev) => { if (ev.t === 'explosion' || ev.t === 'log') evs.push([+t.toFixed(0), ev.t, ev.reason || ev.msg]); orig(ev); }; let lastStage = -9;
  for (let i = 0; i < 30 * 700; i++) { f.update(1 / 20, 640, 400); t += 1 / 20; const tel = p.telemetry(); if (!tel) break; maxHeat = Math.max(maxHeat, tel.heat); maxQ = Math.max(maxQ, tel.q); minParts = Math.min(minParts, tel.parts);
    if (f.state === 'flying' && tel.thrust < 1 && tel.stage < tel.stageCount - 1 && t - lastStage > 2 && tel.altitude > 100) { p.activateStage(); lastStage = t; }
    if (tel.landed && t > 30) break; }
  const tel = p.telemetry(); return JSON.stringify({ t: +t.toFixed(0), maxHeat: +maxHeat.toFixed(2), maxQkPa: +(maxQ / 1000).toFixed(1), parts: tel && tel.parts, minParts, evs: evs.slice(0, 12), alive: !!tel });
}, shield));
await browser.close();
