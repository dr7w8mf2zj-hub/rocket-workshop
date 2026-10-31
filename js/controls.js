// Flight controls: keyboard (WASDQE, Shift/Ctrl throttle, Space stage, P chutes ...) and touch (joystick, throttle slider, buttons).
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class FlightControls {
  constructor(flight, root, hooks = {}) {
    this.flight = flight; this.root = root; this.hooks = hooks; this.keys = new Set(); this.active = false;
    this.axis = { pitch: 0, yaw: 0, roll: 0 }; this.stick = { x: 0, y: 0 }; this.touchRoll = 0; this.throttleRate = 0.55;
    this.bindKeys(); this.bindTouch();
  }
  setActive(a) { this.active = a; if (!a) { this.keys.clear(); this.stick.x = this.stick.y = 0; this.touchRoll = 0; } }
  get phys() { return this.flight.phys; }
  stage() { const f = this.flight; if (!f.phys) return; if (f.state === 'prelaunch') { f.startCountdown(); return; } if (f.state === 'countdown') return; if (f.state === 'flying') f.phys.activateStage(); }
  setThrottle(v) { if (this.phys) this.phys.inputs.throttle = clamp(v, 0, 1); }
  toggleSas() { if (!this.phys) return; this.phys.inputs.sas = !this.phys.inputs.sas; this.flight.msg('SAS ' + (this.phys.inputs.sas ? 'on' : 'off')); }
  toggleRcs() { if (!this.phys) return; this.phys.inputs.rcs = !this.phys.inputs.rcs; this.flight.msg('RCS ' + (this.phys.inputs.rcs ? 'on' : 'off')); }
  chutes() { if (this.phys && this.flight.state === 'flying') this.phys.deployAllChutes(); }
  engines() { const p = this.phys; if (!p || !p.active) return; const any = p.active.parts.some(x => x.engine && x.engine.liquid && x.engine.ignited && x.engine.on); p.toggleEngines(!any); this.flight.msg('Engines ' + (any ? 'shut down' : 'restarted')); }
  legs() { const p = this.phys; if (!p) return; const cur = p.active.parts.find(x => x.leg); if (cur) { p.toggleLegs(cur.leg.target > 0.5 ? 0 : 1); this.flight.msg('Landing legs ' + (cur.leg.target > 0.5 ? 'retracting' : 'deploying')); } }
  fins() { const p = this.phys; if (!p || !p.active) return; const on = p.toggleFins(); if (on === null) this.flight.msg('No stowable grid fins on this vehicle', 'warn'); else this.flight.msg('Grid fins ' + (on ? 'deploying' : 'stowing')); }
  autoland() { const p = this.phys; if (!p || !p.active) return; if (this.flight.state !== 'flying') return; if (!p.active.hasControl) { this.flight.msg('Auto-land needs a control module / avionics ring', 'warn'); return; } const on = p.toggleAutoland(); if (on) p.deployFins(p.active, true); }
  switchVehicle() { const p = this.phys; if (!p) return; if (!p.switchActive()) this.flight.msg('No other controllable vehicle', 'warn'); }
  sasMode() { const p = this.phys; if (!p) return; const m = p.cycleSasMode(); p.inputs.sas = true; this.flight.msg('SAS mode: ' + m); }
  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.target.closest?.('input,select,textarea')) return;
      const k = e.code; const game = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyP', 'KeyZ', 'KeyX', 'KeyT', 'KeyR', 'KeyC', 'KeyG', 'KeyM', 'ArrowUp', 'ArrowDown', 'Escape', 'KeyH', 'KeyF', 'KeyL', 'KeyV', 'Tab'];
      if (!game.includes(k)) return; if (!(e.ctrlKey && k !== 'ControlLeft' && k !== 'ControlRight')) e.preventDefault();
      if (e.repeat) { this.keys.add(k); return; } this.keys.add(k);
      switch (k) {
        case 'Space': this.stage(); break; case 'KeyP': this.chutes(); break; case 'KeyZ': this.setThrottle(1); break; case 'KeyX': this.setThrottle(0); break;
        case 'KeyT': this.toggleSas(); break; case 'KeyR': this.toggleRcs(); break; case 'KeyC': this.hooks.onCamera?.(); break; case 'KeyG': this.legs(); break; case 'KeyF': this.fins(); break; case 'KeyL': this.autoland(); break; case 'KeyV': this.sasMode(); break; case 'Tab': this.switchVehicle(); break; case 'KeyM': this.engines(); break;
        case 'Escape': this.hooks.onPause?.(); break; case 'KeyH': this.hooks.onHelp?.(); break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  bindTouch() {
    const $ = (s) => this.root.querySelector(s);
    const pad = $('#joy'), knob = $('#joyKnob');
    if (pad) {
      const R = () => pad.getBoundingClientRect(); let pid = null;
      const mv = (e) => { const r = R(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2); const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } this.stick.x = dx; this.stick.y = -dy; knob.style.transform = `translate(${dx * r.width * 0.32}px, ${dy * r.height * 0.32}px)`; };
      pad.addEventListener('pointerdown', (e) => { pid = e.pointerId; try { pad.setPointerCapture(e.pointerId); } catch (_) {}; mv(e); e.preventDefault(); e.stopPropagation(); });
      pad.addEventListener('pointermove', (e) => { if (e.pointerId === pid) mv(e); });
      const end = (e) => { if (e.pointerId !== pid) return; pid = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; };
      pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
    }
    const tr = $('#thr'), fill = $('#thrFill');
    if (tr) {
      let pid = null; const set = (e) => { const r = tr.getBoundingClientRect(); this.setThrottle(1 - (e.clientY - r.top) / r.height); };
      tr.addEventListener('pointerdown', (e) => { pid = e.pointerId; try { tr.setPointerCapture(e.pointerId); } catch (_) {}; set(e); e.preventDefault(); e.stopPropagation(); });
      tr.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(e); });
      const end = (e) => { if (e.pointerId === pid) pid = null; }; tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end);
    }
    const hold = (sel, fn, up) => { const el = $(sel); if (!el) return; el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch (_) {}; el.classList.add('down'); fn(); }); const end = () => { el.classList.remove('down'); up && up(); }; el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); };
    hold('#bRollL', () => { this.touchRoll = -1; }, () => { this.touchRoll = 0; }); hold('#bRollR', () => { this.touchRoll = 1; }, () => { this.touchRoll = 0; });
    const tap = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); };
    tap('#bStage', () => this.stage()); tap('#bChute', () => this.chutes()); tap('#bSas', () => this.toggleSas()); tap('#bRcs', () => this.toggleRcs());
    tap('#bCam', () => this.hooks.onCamera?.()); tap('#bEng', () => this.engines()); tap('#bFull', () => this.setThrottle(1)); tap('#bCut', () => this.setThrottle(0)); tap('#bLegs', () => this.legs()); tap('#bFins', () => this.fins()); tap('#bAuto', () => this.autoland()); tap('#bSw', () => this.switchVehicle()); tap('#bMode', () => this.sasMode());
  }
  update(dt) {
    const p = this.phys; if (!p) return; const k = this.keys; const inp = p.inputs;
    const want = (neg, pos) => (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0);
    const tgt = { pitch: want('KeyS', 'KeyW') + this.stick.y, yaw: want('KeyA', 'KeyD') + this.stick.x, roll: want('KeyQ', 'KeyE') + this.touchRoll };
    for (const a of ['pitch', 'yaw', 'roll']) { const t = clamp(tgt[a], -1, 1); const d = t - this.axis[a]; const rate = Math.abs(t) > Math.abs(this.axis[a]) ? 7 : 12; this.axis[a] += clamp(d, -rate * dt, rate * dt); inp[a] = Math.abs(this.axis[a]) < 0.02 ? 0 : this.axis[a]; }
    if (this.active) {
      let dth = 0; if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('ArrowUp')) dth += 1; if (k.has('ControlLeft') || k.has('ControlRight') || k.has('ArrowDown')) dth -= 1;
      if (dth) this.setThrottle(inp.throttle + dth * this.throttleRate * dt);
    }
  }
}
