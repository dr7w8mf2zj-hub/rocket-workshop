// Admin / debug console (separate page). Talks to the game tab in the same browser via BroadcastChannel; see js/adminbridge.js.
// Only a salted PBKDF2-SHA256 hash of the passcode is stored here. Client-side only: NOT real security.
const CFG = {"salt": "47e28e22fda137313c8ddedcb0a0c08c", "hash": "4de3d846004d0e37aa91574f5e67c60a4f25dcf64aecbac2233f049ffed29279", "iter": 250000};
const CHANNEL = 'rw-admin-v1', SESSION_KEY = 'rw.admin.session', FAIL_KEY = 'rw.admin.fail';
const $ = (s) => document.querySelector(s); const hex = (b) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));

async function check(pw) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(CFG.salt), iterations: CFG.iter, hash: 'SHA-256' }, key, 256);
  const a = hex(bits), b = CFG.hash; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 && a.length === b.length;
}
const rd = (k, f) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? f; } catch (e) { return f; } };
const session = () => { const s = rd(SESSION_KEY, null); return s && s.exp > Date.now() ? s : null; };
function lockMsg() { const f = rd(FAIL_KEY, { n: 0, until: 0 }); return f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }

async function tryLogin() {
  const left = lockMsg(); if (left) { $('#lmsg').textContent = 'Too many attempts. Wait ' + left + ' s.'; return; }
  $('#lmsg').textContent = 'Checking…'; const pw = $('#pw').value; $('#pw').value = '';
  let ok = false; try { ok = await check(pw); } catch (e) { $('#lmsg').textContent = 'WebCrypto unavailable (needs https or localhost).'; return; }
  if (ok) { const t = hex(crypto.getRandomValues(new Uint8Array(16))); localStorage.setItem(SESSION_KEY, JSON.stringify({ token: t, exp: Date.now() + 4 * 3600e3 })); localStorage.removeItem(FAIL_KEY); start(); }
  else { const f = rd(FAIL_KEY, { n: 0, until: 0 }); f.n++; if (f.n >= 5) { f.until = Date.now() + 30000 * Math.min(8, f.n - 4); } localStorage.setItem(FAIL_KEY, JSON.stringify(f)); await new Promise(r => setTimeout(r, 1200)); $('#lmsg').textContent = 'Wrong passcode.' + (f.until ? ' Locked for a while.' : ''); }
}
$('#go').onclick = tryLogin; $('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
if (session()) start();

function start() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  const ch = new BroadcastChannel(CHANNEL); const tok = () => (session() || {}).token; let last = null, lastSeen = 0, seq = 0; const pend = new Map();
  const log = (m, bad) => { const el = $('#log'); el.textContent += (bad ? '✗ ' : '• ') + m + '\n'; el.scrollTop = el.scrollHeight; };
  const send = (cmd, args = {}) => { if (!session()) { location.reload(); return; } const id = ++seq; ch.postMessage({ t: 'cmd', id, token: tok(), cmd, args }); pend.set(id, cmd); setTimeout(() => { if (pend.has(id)) { pend.delete(id); log(cmd + ': no reply (is the game open in another tab?)', true); } }, 2500); };
  ch.onmessage = (e) => { const m = e.data || {};
    if (m.t === 'ack') { pend.delete(m.id); log(m.msg, !m.ok); }
    else if (m.t === 'stats') { last = m.s; lastSeen = Date.now(); render(); } else if (m.t === 'here') { lastSeen = Date.now(); } };
  setInterval(() => { if (!session()) { location.reload(); return; } ch.postMessage({ t: 'hello' }); ch.postMessage({ t: 'ping', token: tok() }); const ok = Date.now() - lastSeen < 3000; $('#conn').textContent = ok ? 'game connected' : 'game not found'; $('#conn').className = 'pill ' + (ok ? 'ok' : 'bad'); }, 1000);
  ch.postMessage({ t: 'hello' }); ch.postMessage({ t: 'ping', token: tok() });
  const f = (x, d = 0) => Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
  const kv = (el, rows) => { el.innerHTML = rows.map(([k, v]) => '<span>' + k + '</span><b>' + v + '</b>').join(''); };
  function render() { const s = last; if (!s) return; $('#st').textContent = s.mode + (s.state ? ' · ' + s.state : ''); $('#st').className = 'pill ' + (s.state === 'flying' ? 'ok' : 'wn');
    kv($('#perf'), [['FPS', f(s.fps, 0)], ['Game-loop ms (update+render)', f(s.frameMs, 1)], ['Physics ms / frame', f(s.physMs, 2)], ['Physics steps/s', f(s.stepsPerSec, 0)], ['Total steps', f(s.steps)], ['Sim time (s)', f(s.simTime, 1)], ['Time scale', f(s.timeScale, 2) + '×'],
      ['Draw calls', f(s.draws)], ['Triangles', f(s.tris)], ['Geometries / textures', f(s.geos) + ' / ' + f(s.texs)], ['Smoke / fire particles', f(s.smoke) + ' / ' + f(s.fire)], ['JS heap (MB)', s.heapMB == null ? 'n/a' : f(s.heapMB, 0)], ['Pixel ratio', f(s.dpr, 2)], ['Viewport', s.viewport], ['Quality / texture LOD', s.quality + ' / ' + (s.texLod ? 'half-res' : 'full')], ['Errors logged', f(s.errors)]]);
    kv($('#objs'), [['Rigid bodies', f(s.bodies)], ['Parts (all bodies)', f(s.parts)], ['Debris bodies', f(s.debris)], ['Spawned bodies', f(s.extras)], ['Recoverable stages', f(s.recoverable)], ['Sleeping bodies', f(s.asleep)], ['Paused', s.paused ? 'yes' : 'no']]);
    const t = s.tel; kv($('#veh'), t ? [['Vehicle', t.vehicle], ['Altitude', f(t.alt) + ' m'], ['Radar alt', f(t.radar) + ' m'], ['Speed', f(t.speed, 1) + ' m/s'], ['Vertical', f(t.vspeed, 1) + ' m/s'], ['Mass', f(t.mass) + ' kg'], ['Thrust', f(t.thrust / 1000) + ' kN'], ['TWR', f(t.twr, 2)], ['Propellant', f(t.fuel) + ' kg'], ['Gravity', f(t.g, 2)], ['Dyn. pressure', f(t.q / 1000, 1) + ' kPa'], ['SAS', t.sas ? t.sasMode : 'off'], ['Auto-land', t.autoland ? 'on' : 'off'], ['Controllable vehicles', t.controllable]] : [['No active vehicle', 'open a flight']]);
    kv($('#prog'), [['Highest altitude', f(s.progress.maxAlt) + ' m'], ['Advanced parts', s.unlocked ? 'unlocked' : 'locked']]);
    for (const b of document.querySelectorAll('[data-cheat]')) b.classList.toggle('on', !!s.cheats[b.dataset.cheat]);
    for (const b of document.querySelectorAll('[data-viz]')) b.classList.toggle('on', !!s.flags[b.dataset.viz]);
    if (!$('#ex').options.length) { for (const n of s.examples) $('#ex').add(new Option(n, n)); }
    const sync = (id, v, d, suf = '') => { const el = $('#' + id); if (document.activeElement !== el) el.value = v; $('#' + id + 'v').textContent = (+el.value).toFixed(d) + suf; };
    sync('ts', s.settings.timeScale, 1, '×'); sync('g0', s.settings.g0, 1); sync('atm', s.settings.atmosphere, 2); sync('sh', s.settings.scaleHeight, 0); sync('wind', s.settings.wind, 0);
    if (document.activeElement !== $('#q')) $('#q').value = s.quality; }
  for (const b of document.querySelectorAll('[data-cheat]')) b.onclick = () => send('cheat', { key: b.dataset.cheat, value: !(last && last.cheats[b.dataset.cheat]) });
  for (const b of document.querySelectorAll('[data-viz]')) b.onclick = () => send('viz', { key: b.dataset.viz, value: !(last && last.flags[b.dataset.viz]) });
  const slider = (id, key) => { $('#' + id).oninput = (e) => send('setting', { key, value: e.target.value }); };
  slider('ts', 'timeScale'); slider('g0', 'g0'); slider('atm', 'atmosphere'); slider('sh', 'scaleHeight'); slider('wind', 'wind');
  const PRE = { earth: { g0: 9.81, atmosphere: 1, scaleHeight: 7500, wind: 0 }, moon: { g0: 1.62, atmosphere: 0, scaleHeight: 7500, wind: 0 }, mars: { g0: 3.71, atmosphere: 0.015, scaleHeight: 11000, wind: 0 }, zero: { g0: 0, atmosphere: 1, scaleHeight: 7500, wind: 0 }, vac: { g0: 9.81, atmosphere: 0, scaleHeight: 7500, wind: 0 } };
  for (const b of document.querySelectorAll('[data-pre]')) b.onclick = () => { for (const [k, v] of Object.entries(PRE[b.dataset.pre])) send('setting', { key: k, value: v }); };
  $('#tp').onclick = () => send('teleport', { alt: +$('#alt').value, zeroVel: $('#zv').checked }); for (const b of document.querySelectorAll('[data-alt]')) b.onclick = () => { $('#alt').value = b.dataset.alt; $('#tp').click(); };
  $('#spawn').onclick = () => send('spawn', { name: $('#ex').value, alt: +$('#salt').value });
  $('#refuel').onclick = () => send('refuel'); $('#clear').onclick = () => send('clearDebris'); $('#launch').onclick = () => send('launchNow'); $('#pauseB').onclick = () => send('pause', { value: !(last && last.paused) });
  $('#unlock').onclick = () => send('unlockAll'); $('#relock').onclick = () => send('relock'); $('#q').onchange = (e) => send('quality', { value: e.target.value });
  $('#reset').onclick = () => { if ($('#rst').value.trim() === 'RESET') { send('resetSave'); $('#rst').value = ''; } else log('Type RESET in the box first to confirm.', true); };
  $('#lock').onclick = () => { localStorage.removeItem(SESSION_KEY); location.reload(); };
  log('Console unlocked. Open the game in another tab of this browser.');
}
