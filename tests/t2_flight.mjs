import { launch, BASE } from './browser.mjs';
const mobile = process.argv[2] === 'mobile';
const opts = mobile ? { context: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } } : {};
const { browser, page, logs, fails, reqs } = await launch(opts);
const tag = mobile ? 'mobile' : 'desktop';
await page.goto(BASE + 'index.html?shot=1' + (mobile ? '&touch=1' : ''));
await page.waitForFunction(() => window.__app && (window.__app.ready || window.__app.errors.length), null, { timeout: 90000 });
if (mobile) await page.screenshot({ path: `/workspace/shots/editor_${tag}.png` });
await page.evaluate(() => window.__app.launch());
await page.waitForTimeout(2000);
await page.screenshot({ path: `/workspace/shots/prelaunch_${tag}.png` });
await page.evaluate(() => { const a = window.__app; a.flight.startCountdown(3); });
const tel = async () => page.evaluate(() => { const f = window.__app.flight; const t = f.phys.telemetry(); return { state: f.state, alt: +t.altitude.toFixed(1), v: +t.speed.toFixed(1), fuel: +(t.liquid + t.solid).toFixed(0), thr: +t.thrust.toFixed(0), stage: t.stage, bodies: t.bodies, mass: +t.mass.toFixed(0), clock: +f.clock.toFixed(1), errs: window.__app.errors.slice(0, 3) }; });
for (let i = 0; i < 10; i++) { await page.waitForTimeout(2500); console.log(i, JSON.stringify(await tel())); if (i === 3) await page.screenshot({ path: `/workspace/shots/flight_${tag}.png` }); }
await page.screenshot({ path: `/workspace/shots/flight2_${tag}.png` });
console.log('errors', await page.evaluate(() => window.__app.errors)); console.log('logs', logs.slice(0, 10), fails); console.log('bad', reqs.filter(r => r[0] >= 400));
await browser.close();
