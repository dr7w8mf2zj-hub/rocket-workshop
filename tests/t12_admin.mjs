// Admin page test: login (wrong + right), bridge commands against a running game in another tab of the same context. Never prints the passcode.
import fs from 'fs';
import { launch, BASE } from './browser.mjs';
const PW = fs.readFileSync('/workspace/rocket-sim-admin-passcode.txt', 'utf8').trim();
const { browser, ctx, page: game, logs } = await launch({ context: { viewport: { width: 1100, height: 700 } } });
const res = []; const ok = (n, c, x = '') => { res.push([n, !!c]); console.log(c ? 'PASS' : 'FAIL', n, x); };
await game.goto(BASE + 'index.html'); await game.waitForFunction(() => window.__app && window.__app.ready, null, { timeout: 90000 });
ok('game UI has no admin link', !(await game.evaluate(() => document.documentElement.outerHTML.toLowerCase().includes('admin'))));
const admin = await ctx.newPage(); const alogs = []; admin.on('console', m => { if (['error', 'warning'].includes(m.type())) alogs.push(m.text()); }); admin.on('pageerror', e => alogs.push('pageerror ' + e.message));
await admin.goto(BASE + 'admin.html');
ok('login shown, app hidden', await admin.evaluate(() => !document.querySelector('#login').classList.contains('hidden') && document.querySelector('#app').classList.contains('hidden')));
await admin.screenshot({ path: '/workspace/shots/admin_login.png' });
// bridge must refuse without a session
await game.evaluate(() => { window.__acks = []; const c = new BroadcastChannel('rw-admin-v1'); c.onmessage = (e) => { if (e.data.t === 'ack') window.__acks.push(e.data); }; window.__c = c; });
await admin.evaluate(() => { const c = new BroadcastChannel('rw-admin-v1'); c.postMessage({ t: 'cmd', id: 1, token: 'nope', cmd: 'unlockAll', args: {} }); });
await game.waitForTimeout(600); ok('unauthenticated command rejected', await game.evaluate(() => window.__acks.some(a => a.id === 1 && a.ok === false)));
// wrong passcode
await admin.fill('#pw', 'definitely-wrong'); await admin.click('#go'); await admin.waitForFunction(() => /Wrong/.test(document.querySelector('#lmsg').textContent), null, { timeout: 20000 });
ok('wrong passcode rejected', await admin.evaluate(() => document.querySelector('#app').classList.contains('hidden')));
// right passcode
await admin.fill('#pw', PW); await admin.click('#go'); await admin.waitForFunction(() => !document.querySelector('#app').classList.contains('hidden'), null, { timeout: 30000 });
ok('correct passcode unlocks', true);
await admin.waitForFunction(() => document.querySelector('#conn').textContent === 'game connected', null, { timeout: 10000 }).catch(() => {});
ok('connected to game tab', await admin.evaluate(() => document.querySelector('#conn').textContent === 'game connected'));
// start a flight in the game tab
await game.evaluate(() => { window.__app.launch(); });
await game.waitForTimeout(2500);
const stat = async (fn) => admin.evaluate(fn);
await admin.waitForFunction(() => /\d/.test(document.querySelector('#perf')?.innerText || ''), null, { timeout: 10000 }).catch(() => {});
ok('stats render (FPS/physics/objects)', await stat(() => document.querySelector('#perf').innerText.includes('FPS') && document.querySelector('#objs').innerText.includes('Parts')), await stat(() => document.querySelector('#objs').innerText.replace(/\n/g, ' ').slice(0, 120)));
const click = async (sel) => { await admin.click(sel); await admin.waitForTimeout(900); };
await click('[data-cheat="infFuel"]'); ok('infinite fuel toggled', await game.evaluate(() => window.__app.flight.phys.cheats.infFuel === true));
await click('[data-cheat="god"]'); ok('god mode toggled', await game.evaluate(() => window.__app.flight.phys.cheats.god === true));
await admin.evaluate(() => { const e = document.querySelector('#ts'); e.value = 2; e.dispatchEvent(new Event('input', { bubbles: true })); }); await admin.waitForTimeout(800);
ok('time scale setting applied', await game.evaluate(() => window.__app.settings.timeScale === 2));
await admin.evaluate(() => { const e = document.querySelector('#g0'); e.value = 3.7; e.dispatchEvent(new Event('input', { bubbles: true })); }); await admin.waitForTimeout(800);
ok('gravity override applied', await game.evaluate(() => Math.abs(window.__app.flight.phys.settings.g0 - 3.7) < 1e-6));
await admin.fill('#alt', '1500'); await click('#tp'); ok('teleport altitude', await game.evaluate(() => Math.abs(window.__app.flight.phys.active.pos.y - 1500) < 80), await game.evaluate(() => window.__app.flight.phys.active.pos.y.toFixed(0)));
const before = await game.evaluate(() => window.__app.flight.phys.bodies.length);
await admin.selectOption('#ex', { index: 0 }); await click('#spawn'); ok('spawn rocket', await game.evaluate((b) => window.__app.flight.phys.bodies.length > b, before));
for (const k of ['com', 'cop', 'thrust', 'nodes']) { await click(`[data-viz="${k}"]`); }
ok('debug overlays enabled', await game.evaluate(() => Object.values(window.__app.flight.debugFlags).filter(Boolean).length === 4), await game.evaluate(() => JSON.stringify(window.__app.flight.debugFlags)));
await game.waitForTimeout(800); await game.screenshot({ path: '/workspace/shots/admin_game_overlays.png' });
await admin.screenshot({ path: '/workspace/shots/admin_panel.png', fullPage: true });
await click('#unlock'); ok('unlock all', await game.evaluate(() => JSON.parse(localStorage.getItem('rw.progress') || localStorage.getItem('rw.progress.v1') || '{}').unlockAll === true || Object.keys(localStorage).some(k => /progress/.test(k) && localStorage.getItem(k).includes('"unlockAll":true'))));
await click('#clear');
// wrong confirm for reset must not reset
await admin.fill('#rst', 'nope'); await admin.click('#reset'); await admin.waitForTimeout(500); ok('reset needs RESET confirmation', await game.evaluate(() => Object.keys(localStorage).some(k => /progress/.test(k))));
await admin.fill('#rst', 'RESET'); await admin.click('#reset'); await game.waitForTimeout(2500);
await game.waitForFunction(() => window.__app && window.__app.ready, null, { timeout: 60000 }).catch(() => {});
ok('reset save data clears keys', await game.evaluate(() => !Object.keys(localStorage).some(k => /rw\.(progress|designs|design)/.test(k) && localStorage.getItem(k).includes('"unlockAll":true'))));
console.log('game logs', logs, 'admin logs', alogs);
console.log(res.every(r => r[1]) ? 'ALL PASS' : 'SOME FAIL'); await browser.close();
