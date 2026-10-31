// Flight scene: owns physics world, world rendering, vehicle/debris views, effects, cameras, countdown/launch state.
import * as THREE from 'three';
import { PhysicsWorld, defaultSettings, G0_STD } from './physics.js';
import { terrain, heightAt } from './terrain.js';
import { World } from './world.js';
import { Effects, makeFlame } from './effects.js';
import { PartView } from './models.js';
import { OrbitRig } from './camera.js';
import { PARTS } from './registry.js';

const V3 = THREE.Vector3;
export const CAMERA_MODES = ['chase', 'cockpit', 'free'];

export class Flight {
  constructor(renderer, lib, canvas) {
    this.renderer = renderer; this.lib = lib; this.canvas = canvas;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 2.5e6);
    this.rig = new OrbitRig(this.camera, canvas); this.rig.minDist = 3; this.rig.maxDist = 800; this.rig.dist = 28; this.rig.az = 0.7; this.rig.el = 0.2;
    this.rig.attach(() => this.camMode !== 'cockpit');
    this.world = new World(this.scene, lib, renderer); this.effects = new Effects(this.scene, lib);
    this.settings = defaultSettings(); this.phys = null; this.partViews = new Map(); this.bodyViews = new Map(); this.canopies = new Map();
    this.state = 'idle'; this.count = 0; this.camMode = 'chase'; this.design = null; this.messages = []; this.clock = 0; this.clampOpen = 0; this.openClamps = false;
    this.fwd = new V3(0, 0, -1); this.frame = { right: new V3(1, 0, 0), forward: new V3(0, 0, -1) }; this.shakeAmp = 0; this.freeTarget = new V3(0, 10, 0);
    this.camPosSmooth = new V3(); this.t = 0; this.shadowOn = true;
  }
  msg(text, kind = 'info') { this.messages.push({ text, kind, t: performance.now() }); if (this.messages.length > 8) this.messages.shift(); }

  // ------------------------------------------------------------------ vehicle lifecycle
  clearVehicle() {
    for (const pv of this.partViews.values()) this.disposePartView(pv);
    this.partViews.clear();
    for (const bv of this.bodyViews.values()) { this.scene.remove(bv.group); }
    this.bodyViews.clear();
    for (const c of this.canopies.values()) { this.scene.remove(c.mesh); this.scene.remove(c.lines); }
    this.canopies.clear();
    this.phys = null;
  }
  disposePartView(pv) {
    if (pv.flames) for (const f of pv.flames) { f.geometry.dispose(); f.material.dispose(); }
    pv.view.dispose();
  }
  loadVehicle(design, settings) {
    this.clearVehicle(); this.design = design; if (settings) this.settings = settings;
    this.phys = new PhysicsWorld(terrain, this.settings);
    const body = this.phys.buildVehicle(design); if (!body) return null;
    body.pos.set(0, -body.lowest + 0.02, 0); body.held = true; this.phys.clampActive = true; this.phys.inputs.throttle = 0;
    this.phys.autoStage = !!design.settings?.autoStage; this.state = 'prelaunch'; this.count = 0; this.clock = 0; this.clampOpen = 0; this.openClamps = false; this.world.setClamps(0);
    this.messages = []; this.syncViews(true);
    this.rig.target.copy(body.pos); this.rig.dist = Math.max(14, body.radius * 2.6); this.rig.az = 0.7; this.rig.el = 0.18; this.freeTarget.copy(body.pos);
    this.camMode = 'chase'; this.lastFrameT = performance.now();
    return body;
  }
  startCountdown(seconds = 5) { if (this.state !== 'prelaunch') return; this.state = 'countdown'; this.count = seconds; this.msg('Countdown started'); }
  abortCountdown() { if (this.state === 'countdown') { this.state = 'prelaunch'; this.msg('Countdown aborted', 'warn'); } }
  pause(p) { if (!this.phys) return; this.phys.paused = p; if (p) this.state = this.state === 'flying' || this.state === 'paused' ? 'paused' : this.state; else if (this.state === 'paused') this.state = 'flying'; }
  get paused() { return !!this.phys && this.phys.paused; }
  cycleCamera() { this.camMode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.camMode) + 1) % CAMERA_MODES.length]; if (this.camMode === 'free' && this.phys?.active) this.freeTarget.copy(this.phys.active.pos); if (this.camMode === 'free') this.rig.target.copy(this.freeTarget); return this.camMode; }
  setCamera(m) { if (CAMERA_MODES.includes(m)) { while (this.camMode !== m) this.cycleCamera(); } return this.camMode; }

  // ------------------------------------------------------------------ views
  syncViews(force = false) {
    const phys = this.phys; if (!phys) return; const alive = new Set();
    for (const b of phys.bodies) {
      let bv = this.bodyViews.get(b.id);
      if (!bv) { bv = { group: new THREE.Group(), body: b }; this.scene.add(bv.group); this.bodyViews.set(b.id, bv); }
      for (const ps of b.parts) {
        alive.add(ps.id); let pv = this.partViews.get(ps.id);
        if (!pv) { const view = new PartView({ id: ps.id, type: ps.type, dims: ps.design.dims, appearance: ps.design.appearance, config: ps.design.config }, this.lib); view.applyAppearance({ name: this.design.name, id: this.design.idCode }); pv = { view, flames: null, ps }; this.partViews.set(ps.id, pv);
          if (ps.engine && view.exhaust) { pv.flames = [makeFlame(), makeFlame()]; pv.flames[1].material.uniforms.uCol.value.set(0.9, 0.85, 1.0); for (const f of pv.flames) { f.visible = false; view.group.add(f); f.position.copy(view.exhaust.exit); } } }
        if (pv.bv !== bv) { bv.group.add(pv.view.group); pv.bv = bv; }
        pv.view.group.position.copy(ps.lp); pv.view.group.quaternion.copy(ps.lq);
      }
    }
    for (const [id, pv] of this.partViews) if (!alive.has(id)) { pv.view.group.parent?.remove(pv.view.group); this.disposePartView(pv); this.partViews.delete(id); const c = this.canopies.get(id); if (c) { this.scene.remove(c.mesh); this.scene.remove(c.lines); this.canopies.delete(id); } }
    for (const [id, bv] of this.bodyViews) { if (!phys.bodies.includes(bv.body)) { this.scene.remove(bv.group); this.bodyViews.delete(id); } }
  }
  updateViews(dt) {
    const phys = this.phys; const tmp = new V3(); const q = new THREE.Quaternion(); const press = (h) => phys.pressureRatio(h);
    const rhoOf = (h) => phys.densityAt(h);
    for (const b of phys.bodies) {
      const bv = this.bodyViews.get(b.id); if (!bv) continue;
      bv.group.quaternion.copy(b.q); bv.group.position.copy(b.com).applyQuaternion(b.q).multiplyScalar(-1).add(b.pos);
      bv.group.visible = true;
      const heat = Math.min(1.4, b.heat);
      for (const ps of b.parts) {
        const pv = this.partViews.get(ps.id); if (!pv) continue; const view = pv.view;
        view.setHeat(heat > 0.25 ? heat - 0.15 : 0);
        if (ps.leg) view.setLegDeploy(ps.leg.deployed);
        if (ps.chute) this.updateChute(b, ps, pv);
        if (ps.engine && pv.flames) {
          const e = ps.engine; const on = e.thrust > 1; const alt = b.pos.y;
          for (let i = 0; i < 2; i++) pv.flames[i].visible = on;
          if (on) {
            const pr = press(alt); const frac = e.thrust / ((e.thrustMax * e.boost) || 1); const flick = 0.85 + 0.3 * Math.random();
            const base = Math.sqrt(e.thrust / 200000) * (e.liquid ? 1 : 0.9);
            const len = (3.5 + 10 * base * (1 + 1.6 * (1 - pr))) * flick * (0.5 + 0.5 * frac); const rad = e.exitR * (1.0 + 0.9 * (1 - pr)) * 1.05;
            pv.flames[0].scale.set(rad, len, rad); pv.flames[1].scale.set(rad * 0.55, len * 0.55, rad * 0.55);
            pv.flames[0].material.uniforms.uTime.value = this.t; pv.flames[1].material.uniforms.uTime.value = this.t;
            pv.flames[0].material.uniforms.uInt.value = 0.9 * Math.min(1, 0.4 + 0.8 * pr + 0.4 * (1 - pr)); pv.flames[1].material.uniforms.uInt.value = 1.0;
            if (e.gimbalVec) { pv.flames[0].rotation.set(e.gimbalVec.z, 0, -e.gimbalVec.x); pv.flames[1].rotation.copy(pv.flames[0].rotation); }
            // particles
            const exit = b.worldPoint(e.exit, tmp.clone()); const dir = (e.dirWorld || new V3(0, 1, 0)).clone().multiplyScalar(-1);
            this.effects.exhaust(exit, dir, b.vel, Math.min(1, frac), e.exitR, rhoOf(alt), pr, heightAt(exit.x, exit.z), dt);
          }
        }
        if (ps.def.rcs && b.rcsFiring > 0.05 && pv.view.rcsNozzles.length) {
          if (Math.random() < 0.5) { const n = pv.view.rcsNozzles[Math.floor(Math.random() * pv.view.rcsNozzles.length)]; const lp = n.pos.clone().applyQuaternion(ps.lq).add(ps.lp); const wp = b.worldPoint(lp, new V3()); const wd = n.dir.clone().applyQuaternion(ps.lq).applyQuaternion(b.q); this.effects.rcsPuff(wp, wd); }
        }
      }
    }
  }
  updateChute(b, ps, pv) {
    const ch = ps.chute; let c = this.canopies.get(ps.id);
    if (ch.f <= 0.001 || ch.state === 'cut') { if (c) { c.mesh.visible = false; c.lines.visible = false; } return; }
    if (!c) { const mesh = pv.view.ensureCanopy(); const lines = pv.view.extras.lines; this.scene.add(mesh); this.scene.add(lines); c = { mesh, lines }; this.canopies.set(ps.id, c); }
    const base = b.worldPoint(ps.lp, new V3()).addScaledVector(new V3(0, 1, 0).applyQuaternion(ps.lq).applyQuaternion(b.q), 0.2);
    const R = ch.canopy * ch.f; const dir = ch.dir.lengthSq() > 0.01 ? ch.dir.clone().normalize() : new V3(0, 1, 0);
    const center = base.clone().addScaledVector(dir, R * 2.2);
    c.mesh.visible = true; c.lines.visible = true; c.mesh.position.copy(center); c.mesh.scale.set(R, R, R); c.mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir);
    const arr = c.lines.geometry.attributes.position.array; const up = Math.abs(dir.y) < 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0); const t1 = new V3().crossVectors(dir, up).normalize(), t2 = new V3().crossVectors(dir, t1);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const rim = center.clone().addScaledVector(t1, Math.cos(a) * R).addScaledVector(t2, Math.sin(a) * R); arr[i * 6] = base.x; arr[i * 6 + 1] = base.y; arr[i * 6 + 2] = base.z; arr[i * 6 + 3] = rim.x; arr[i * 6 + 4] = rim.y; arr[i * 6 + 5] = rim.z; }
    c.lines.geometry.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------------ main update
  update(dtReal, viewW, viewH) {
    const phys = this.phys; if (!phys) return;
    dtReal = Math.min(dtReal, 0.1); this.t += dtReal;
    if (this.state === 'countdown') {
      this.count -= dtReal;
      if (this.count <= 0) {
        this.count = 0; this.state = 'flying'; if (phys.inputs.throttle < 0.5) phys.inputs.throttle = 1;
        const idx = phys.activateStage(); this.msg('Ignition!', 'good');
      } else if (this.count < 2 && !this.preIgn) { this.preIgn = true; }
    }
    if (this.state === 'flying' || this.state === 'countdown') { /* physics runs below */ }
    // physics steps (held vehicles still compute thrust/mass while clamped)
    const steps = (this.state === 'flying' || this.state === 'paused') ? phys.update(dtReal) : 0;
    if (this.state === 'flying') this.clock += dtReal * (this.settings.timeScale || 1);
    for (const ev of phys.events.splice(0)) this.handleEvent(ev);
    if (this.openClamps) { this.clampOpen = Math.min(1, this.clampOpen + dtReal / 2.0); this.world.setClamps(this.clampOpen); }
    this.syncViews(); this.updateViews(dtReal);
    this.updateCamera(dtReal);
    const active = phys.active; const alt = active ? active.pos.y : 0;
    this.world.update(this.camera.position, this.camera.position.y, this.settings.atmosphere, this.settings.scaleHeight, active ? active.pos : this.camera.position);
    // engine light
    let best = null; if (active) for (const p of active.parts) if (p.engine && p.engine.thrust > 1 && (!best || p.engine.thrust > best.engine.thrust)) best = p;
    const L = this.world.engineLight; if (best) { L.position.copy(active.worldPoint(best.engine.exit, new V3())).addScaledVector(best.engine.dirWorld || new V3(0, 1, 0), -4); L.intensity = Math.min(1, best.engine.thrust / 400000) * 2200 * (0.85 + 0.3 * Math.random()); } else L.intensity = 0;
    this.effects.update(dtReal, viewH, this.camera.fov);
  }
  handleEvent(ev) {
    const ef = this.effects;
    if (ev.t === 'explosion') { ef.explosion(ev.pos, ev.size); this.msg(ev.reason === 'crash' ? 'Part destroyed on impact' : ev.reason === 'heat' ? 'Part burned up from re-entry heating' : 'Part destroyed', 'bad'); }
    else if (ev.t === 'separation') { ef.sparks(ev.pos); ef.shake += 0.5; }
    else if (ev.t === 'stage') { this.msg(`Stage ${ev.index + 1}: ${ev.fired.join(', ') || '—'}`, 'good'); }
    else if (ev.t === 'log') this.msg(ev.msg, 'warn');
    else if (ev.t === 'liftoff') { this.openClamps = true; this.msg('Liftoff!', 'good'); }
    else if (ev.t === 'bodyRemoved') { /* views are reconciled in syncViews */ }
  }
  // ------------------------------------------------------------------ camera
  updateCamera(dt) {
    const phys = this.phys; const active = phys.active || phys.bodies[0]; const cam = this.camera; if (!active) return;
    const thrust = active.thrustNow; const rho = active.rho;
    // shake: engine rumble near the ground / in air, decays in thin air
    const dens = Math.min(1, rho / 0.5); const amp = Math.min(0.35, Math.sqrt(thrust) * 0.00055) * (0.12 + 0.88 * dens) + this.effects.shake * 0.05;
    this.shakeAmp = amp;
    if (this.camMode === 'chase') {
      this.rig.target.copy(active.pos); this.rig.update();
    } else if (this.camMode === 'free') {
      this.rig.target.copy(this.freeTarget); this.rig.update();
    } else {
      // cockpit: attached to the flight control module (or body COM)
      const pod = active.parts.find(p => p.def.control);
      const eyeL = pod ? pod.lp.clone().add(new V3(0, pod.L * 0.3, 0).applyQuaternion(pod.lq)) : active.com.clone();
      const eye = active.worldPoint(eyeL, new V3()); const R = new THREE.Matrix4().makeRotationFromQuaternion(active.q);
      const f = new V3(0, 1, 0).applyMatrix4(R), up = new V3(0, 0, 1).applyMatrix4(R);
      cam.position.copy(eye).addScaledVector(f, 0.35); cam.up.copy(up); cam.lookAt(cam.position.clone().add(f)); cam.up.set(0, 1, 0);
    }
    if (amp > 0.0005) { cam.position.x += (Math.random() - 0.5) * amp; cam.position.y += (Math.random() - 0.5) * amp; cam.position.z += (Math.random() - 0.5) * amp; cam.rotation.z += (Math.random() - 0.5) * amp * 0.01; }
    if (cam.position.y < heightAt(cam.position.x, cam.position.z) + 1.5) cam.position.y = heightAt(cam.position.x, cam.position.z) + 1.5;
    cam.near = Math.min(3, Math.max(0.1, this.rig.dist * 0.01)); cam.updateProjectionMatrix();
    // control frame (camera relative)
    const d = new V3(); cam.getWorldDirection(d);
    if (this.camMode === 'cockpit') { const R = new THREE.Matrix4().makeRotationFromQuaternion(active.q); this.frame.right.set(1, 0, 0).applyMatrix4(R); this.frame.forward.set(0, 0, -1).applyMatrix4(R); }
    else { d.y = 0; if (d.lengthSq() > 0.04) { d.normalize(); this.fwd.copy(d); } this.frame.forward.copy(this.fwd); this.frame.right.set(-this.fwd.z, 0, this.fwd.x); }
    phys.inputs.frame = this.frame;
  }
  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  render() { this.renderer.render(this.scene, this.camera); }
  dispose() {
    this.clearVehicle(); this.effects.dispose(); this.world.dispose();
  }
}
