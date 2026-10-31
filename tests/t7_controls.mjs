import { launch, BASE } from './browser.mjs';
const mobile = process.argv[2] === 'mobile';
const { browser, page, logs, fails, reqs } = await launch(mobile ? { context: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } } : { context: { viewport: { width: 1280, height: 720 } } });
await page.goto(BASE + 'index.html?shot=1' + (mobile ? '&touch=1' : ''));
await page.waitForFunction(() => window.__app && (window.__app.ready || window.__app.errors.length), null, { timeout: 90000 });
const R = []; const ok = (n, c, x = '') => { R.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const tel = () => page.evaluate(() => { const f = window.__app.flight; const t = f.phys.telemetry(); return { state: f.state, alt: t.altitude, thr: t.throttle, stage: t.stage, sas: t.sas, rcs: t.rcs, pitchIn: f.phys.inputs.pitch, yawIn: f.phys.inputs.yaw, rollIn: f.phys.inputs.roll, cam: f.camMode, paused: f.paused, fuel: t.liquid, vs: t.vspeed }; });
await page.evaluate(() => { window.__app.loadTemplate('Atlas-II (two stage)'); });
await page.evaluate(() => window.__app.launch()); await page.waitForTimeout(800);
// slow the sim: shrink canvas for speed
if (mobile) { await page.tap('#goLaunch'); } else { await page.keyboard.press('Space'); }
await page.waitForTimeout(500); let t = await tel(); ok('countdown starts', t.state === 'countdown', t.state);
await page.waitForFunction(() => window.__app.flight.state === 'flying', null, { timeout: 60000 });
t = await tel(); ok('ignition -> flying', t.state === 'flying'); ok('throttle set on ignition', t.thr > 0.5, t.thr);
// throttle down
if (mobile) { const b = await page.locator('#thr').boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height * 0.6); } else { await page.keyboard.down('Control'); await page.waitForTimeout(3500); await page.keyboard.up("Control"); }
await page.waitForTimeout(300); const t2 = await tel(); ok('throttle decreased by input', t2.thr < t.thr - 0.1, `${t.thr.toFixed(2)}->${t2.thr.toFixed(2)}`);
if (mobile) await page.tap('#bFull'); else await page.keyboard.press('KeyZ'); await page.waitForTimeout(300); t = await tel(); ok('full throttle', t.thr > 0.99);
// attitude inputs
if (mobile) { const j = await page.locator('#joy').boundingBox(); const cx = j.x + j.width / 2, cy = j.y + j.height / 2;
  await page.evaluate(([x, y]) => { const el = document.querySelector('#joy'); const mk = (type, cx, cy) => new PointerEvent(type, { pointerId: 7, clientX: cx, clientY: cy, bubbles: true, pointerType: 'touch' }); el.dispatchEvent(mk('pointerdown', x, y)); el.dispatchEvent(mk('pointermove', x + 40, y - 30)); }, [cx, cy]); }
else { await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD'); }
await page.waitForTimeout(600); t = await tel(); ok('pitch/yaw inputs registered', t.pitchIn > 0.2 && t.yawIn > 0.2, `${t.pitchIn.toFixed(2)},${t.yawIn.toFixed(2)}`);
if (mobile) await page.evaluate(() => { document.querySelector('#joy').dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true })); }); else { await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD'); }
await page.waitForTimeout(500); t = await tel(); ok('inputs release to zero', Math.abs(t.pitchIn) < 0.1 && Math.abs(t.yawIn) < 0.1);
// SAS toggle
if (mobile) await page.tap('#bSas'); else await page.keyboard.press('KeyT'); await page.waitForTimeout(200); const ts = await tel(); if (mobile) await page.tap('#bSas'); else await page.keyboard.press('KeyT'); await page.waitForTimeout(200); const ts2 = await tel(); ok('SAS toggles', ts.sas !== ts2.sas, `${ts.sas}->${ts2.sas}`);
// camera modes
for (const m of ['cockpit', 'free', 'chase']) { if (mobile) await page.tap('#bCam'); else await page.keyboard.press('KeyC'); await page.waitForTimeout(500); const c = (await tel()).cam; ok('camera -> ' + m, c === m, c); if (m === 'cockpit') await page.screenshot({ path: `/workspace/shots/cockpit_${mobile ? 'mobile' : 'desktop'}.png` }); if (m === 'free') await page.screenshot({ path: `/workspace/shots/free_${mobile ? 'mobile' : 'desktop'}.png` }); }
// pause
await page.click('#fPause').catch(async () => { await page.tap('#fPause'); }); await page.waitForTimeout(400); const a1 = await tel(); await page.waitForTimeout(800); const a2 = await tel(); ok('pause freezes flight', a1.paused && Math.abs(a2.alt - a1.alt) < 0.01 && a1.fuel === a2.fuel, `${a1.alt.toFixed(1)} ${a2.alt.toFixed(1)}`);
await page.click('#fPause').catch(async () => { await page.tap('#fPause'); }); await page.waitForTimeout(1200); const a3 = await tel(); ok('resume continues', !a3.paused && a3.alt > a2.alt, `${a3.alt.toFixed(1)}`);
// staging by input: wait for burnout of stage1 is long under swiftshader; stage via input after some time
if (mobile) await page.tap('#bStage'); else await page.keyboard.press('Space'); await page.waitForTimeout(500); const st = await tel(); ok('stage input advances stage', st.stage >= 2, 'stage=' + st.stage);
await page.screenshot({ path: `/workspace/shots/staged_${mobile ? 'mobile' : 'desktop'}.png` });
// reset
await page.click('#fReset').catch(async () => { await page.tap('#fReset'); }); await page.waitForTimeout(800); const rs = await tel(); ok('reset returns to pad', rs.state === 'prelaunch' && rs.alt < 10 && rs.stage === 0, JSON.stringify(rs));
await page.click('#fBack').catch(async () => { await page.tap('#fBack'); }); await page.waitForTimeout(500);
ok('back to workshop', await page.evaluate(() => window.__app.mode === 'editor' && !document.querySelector('#editor').classList.contains('hidden')));
console.log('errors', await page.evaluate(() => window.__app.errors), logs.slice(0, 6), fails, reqs.filter(r => r[0] >= 400));
console.log(R.filter(x => !x).length + ' failures'); await browser.close();
