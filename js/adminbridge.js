// Game-side half of the admin/debug tooling. The admin UI lives on a SEPARATE page (admin.html) that talks to the running game
// in another tab/window of the SAME browser (same origin) over BroadcastChannel. Nothing in the game UI links to it.
// SECURITY NOTE: this is client-side only. The passcode check happens in admin.html in the user's own browser, so it keeps casual
// players out but is NOT real security (anyone with dev tools can bypass it). It also cannot work across devices.
import { Design } from './design.js';
import { TEMPLATES } from './templates.js';
import { Progress } from './storage.js';

const CHANNEL = 'rw-admin-v1', SESSION_KEY = 'rw.admin.session';
const SETTABLE = new Set(['g0', 'atmosphere', 'scaleHeight', 'wind', 'timeScale']);

export function initAdminBridge(app) {
  if (typeof BroadcastChannel === 'undefined') return null;
  const ch = new BroadcastChannel(CHANNEL); let lastPing = 0; let statTimer = null; let lastSteps = 0, lastT = performance.now(), fps = 0, frames = 0, fpsT = performance.now(), spawnN = 0;
  app.fpsTick = () => { frames++; const n = performance.now(); if (n - fpsT >= 500) { fps = frames * 1000 / (n - fpsT); frames = 0; fpsT = n; } };
  const sessionOk = (token) => { try { const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return !!(s && token && s.token === token && s.exp > Date.now()); } catch (e) { return false; } };
  const f = () => app.flight; const phys = () => app.flight && app.flight.phys;
  const reply = (id, ok, msg, extra) => ch.postMessage({ t: 'ack', id, ok, msg, ...(extra || {}) });

  const commands = {
    cheat(a) { const p = phys(); const v = !!a.value; if (!['infFuel', 'god', 'noHeat'].includes(a.key)) throw new Error('unknown cheat'); app.cheats = app.cheats || {}; app.cheats[a.key] = v; if (f()) { f().pendingCheats = { ...(f().pendingCheats || {}), [a.key]: v }; } if (p) p.cheats[a.key] = v; return `${a.key} = ${v}`; },
    setting(a) { if (!SETTABLE.has(a.key)) throw new Error('unknown setting'); const v = +a.value; if (!Number.isFinite(v)) throw new Error('bad value'); app.settings[a.key] = v; if (phys()) phys().settings[a.key] = v; if (a.key === 'timeScale' && f()) f().settings.timeScale = v; return `${a.key} = ${v}`; },
    teleport(a) {
      const p = phys(); if (!p || !p.active) throw new Error('no active vehicle (start a flight first)'); const b = p.active; const alt = Math.max(0, +a.alt || 0);
      if (b.held) { b.held = false; p.clampActive = false; if (f().state === 'prelaunch' || f().state === 'countdown') f().state = 'flying'; f().openClamps = true; }
      b.pos.y = alt + (alt < 1 ? -b.lowest + 0.05 : 0); if (a.zeroVel) { b.vel.set(0, 0, 0); b.w.set(0, 0, 0); } else if (alt > 100 && b.vel.y < 1) b.vel.y = 0;
      b.asleep = false; b.sleepTimer = 0; return `teleported to ${Math.round(alt)} m`;
    },
    launchNow() { const fl = f(); if (!fl || !fl.phys) throw new Error('no flight loaded'); if (fl.state === 'prelaunch') { fl.startCountdown(0.05); return 'countdown started (T-0.05 s)'; } return 'already launched'; },
    spawn(a) {
      const p = phys(); if (!p) throw new Error('start a flight first (spawned rockets are added to the running flight)'); const make = TEMPLATES[a.name]; if (!make) throw new Error('unknown example');
      const d = new Design().fromJSON(make().toJSON()); const n = ++spawnN; const body = p.buildVehicle(d, { extra: true, prefix: 'x' + n + '_' }); if (!body) throw new Error('could not build');
      const base = p.active ? p.active.pos : { x: 0, y: 0, z: 0 }; const ang = n * 1.3; const dist = 25 + 4 * body.radius;
      body.pos.set(base.x + Math.cos(ang) * dist, 0, base.z + Math.sin(ang) * dist); const gh = p.terrain.heightAt(body.pos.x, body.pos.z); const alt = a.alt != null && +a.alt > 0 ? +a.alt : 0;
      body.pos.y = alt > 0 ? gh + alt : gh - body.lowest + 0.03; body.vel.set(0, 0, 0); body.name = d.name + ' (spawned)'; body.asleep = false;
      body.parts.forEach(ps => { ps.design.config.__spawn = true; }); f().syncViews(); return `spawned ${d.name} (${body.parts.length} parts)`;
    },
    refuel() { const p = phys(); if (!p || !p.active) throw new Error('no vehicle'); for (const ps of p.active.parts) { ps.fuel = ps.fuelCap; ps.solid = ps.solidCap; ps.mono = ps.monoCap; if (ps.engine) ps.engine.burnedOut = false; } p.active.massDirty = true; p.active.ec = p.active.ecCap; return 'refuelled + recharged'; },
    clearDebris() { const p = phys(); if (!p) throw new Error('no flight'); let n = 0; for (const b of p.bodies.slice()) if (b !== p.active && (b.debris || b.extra)) { p.removeBody(b); n++; } return `removed ${n} objects`; },
    viz(a) { const fl = f(); if (!fl) throw new Error('no flight'); if (!['com', 'cop', 'thrust', 'nodes'].includes(a.key)) throw new Error('unknown overlay'); fl.debugFlags[a.key] = !!a.value; return `${a.key} overlay ${a.value ? 'on' : 'off'}`; },
    pause(a) { const fl = f(); if (!fl || !fl.phys) throw new Error('no flight'); fl.pause(!!a.value); return a.value ? 'paused' : 'resumed'; },
    unlockAll() { Progress.update(p => { p.unlockAll = true; }); app.editorUI && app.editorUI.renderList(); return 'all parts unlocked'; },
    relock() { Progress.update(p => { p.unlockAll = false; p.maxAlt = 0; }); app.editorUI && app.editorUI.renderList(); return 'progression reset (parts locked again)'; },
    quality(a) { if (!['low', 'medium', 'high'].includes(a.value)) throw new Error('bad quality'); app.settings.quality = a.value; app.applyQuality(); return 'quality ' + a.value + ' (texture LOD applies after reload)'; },
    resetSave() { const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('rw.') && k !== SESSION_KEY) keys.push(k); } keys.forEach(k => localStorage.removeItem(k)); setTimeout(() => location.reload(), 600); return `cleared ${keys.length} save-data keys; game reloading`; },
  };

  ch.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.t === 'hello') { lastPing = performance.now(); ch.postMessage({ t: 'here', ready: !!app.ready, mode: app.mode }); return; }
    if (m.t === 'ping') { if (sessionOk(m.token)) lastPing = performance.now(); return; }
    if (m.t !== 'cmd') return;
    if (!sessionOk(m.token)) { reply(m.id, false, 'not authorised (admin session expired?)'); return; }
    lastPing = performance.now();
    try { const fn = commands[m.cmd]; if (!fn) throw new Error('unknown command'); reply(m.id, true, fn(m.args || {})); } catch (e) { reply(m.id, false, e.message); }
  };

  const stats = () => {
    const now = performance.now(); if (now - lastPing > 4000) return; // only talk while an authorised admin page is open
    const fl = f(), p = phys(), r = app.renderer; const tel = p && p.telemetry();
    const sps = p ? (p.stepCount - lastSteps) * 1000 / (now - lastT) : 0; if (p) lastSteps = p.stepCount; lastT = now;
    const bodies = p ? p.bodies.filter(b => !b.removed) : []; const parts = bodies.reduce((s, b) => s + b.parts.length, 0);
    ch.postMessage({ t: 'stats', s: {
      mode: app.mode, state: fl && fl.state, fps, frameMs: fl ? fl.perf.frameMs : 0, physMs: fl ? fl.perf.physMs : 0, stepsPerSec: sps, steps: p ? p.stepCount : 0, simTime: p ? p.time : 0, timeScale: app.settings.timeScale,
      bodies: bodies.length, parts, debris: bodies.filter(b => b.debris && !b.isActive).length, extras: bodies.filter(b => b.extra).length, recoverable: bodies.filter(b => b.recoverable).length, asleep: bodies.filter(b => b.asleep).length,
      draws: r ? r.info.render.calls : 0, tris: r ? r.info.render.triangles : 0, geos: r ? r.info.memory.geometries : 0, texs: r ? r.info.memory.textures : 0,
      smoke: fl ? fl.effects.smoke.live || 0 : 0, fire: fl ? fl.effects.fire.live || 0 : 0,
      heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null, dpr: r ? r.getPixelRatio() : 1, viewport: innerWidth + '×' + innerHeight, quality: app.settings.quality, texLod: !!app.texLod,
      cheats: p ? { ...p.cheats } : (app.cheats || {}), settings: { g0: app.settings.g0, atmosphere: app.settings.atmosphere, scaleHeight: app.settings.scaleHeight, wind: app.settings.wind, timeScale: app.settings.timeScale },
      flags: fl ? { ...fl.debugFlags } : {}, errors: app.errors.length, lastError: app.errors[app.errors.length - 1] || null, progress: Progress.get(), unlocked: Progress.unlocked(), examples: Object.keys(TEMPLATES), paused: fl ? fl.paused : false,
      tel: tel ? { alt: tel.altitude, radar: tel.radar, speed: tel.speed, vspeed: tel.vspeed, mass: tel.mass, thrust: tel.thrust, twr: tel.twrNow, fuel: tel.liquid + tel.solid, g: tel.g, q: tel.q, vehicle: tel.vehicle, autoland: tel.autoland, sas: tel.sas, sasMode: tel.sasMode, controllable: tel.controllable } : null } });
  };
  statTimer = setInterval(stats, 500);
  return { ch, commands };
}
