// Custom fixed-timestep rigid-body rocket physics (no canned animation: everything emerges from forces & torques).
// Units: SI (m, kg, s, N). Y is up. Gravity falls off with altitude, atmosphere density falls off exponentially.
import * as THREE from 'three';
import { PARTS, geom, nodes, partMass, fuelCapacity, solidCapacity, engineStats, engineGeom, massK, fillDims, radiusAt } from './registry.js';

const V3 = THREE.Vector3, Q4 = THREE.Quaternion, M3 = THREE.Matrix3;
export const G0_STD = 9.80665;
export const DT = 1 / 120;
const tmpA = new V3(), tmpB = new V3(), tmpC = new V3(), tmpD = new V3(), tmpE = new V3(), tmpQ = new Q4(), tmpM = new THREE.Matrix4();

export const defaultSettings = () => ({ g0: 9.81, atmosphere: 1.0, scaleHeight: 7500, planetRadius: 6371000, wind: 0, timeScale: 1, seaLevelDensity: 1.225 });

export class PartState {
  constructor(designPart, def, lp, lq) {
    const dims = designPart.dims; this.id = designPart.id; this.design = designPart; this.def = def; this.type = def.id;
    this.lp = lp; this.lq = lq; const g = geom(def, dims); this.r = g.r; this.L = g.L; this.k = massK(def, dims);
    this.dry = partMass(def, dims); this.fuelCap = fuelCapacity(def, dims); this.fuel = this.fuelCap * (designPart.config.fill ?? 1);
    this.solidCap = solidCapacity(def, dims); this.solid = this.solidCap * (designPart.config.fill ?? 1);
    this.sepStage = designPart.sepStage ?? -1; this.monoCap = def.rcs ? def.rcs.mono * this.k : 0; this.mono = this.monoCap;
    this.ecCap = (def.ec || 0) * this.k; this.stage = designPart.stage; this.crash = def.crash || 7;
    this.parent = null; this.children = []; this.linkRadial = false; this.dead = false;
    this.axis = new V3(0, 1, 0).applyQuaternion(lq);
    this.engine = null; this.chute = null; this.leg = null; this.sepType = null; this.heatProt = def.shield ? def.shield.ablator * this.k : 0;
    this.nbTop = 0; this.nbBot = 0; // neighbouring radii on stack nodes (for exposed area)
    this.contacts = []; this.aeroCenter = lp.clone(); this.cs = null;
    if (def.engine) {
      const es = engineStats(def, dims); const eg = engineGeom(def, dims);
      this.engine = { thrustMax: es.thrust, ispSL: es.ispSL, ispVac: es.ispVac, gimbal: (designPart.config.gimbal !== false ? es.gimbal : 0) * Math.PI / 180, liquid: es.liquid, ignited: false, on: true,
        limit: designPart.config.thrustLimit ?? 1, thrust: 0, throttleNow: 0, pivot: lp.clone().add(new V3(0, eg.pivotY, 0).applyQuaternion(lq)), exit: lp.clone().add(new V3(0, eg.exitY, 0).applyQuaternion(lq)),
        exitR: eg.exitR, dir: this.axis.clone(), gimbalVec: new V3(), boost: 1, ispBoost: 1, starved: false, burnedOut: false, mdot: es.thrust / (es.ispSL * G0_STD), sources: [], flame: 0 };
    }
    if (def.chute) this.chute = { state: 'stowed', f: 0, canopy: dims.canopy || 6, t: 0, dir: new V3(0, 1, 0) };
    if (def.leg) this.leg = { deployed: 1, target: 1, foot: new V3(0.55 * g.L, -0.78 * g.L - 0.05, 0), compress: 0 };
    if (def.ctrl) this.surf = { defl: 0, max: def.ctrl.max * Math.PI / 180, stowDef: !!def.ctrl.stow, stow: def.ctrl.stow ? 1 : 0, stowTarget: def.ctrl.stow ? 1 : 0 };
    if (def.sep) this.sepType = def.id === 'decoupler' ? 'stack' : 'dock';
    if (def.radialSep && designPart.config.sep) this.sepType = 'radial';
  }
  get mass() { return this.dry + this.fuel + this.solid + this.mono + (this.heatProt) * 0 + (this.ablator || 0); }
}

export class Body {
  constructor(world, parts) {
    this.world = world; this.id = world.nextBodyId++; this.parts = parts; this.partMap = new Map(parts.map(p => [p.id, p]));
    this.pos = new V3(); this.vel = new V3(); this.q = new Q4(); this.w = new V3(); this.com = new V3(); this.mass = 1; this.I = new M3(); this.Iinv = new M3();
    this.massDirty = true; this.held = false; this.asleep = false; this.sleepT = 0; this.age = 0; this.radius = 1; this.isActive = false;
    this.force = new V3(); this.torque = new V3(); this.accel = new V3(); this.dynQ = 0; this.rho = 0; this.heat = 0; this.heatT = 0;
    this.thrustNow = 0; this.thrustMax = 0; this.contactCount = 0; this.landed = false; this.maxImpact = 0;
    this.ec = 0; this.ecCap = 0; this.controlTorque = 0; this.rcsTorque = 0; this.hasControl = false; this.sleepTimer = 0; this.debris = false;
    this.rcsFiring = 0; this.view = null; this.name = 'Vehicle';
    this.autoland = false; this.autopilot = false; this.apThrottle = 0; this.apDir = null; this.apBurn = false; this.sasTarget = null; this.sasHold = 0; this.sasI = new V3(); this.recoverable = false; this.clearance = 1e9; this.landedT = 0;
    this.refresh(true);
  }
  // -------------------------------------------------------------- mass properties
  refresh(init = false) {
    let m = 0; const c = tmpA.set(0, 0, 0);
    for (const p of this.parts) { const pm = p.mass; m += pm; c.addScaledVector(p.lp, pm); }
    m = Math.max(m, 1e-3); c.multiplyScalar(1 / m);
    if (!init) { // keep physical continuity: COM moved in body frame
      const shift = tmpB.copy(c).sub(this.com).applyQuaternion(this.q);
      this.pos.add(shift); this.vel.add(tmpC.crossVectors(this.w, shift));
    }
    this.com.copy(c); this.mass = m;
    const e = this.I.elements; e.fill(0); const R = new M3(); let rad = 0;
    for (const p of this.parts) {
      const pm = p.mass; const d = tmpB.copy(p.lp).sub(c);
      const dd = d.lengthSq(); rad = Math.max(rad, d.length() + Math.max(p.r, p.L / 2) + (p.def.radial ? 1 : 0));
      // parallel axis (row-major in Matrix3.set)
      const Ixx = pm * (dd - d.x * d.x), Iyy = pm * (dd - d.y * d.y), Izz = pm * (dd - d.z * d.z), Ixy = -pm * d.x * d.y, Ixz = -pm * d.x * d.z, Iyz = -pm * d.y * d.z;
      // part's own inertia (cylinder about its axis Y)
      const r = p.def.stack === 'none' ? 0.15 : p.r, L = p.def.stack === 'none' ? 0.3 : p.L; const ia = pm * (3 * r * r + L * L) / 12, ib = pm * r * r / 2;
      tmpM.makeRotationFromQuaternion(p.lq); const me = tmpM.elements; // column-major
      const a = [ia, ib, ia]; const loc = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += me[k * 4 + i] * a[k] * me[k * 4 + j]; loc[i * 3 + j] = s; }
      e[0] += Ixx + loc[0]; e[4] += Iyy + loc[4]; e[8] += Izz + loc[8];
      e[3] += Ixy + loc[1]; e[1] += Ixy + loc[3]; e[6] += Ixz + loc[2]; e[2] += Ixz + loc[6]; e[7] += Iyz + loc[5]; e[5] += Iyz + loc[7];
    }
    // Matrix3.elements is column-major; matrix is symmetric so ordering is irrelevant
    this.Iinv.copy(this.I).invert();
    this.radius = rad; this.massDirty = false;
  }
  alive() { return this.parts.length > 0; }
  // -------------------------------------------------------------- queries
  worldPoint(lp, out = new V3()) { return out.copy(lp).sub(this.com).applyQuaternion(this.q).add(this.pos); }
  worldDir(ld, out = new V3()) { return out.copy(ld).applyQuaternion(this.q); }
  fuelTotals() {
    let f = 0, cap = 0, s = 0, scap = 0, mono = 0;
    for (const p of this.parts) { f += p.fuel; cap += p.fuelCap; s += p.solid; scap += p.solidCap; mono += p.mono; }
    return { liquid: f, liquidCap: cap, solid: s, solidCap: scap, mono };
  }
}

export class PhysicsWorld {
  constructor(terrain, settings = defaultSettings()) {
    this.terrain = terrain; this.settings = settings; this.bodies = []; this.nextBodyId = 1; this.time = 0; this.events = []; this.active = null;
    this.acc = 0; this.inputs = { throttle: 0, pitch: 0, yaw: 0, roll: 0, sas: false, rcs: false, sasMode: 'hold', frame: { right: new V3(1, 0, 0), forward: new V3(0, 0, -1) } };
    this.stageIndex = 0; this.stageCount = 0; this.autoStage = false; this.autoTimer = 0; this.sasTarget = null; this.sasHold = 0; this.maxDebris = 40; this.paused = false;
    this.cheats = { infFuel: false, god: false, noHeat: false }; this.autoRecover = false; this.reserve = 0; this.rootPartId = null; this.spawnCount = 0; this.stepCount = 0;
    this.clampActive = false; this.clampTime = 0; this.sunDir = new V3(0.5, 0.8, 0.3).normalize(); this.stageLog = [];
  }
  // -------------------------------------------------------------- environment
  gravityAt(h) { const R = this.settings.planetRadius; const k = R / (R + Math.max(0, h)); return this.settings.g0 * k * k; }
  densityAt(h) { const s = this.settings; if (s.atmosphere <= 0) return 0; return s.seaLevelDensity * s.atmosphere * Math.exp(-Math.max(0, h) / s.scaleHeight); }
  pressureRatio(h) { const s = this.settings; if (s.atmosphere <= 0) return 0; return Math.min(1, s.atmosphere * Math.exp(-Math.max(0, h) / s.scaleHeight)); }

  // -------------------------------------------------------------- building a vehicle from a design
  buildVehicle(design, opts = {}) {
    const veh = design.vehicle(); if (!veh.ids.length) return null;
    const rootPart = design.get(veh.root);
    // orient so that root axis points up
    const rq = new Q4(...rootPart.quat); const axis = new V3(0, 1, 0).applyQuaternion(rq);
    const q0 = new Q4().setFromUnitVectors(axis, new V3(0, 1, 0)); const rp = new V3(...rootPart.pos);
    const map = new Map();
    for (const id of veh.ids) {
      const dp = JSON.parse(JSON.stringify(design.get(id))); const def = PARTS[dp.type]; if (opts.prefix) dp.id = opts.prefix + dp.id;
      const lp = new V3(...dp.pos).sub(rp).applyQuaternion(q0); const lq = q0.clone().multiply(new Q4(...dp.quat));
      map.set(id, new PartState(dp, def, lp, lq));
    }
    for (const e of veh.edges) { const a = map.get(e.near), b = map.get(e.far); b.parent = a; a.children.push(b); b.linkRadial = !!e.link.radial; b.parentLink = e.link; b.parentNode = e.link.parent === e.far ? e.link.cn : e.link.pn; }
    // engine boost from nozzle extensions + fuel sources
    for (const ps of map.values()) {
      if (ps.def.nozzleBoost && ps.parent && ps.parent.engine) { ps.parent.engine.boost *= ps.def.nozzleBoost.thrust; ps.parent.engine.ispBoost *= ps.def.nozzleBoost.ispVac; }
      if (ps.engine && ps.engine.liquid) ps.engine.sources = design.fuelSources(ps.id).map(id => map.get(id)).filter(Boolean);
      // stack-node neighbours for exposed area
      for (const e of veh.edges) { }
    }
    for (const e of veh.edges) {
      const l = e.link; if (l.radial) continue; const par = map.get(l.parent), ch = map.get(l.child);
      const pn = nodes(par.def, design.get(l.parent).dims).find(n => n.id === l.pn), cn = nodes(ch.def, design.get(l.child).dims).find(n => n.id === l.cn);
      if (pn) { if (pn.id === 'top') par.nbTop = cn ? cn.r : 0; else par.nbBot = cn ? cn.r : 0; }
      if (cn) { if (cn.id === 'top') ch.nbTop = pn ? pn.r : 0; else ch.nbBot = pn ? pn.r : 0; }
    }
    const parts = [...map.values()];
    const body = new Body(this, parts); body.name = design.name; body.isActive = !opts.extra; body.extra = !!opts.extra;
    for (const ps of parts) this.setupPartAero(ps);
    this.bodies.push(body);
    if (opts.extra) { body.massDirty = true; body.refresh(true); this.computeElectric(body); this.computeLowest(body); body.ec = body.ecCap; body.debris = false; return body; }
    this.active = body; this.rootPartId = rootPart.id; this.stageCount = design.stageCount(); this.stageIndex = 0; this.stageLog = [];
    this.updateStageSummary(design);
    body.massDirty = true; body.refresh(true);
    this.computeElectric(body); this.computeLowest(body);
    body.ec = body.ecCap;
    return body;
  }
  updateStageSummary(design) {
    const n = Math.max(this.stageCount, 0); const arr = [];
    for (let i = 0; i < n; i++) arr.push({ index: i, engines: 0, seps: 0, chutes: 0, items: [] });
    for (const it of design.stageItems()) { if (it.stage < 0 || it.stage >= n) continue; const a = arr[it.stage]; const nm = PARTS[design.get(it.id).type].name; a.items.push((it.action === 'ignite' ? 'Ignite ' : it.action === 'deploy' ? 'Deploy ' : 'Separate ') + nm); if (it.action === 'ignite') a.engines++; else if (it.action === 'deploy') a.chutes++; else a.seps++; }
    this.stageSummary = arr;
  }
  setupPartAero(ps) {
    const d = ps.def; const s = ps.design; const a = {};
    if (d.finArea) { a.type = 'fin'; a.area = s.dims.span * s.dims.chord; a.normal = new V3(0, 0, 1).applyQuaternion(ps.lq); a.center = ps.lp.clone().add(new V3(s.dims.span / 2, 0, 0).applyQuaternion(ps.lq)); a.k = d.finK ?? 1; if (ps.surf) { a.normal0 = a.normal.clone(); a.hinge = new V3(1, 0, 0).applyQuaternion(ps.lq); a.tan0 = new V3().crossVectors(a.hinge, a.normal0); } }
    else if (d.stack === 'none') { a.type = 'blob'; a.area = Math.PI * 0.15 * 0.15 * (d.leg ? 2.5 : 1.5) * Math.max(1, ps.L); a.center = ps.lp; if (d.id === 'solar_panels') { a.type = 'fin'; a.area = s.dims.length * s.dims.width; a.normal = new V3(0, 0, 1).applyQuaternion(ps.lq); a.center = ps.lp.clone().add(new V3(0.2 + s.dims.length / 2, 0, 0).applyQuaternion(ps.lq)); } }
    else {
      a.type = 'cyl'; a.center = ps.lp; const lat = d.model === 'cone' ? 0.55 : 1;
      a.latArea = 2 * ps.r * ps.L * lat; a.axis = ps.axis; a.dA = 0;
      const m = d.model; if (m === 'cone') a.dA = Math.PI * ps.r * ps.r; else if (m === 'adapter' || m === 'pod') a.dA = Math.PI * ps.r * ps.r * (1 - d.topK * d.topK);
      else if (m === 'cluster') a.dA = 0; else if (m === 'engine' || m === 'nozzle') { const er = d.model === 'engine' ? engineGeom(d, s.dims).exitR : ps.r; a.dA = Math.PI * (er * er - Math.pow(ps.r * (m === 'engine' ? 0.9 : 0.35), 2)); }
      this.updateAeroEnds(ps, a);
    }
    ps.aero = a;
    // contacts (body local)
    ps.contacts = [];
    const add = (lp, kind = 'ring', extra = {}) => ps.contacts.push({ lp, kind, touch: false, part: ps, ...extra });
    if (d.stack !== 'none') {
      const br = d.engine && d.model === 'engine' ? engineGeom(d, s.dims).exitR : ps.r; const n = Math.max(4, Math.min(8, Math.round(ps.r * 6) + 4));
      for (let i = 0; i < n; i++) { const a2 = i / n * Math.PI * 2; const off = new V3(Math.cos(a2) * br * 0.95, -ps.L / 2, Math.sin(a2) * br * 0.95).applyQuaternion(ps.lq).add(ps.lp); add(off); }
      for (let i = 0; i < 4; i++) { const a2 = i / 4 * Math.PI * 2; const off = new V3(Math.cos(a2) * ps.r * 0.9, ps.L / 2, Math.sin(a2) * ps.r * 0.9).applyQuaternion(ps.lq).add(ps.lp); add(off); }
      if (d.model === 'cone') add(new V3(0, ps.L / 2, 0).applyQuaternion(ps.lq).add(ps.lp));
      if (d.chute) { add(new V3(0, ps.L / 2, 0).applyQuaternion(ps.lq).add(ps.lp)); }
    }
    if (d.leg) add(ps.leg.foot.clone().applyQuaternion(ps.lq).add(ps.lp), 'leg');
    else if (d.stack === 'none') { add(ps.aero.center.clone ? ps.aero.center.clone() : ps.lp.clone()); }
    if (d.radial && d.stack !== 'none' && ps.linkRadial) { /* ring points already cover it */ }
  }
  updateAeroEnds(ps, a = ps.aero) {
    const full = Math.PI * ps.r * ps.r;
    a.areaF = Math.max(0, full - Math.PI * ps.nbTop * ps.nbTop); a.areaB = Math.max(0, full - Math.PI * ps.nbBot * ps.nbBot);
    if (ps.def.model === 'adapter') { const rt = ps.r * ps.def.topK; a.areaF = Math.max(0, Math.PI * rt * rt - Math.PI * ps.nbTop * ps.nbTop); a.areaB = Math.max(0, full - Math.PI * ps.nbBot * ps.nbBot) ; a.areaF += Math.PI * (ps.r * ps.r - rt * rt) * 0.5; }
    if (ps.def.model === 'pod') a.areaF = Math.max(0, Math.PI * Math.pow(ps.r * ps.def.topK, 2) - Math.PI * ps.nbTop * ps.nbTop) + Math.PI * (ps.r * ps.r * (1 - ps.def.topK * ps.def.topK)) * 0.4;
    a.cdF = ps.def.cdFront ?? 0.8; a.cdB = ps.def.cdBack ?? 0.8;
    if (ps.def.model === 'cone' || ps.def.model === 'pod') { /* streamlined: cd already low; area is full disc */ }
    if (ps.nbTop > 0 && ps.def.model === 'cone') a.areaF = full;
  }
  computeElectric(body) {
    let cap = 0, ctl = 0, rcs = 0;
    for (const p of body.parts) { cap += p.ecCap; if (p.def.control) ctl += p.def.control.torque * p.k; if (p.def.rcs) rcs += p.def.rcs.torque * p.k; }
    body.ecCap = cap; body.controlTorque = ctl; body.rcsTorque = rcs; body.hasControl = body.parts.some(p => p.def.control);
    body.ec = Math.min(body.ec, cap);
  }
  computeLowest(body) {
    let lo = Infinity; const R = new M3().setFromMatrix4(tmpM.makeRotationFromQuaternion(body.q));
    for (const p of body.parts) for (const c of p.contacts) { const y = tmpA.copy(c.lp).sub(body.com).applyQuaternion(body.q).y; lo = Math.min(lo, y); }
    body.lowest = lo; return lo;
  }

  // -------------------------------------------------------------- staging / actions
  stageOf(p, action) { return action === 'separate' && p.engine ? p.sepStage : p.stage; }
  stageHas(b, idx) { return b.parts.some(p => !p.dead && ((p.engine && p.stage === idx) || (p.chute && p.stage === idx) || (p.sepType && this.stageOf(p, 'separate') === idx))); }
  activateStage() {
    const body = this.active; if (!body) return null; const n = this.stageCount;
    while (this.stageIndex < n && !this.stageHas(body, this.stageIndex)) this.stageIndex++;
    if (this.stageIndex >= n) { this.events.push({ t: 'log', msg: 'No more stages' }); return null; }
    const idx = this.stageIndex++; const fired = [];
    const list = body.parts.filter(p => !p.dead);
    for (const p of list) {
      if (p.engine && p.stage === idx) { p.engine.ignited = true; p.engine.on = true; fired.push('ignite ' + p.def.name); }
      if (p.chute && p.stage === idx) { this.deployChute(p); fired.push('deploy chute'); }
    }
    this.hotIgnite = idx;
    for (const p of list) { if (p.sepType && this.stageOf(p, 'separate') === idx && !p.dead && body.partMap.has(p.id)) { this.separate(body, p); fired.push('separate ' + p.def.name); } }
    this.events.push({ t: 'stage', index: idx, fired });
    this.stageLog.push({ t: this.time, index: idx, fired });
    return idx;
  }
  deployChute(p) { if (p.chute && p.chute.state === 'stowed') { p.chute.state = 'deploying'; p.chute.t = 0; this.events.push({ t: 'log', msg: 'Parachute deployed' }); } }
  deployAllChutes() { for (const b of this.bodies) for (const p of b.parts) this.deployChute(p); }
  toggleEngines(on) { const b = this.active; if (!b) return; for (const p of b.parts) if (p.engine && p.engine.liquid && p.engine.ignited) p.engine.on = on; }
  toggleLegs(f) { for (const b of this.bodies) for (const p of b.parts) if (p.leg) p.leg.target = f; }
  enginesOn() { const b = this.active; return b ? b.parts.some(p => p.engine && p.engine.ignited && p.engine.on && !p.engine.burnedOut) : false; }

  /** Split off subtree(s) according to the separator type. Returns new bodies. */
  separate(body, sepPart) {
    const cut = [];
    if (sepPart.sepType === 'radial') cut.push(sepPart);
    else for (const c of sepPart.children) if (!c.linkRadial) cut.push(c);
    const out = [];
    const sepWorld = body.worldPoint(sepPart.lp, new V3());
    const dirWorld = body.worldDir(sepPart.axis, new V3());
    for (const root of cut) {
      const nb = this.splitSubtree(body, root); if (!nb) continue; out.push(nb);
      // detach from parent
      // separation impulse (momentum conserving)
      let dv = tmpA;
      if (sepPart.sepType === 'radial') { dv.copy(body.worldPoint(root.lp, tmpB)).sub(body.pos); const up = body.worldDir(sepPart.axis, tmpC); dv.addScaledVector(up, -dv.dot(up)); if (dv.lengthSq() < 1e-6) dv.set(1, 0, 0); dv.normalize(); }
      else { dv.copy(body.worldPoint(root.lp, tmpB)).sub(sepWorld); const sg = Math.sign(dv.dot(dirWorld)) || -1; dv.copy(dirWorld).multiplyScalar(sg); }
      const ej = sepPart.def.ejection || (sepPart.sepType === 'radial' ? 3.0 : 2);
      const mA = body.mass, mB = nb.mass; const rel = ej;
      const dA = rel * mB / (mA + mB), dB = rel * mA / (mA + mB);
      body.vel.addScaledVector(dv, -dA); nb.vel.addScaledVector(dv, dB);
      nb.w.addScaledVector(new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5), 0.05);
      // liquid engines on debris shut down; solids keep burning. A stage with its own avionics (e.g. a booster) stays controllable.
      const keepsRoot = this.rootPartId && nb.partMap.has(this.rootPartId);
      if (keepsRoot && body.hasControl === false || (keepsRoot && nb.hasControl && !(body.partMap.has(this.rootPartId)))) { /* root went with the new body */ }
      if (keepsRoot && this.active === body) { this.active = nb; nb.isActive = true; nb.debris = false; body.isActive = false; this.carryInputs(nb); }
      if (nb.hasControl && nb !== this.active && nb.parts.some(p => p.def.control)) { nb.recoverable = true; nb.debris = false; body.debris = false;
        for (const p of nb.parts) if (p.engine && p.engine.liquid) { p.engine.throttleNow = 0; p.engine.on = true; }
        if (this.autoRecover) { this.setAutoland(nb, true); this.deployFins(nb, true); this.events.push({ t: 'log', msg: 'Booster auto-landing engaged' }); } else nb.autopilot = false;
        if (this.active === nb) this.carryInputs(nb);
      } else { for (const p of nb.parts) if (p.engine && p.engine.liquid && nb !== this.active) p.engine.on = false; if (nb !== this.active) nb.debris = true; }
      this.events.push({ t: 'separation', pos: sepWorld.clone() });
    }
    this.afterTopologyChange(body);
    return out;
  }
  splitSubtree(body, root) {
    const set = []; const walk = (p) => { set.push(p); for (const c of p.children) walk(c); }; walk(root);
    if (root.parent) { root.parent.children = root.parent.children.filter(c => c !== root); root.parent = null; root.linkRadial = false; }
    const idSet = new Set(set.map(p => p.id));
    body.parts = body.parts.filter(p => !idSet.has(p.id)); for (const id of idSet) body.partMap.delete(id);
    const nb = new Body(this, set);
    // kinematics: copy orientation & angular velocity, velocity of new COM from rigid motion about old COM
    nb.q.copy(body.q); nb.w.copy(body.w); nb.name = 'Stage ' + nb.id;
    const rel = tmpD.copy(nb.com).sub(body.com).applyQuaternion(body.q);
    nb.pos.copy(body.pos).add(rel); nb.vel.copy(body.vel).add(tmpE.crossVectors(body.w, rel));
    for (const p of nb.parts) for (const c of p.contacts) c.touch = body.world_touch || false;
    this.computeElectric(nb); nb.ec = Math.min(nb.ecCap, nb.ecCap * 0.5);
    this.computeLowest(nb); this.bodies.push(nb); nb.heat = body.heat;
    for (const p of nb.parts) this.setupPartAero(p);
    nb.debris = true; nb.recoverable = false;
    if (body === this.active && nb.hasControl && !body.parts.some(p => p.def.control)) { this.active = nb; nb.debris = false; nb.isActive = true; body.isActive = false; body.debris = true; this.events.push({ t: 'log', msg: 'Control transferred' }); }
    this.pruneDebris();
    return nb;
  }
  afterTopologyChange(body) {
    body.refresh(); this.computeElectric(body); body.ec = Math.min(body.ec, body.ecCap);
    for (const p of body.parts) { p.nbTop = p.nbTop; }
    // recompute neighbour radii for parts that lost children
    for (const p of body.parts) this.fixNeighbours(p);
    for (const p of body.parts) this.updateAeroEnds(p);
    if (!body.parts.length) { this.removeBody(body); }
  }
  fixNeighbours(p) {
    // after a separation, a part whose child left has an open node there
    const kids = p.children.filter(c => !c.linkRadial); let top = 0, bot = 0;
    const consider = (n, r) => { if (n === 'top') top = Math.max(top, r); else bot = Math.max(bot, r); };
    if (p.parent && !p.linkRadial) { const l = p.parentLink; const node = l.child === p.id ? l.cn : l.pn; const pr = p.parent.r; consider(node, pr); }
    for (const c of kids) { const l = c.parentLink; const node = l.parent === p.id ? l.pn : l.cn; consider(node, c.r); }
    p.nbTop = top; p.nbBot = bot;
  }
  removeBody(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); b.removed = true; if (this.active === b) this.active = this.bodies.find(x => x.hasControl) || this.bodies.find(x => !x.debris) || null; this.events.push({ t: 'bodyRemoved', body: b }); }
  pruneDebris() {
    const debris = this.bodies.filter(b => b.debris && !b.isActive);
    if (debris.length > this.maxDebris) {
      debris.sort((a, b) => (b.asleep - a.asleep) || (a.age < b.age ? 1 : -1));
      const kill = debris.slice(0, debris.length - this.maxDebris); for (const b of kill) this.removeBody(b);
    }
  }
  destroyPart(body, ps, reason = 'destroyed') {
    if (ps.dead) return; ps.dead = true;
    const wp = body.worldPoint(ps.lp, new V3());
    this.events.push({ t: 'explosion', pos: wp, size: Math.max(0.8, ps.r * 2 + ps.L * 0.5), reason, partId: ps.id });
    const kids = [...ps.children];
    for (const c of kids) { if (!c.dead) this.splitSubtree(body, c); }
    if (ps.parent) { ps.parent.children = ps.parent.children.filter(c => c !== ps); }
    body.parts = body.parts.filter(p => p !== ps); body.partMap.delete(ps.id);
    for (const pr of body.parts) if (pr.engine) pr.engine.sources = pr.engine.sources.filter(s => !s.dead);
    this.events.push({ t: 'partDestroyed', partId: ps.id, body });
    this.afterTopologyChange(body);
  }

  // -------------------------------------------------------------- vehicle control helpers (v2)
  carryInputs(nb) { let t = 0; for (const p of nb.parts) if (p.engine && p.engine.liquid) t = Math.max(t, p.engine.throttleNow); }
  setAutoland(b, on) { b.autoland = on; b.autopilot = on; b.apBurn = false; b.apDir = null; b.sasTarget = null; if (!on) { b.apThrottle = 0; } }
  toggleAutoland() { const b = this.active; if (!b) return false; this.setAutoland(b, !b.autoland); this.events.push({ t: 'log', msg: 'Auto-land ' + (b.autoland ? 'ENGAGED (suicide-burn guidance)' : 'off') }); return b.autoland; }
  deployFins(b, on) { for (const p of b.parts) if (p.surf && p.surf.stowDef) p.surf.stowTarget = on ? 0 : 1; }
  toggleFins() { const b = this.active; if (!b) return null; const fs = b.parts.filter(p => p.surf && p.surf.stowDef); if (!fs.length) return null; const on = fs[0].surf.stowTarget > 0.5; this.deployFins(b, on); return on; }
  cycleSasMode() { const modes = ['hold', 'prograde', 'retro', 'up']; this.inputs.sasMode = modes[(modes.indexOf(this.inputs.sasMode) + 1) % modes.length]; if (this.active) this.active.sasTarget = null; return this.inputs.sasMode; }
  switchActive() {
    const list = this.bodies.filter(b => !b.removed && b.hasControl && b.parts.length); if (list.length < 2 && this.active) return false;
    const i = list.indexOf(this.active); const nb = list[(i + 1) % list.length]; if (!nb || nb === this.active) return false;
    const old = this.active; if (old) { old.isActive = false; if (old.hasControl) { old.autopilot = old.autoland; old.debris = false; } else old.debris = true; for (const p of old.parts) if (p.engine && p.engine.liquid) p.engine.throttleNow = this.inputs.throttle; }
    this.active = nb; nb.isActive = true; nb.debris = false; nb.sasTarget = null; nb.sasI.set(0, 0, 0); if (nb.autoland) this.inputs.throttle = nb.apThrottle; else { let t = 0; for (const p of nb.parts) if (p.engine && p.engine.liquid) t = Math.max(t, p.engine.throttleNow); this.inputs.throttle = t; }
    this.events.push({ t: 'log', msg: 'Now controlling: ' + nb.name }); return true;
  }
  controllableCount() { return this.bodies.filter(b => !b.removed && b.hasControl && b.parts.length).length; }
  /** Lowest point of the body above the terrain (accurate, uses contact points). */
  groundClearance(b) {
    let lo = Infinity; const q = b.q;
    for (const p of b.parts) for (const c of p.contacts) { if (c.kind === 'leg' && p.leg.deployed < 0.5) continue; const r = c.kind === 'leg' ? tmpB.copy(p.leg.foot).applyQuaternion(p.lq).add(p.lp).sub(b.com) : tmpB.copy(c.lp).sub(b.com); r.applyQuaternion(q); const y = b.pos.y + r.y - this.terrain.heightAt(b.pos.x + r.x, b.pos.z + r.z); if (y < lo) lo = y; }
    return lo;
  }
  /** Suicide-burn landing guidance: sets b.apThrottle / b.apDir. */
  landingGuidance(b, dt, g) {
    const v = b.vel; const speed = v.length(); const clr = this.groundClearance(b); b.clearance = clr; const m = b.mass;
    const Fmax = Math.max(1, b.thrustMax || 1); const up = tmpA.set(0, 1, 0); const axis = tmpB.set(0, 1, 0).applyQuaternion(b.q); const cosT = Math.max(0.55, axis.y);
    const aAvail = Math.max(0.5, Fmax * cosT / m - g);
    if (b.contactCount > 0 && speed < 1.5) { b.apThrottle = 0; b.landedT += dt; b.apDir = new V3(0, 1, 0); if (b.landedT > 1.2) { this.setAutoland(b, false); this.events.push({ t: 'log', msg: 'Touchdown confirmed - auto-land complete' }); } return; }
    b.landedT = 0; const down = -v.y; const hv = Math.hypot(v.x, v.z);
    const burnH = down * down / (2 * 0.62 * aAvail) + down * 0.9 + 6;
    if (!b.apBurn && down > 2 && clr < burnH) { b.apBurn = true; this.events.push({ t: 'log', msg: 'Landing burn ignition' }); }
    // attitude: engines-first retrograde while coasting, blending to vertical near the ground
    if (speed > 12) { const w = b.apBurn ? Math.max(0, Math.min(1, clr / 90)) : 1; const d = new V3().copy(v).multiplyScalar(-1 / speed).multiplyScalar(w).addScaledVector(up, 1 - w); if (d.y < 0.35) { d.y = 0.35; } b.apDir = d.normalize(); } else b.apDir = new V3(0, 1, 0);
    if (!b.apBurn) { b.apThrottle = 0; return; }
    const h = Math.max(0, clr - 0.4); const vdes = Math.sqrt(2 * 0.6 * aAvail * h) * 0.97 + 0.5; const ff = 0.6 * aAvail * Math.min(1, h / 6);
    const aCmd = g + ff + 3.0 * (down - vdes) - hv * 0.0;
    b.apThrottle = Math.max(0, Math.min(1, aCmd * m / (Fmax * cosT)));
  }
  updateSurfaces(b, cmd, dt, rho, wind) {
    for (const p of b.parts) {
      const sf = p.surf; if (!sf) continue; const a = p.aero;
      sf.stow += Math.sign(sf.stowTarget - sf.stow) * Math.min(Math.abs(sf.stowTarget - sf.stow), dt / 1.6);
      let tgt = 0;
      if (cmd && cmd.c.lengthSq() > 1e-6 && b.hasControl && b.ec > 0 && sf.stow < 0.5 && rho > 1e-4) {
        const n = tmpA.copy(a.normal0).applyQuaternion(b.q), t = tmpB.copy(a.tan0).applyQuaternion(b.q); const r = tmpC.copy(a.center).sub(b.com).applyQuaternion(b.q);
        const vp = tmpD.crossVectors(b.w, r).add(b.vel).sub(wind); const rl = Math.max(0.3, r.length()); const mag = tmpE.crossVectors(r, n).dot(cmd.c) / rl;
        const sg = vp.dot(t) > 0 ? -1 : 1; tgt = Math.max(-1, Math.min(1, mag * sg * 2.5)) * sf.max * (vp.lengthSq() < 25 ? vp.lengthSq() / 25 : 1);
      }
      sf.defl += Math.max(-1.6 * dt, Math.min(1.6 * dt, tgt - sf.defl));
      if (a.normal0) { const cs = Math.cos(sf.defl), sn = Math.sin(sf.defl); a.normal.copy(a.normal0).multiplyScalar(cs).addScaledVector(a.tan0, sn); }
    }
  }
  /** Approximate centre of pressure (world) - for the debug overlay. */
  copWorld(b, out = new V3()) {
    let cn = 0; const acc = new V3();
    for (const p of b.parts) { const d = p.def; let c = 0; const a = p.aero;
      if (a.type === 'fin') c = (p.surf && p.surf.stow > 0.5) ? 0 : 3 * a.area * (a.k || 1); else if (d.model === 'cone') c = 2 * Math.PI * p.r * p.r; else if (d.model === 'adapter' || d.model === 'pod' || d.model === 'capsule') c = 2 * Math.PI * p.r * p.r * (1 - (d.topK || 1) ** 2);
      else if (d.model === 'engine') c = 2 * Math.PI * (Math.pow(d.bellK * 0.85 * p.r, 2) - Math.pow(0.9 * p.r, 2));
      if (c > 0) { cn += c; acc.addScaledVector(a.center || p.lp, c); } }
    if (cn < 0.01) return null; acc.multiplyScalar(1 / cn); return b.worldPoint(acc, out);
  }
  // -------------------------------------------------------------- stepping
  update(dtReal) {
    if (this.paused) return 0; const ts = this.settings.timeScale || 1; this.acc += Math.min(dtReal, 0.1) * ts; let n = 0;
    while (this.acc >= DT && n < 16) { this.step(DT); this.acc -= DT; n++; }
    return n;
  }
  step(dt) {
    this.time += dt; this.stepCount++;
    const bodies = this.bodies.slice();
    for (const b of bodies) { if (b.removed) continue; this.stepBody(b, dt); }
    this.autoStageCheck(dt);
  }
  autoStageCheck(dt) {
    if (!this.autoStage || !this.active || this.clampActive) return;
    const b = this.active; if (this.stageIndex >= this.stageCount) return;
    const fired = b.parts.filter(p => p.engine && p.engine.ignited && p.stage < this.stageIndex);
    const burning = fired.some(p => p.engine.thrust > 1 && p.engine.on);
    const hadAny = fired.length > 0;
    let nxt = this.stageIndex; while (nxt < this.stageCount && !this.stageHas(b, nxt)) nxt++; if (nxt >= this.stageCount) return;
    if (b.parts.every(p => !((p.engine && p.stage === nxt) || (p.sepType && this.stageOf(p, 'separate') === nxt)))) return; // chute-only stage stays manual
    if (this.reserve > 0 && burning) { for (const p of fired) { const e = p.engine; if (!e.on || !e.liquid) continue; const src = e.sources.filter(q => !q.dead); let f = 0, c = 0; for (const q of src) { f += q.fuel; c += q.fuelCap; } if (c > 0 && f / c < this.reserve) { e.on = false; this.events.push({ t: 'log', msg: 'MECO: propellant reserve for landing' }); } } }
    if (hadAny && !burning) { this.autoTimer += dt; if (this.autoTimer > 0.6) { this.autoTimer = 0; this.activateStage(); } } else this.autoTimer = 0;
    // also: if the next stage only contains separators/chutes and engines are all burnt out we still go through the above path
  }

  stepBody(b, dt) {
    b.age += dt; const s = this.settings;
    if (b.asleep) return;
    const F = b.force.set(0, 0, 0), T = b.torque.set(0, 0, 0);
    const R = tmpM.makeRotationFromQuaternion(b.q); const rel = (lp, out) => out.copy(lp).sub(b.com).applyQuaternion(b.q);
    const h = b.pos.y; const rho = this.densityAt(h), g = this.gravityAt(h); b.rho = rho;
    const vAirBase = tmpE.set(0, 0, 0);
    const windK = s.wind * Math.max(0, 1 - h / 15000); const windVec = new V3(windK, 0, windK * 0.3);
    // ---------------- engines
    let thrustNow = 0, thrustMax = 0; const inp = this.inputs; const isActive = b === this.active;
    const press = this.pressureRatio(h);
    if (b.autoland && b.hasControl) { this.landingGuidance(b, dt, g); if (isActive) inp.throttle = b.apThrottle; } else if (b.autoland) this.setAutoland(b, false);
    const cmd = (isActive || b.autopilot) ? this.attitudeCommand(b) : null;
    for (const p of b.parts) {
      const e = p.engine; if (!e) continue;
      e.thrust = 0; e.flame += (0 - e.flame) * 0.3;
      const tc = b.autoland ? b.apThrottle : isActive ? inp.throttle : (b.autopilot ? b.apThrottle : (e.on ? e.throttleNow : 0)); const thr = e.liquid ? tc * e.limit : e.limit; if (e.liquid && (isActive || b.autopilot)) e.throttleNow = tc;
      const isp = (e.ispVac + (e.ispSL - e.ispVac) * press) * (press < 0.5 ? 1 : 1);
      const ispEff = (e.ispVac * e.ispBoost * (1 - press) + e.ispSL * press);
      const maxMdot = e.mdot * (e.boost);
      thrustMax += maxMdot * ispEff * G0_STD;
      if (!e.ignited || !e.on || e.burnedOut) continue;
      if (e.liquid && thr <= 0.001) continue;
      let want = maxMdot * (e.liquid ? thr : 1) * dt, got = 0;
      if (e.liquid) got = this.drawFuel(e, want); else { got = Math.min(p.solid, want); if (!this.cheats.infFuel) p.solid -= got; if (p.solid <= 1e-6) { e.burnedOut = true; p.solid = 0; } }
      b.massDirty = true;
      if (got <= 0) { e.starved = true; if (e.liquid) { /* flameout when no fuel reachable */ e.flame = 0; } continue; }
      e.starved = false; const frac = got / (maxMdot * dt);
      const F0 = (got / dt) * ispEff * G0_STD; e.thrust = F0; thrustNow += F0; e.flame = Math.max(e.flame, frac);
      // thrust direction with gimbal
      const dir = tmpA.copy(p.axis).applyQuaternion(b.q); // world thrust direction (towards nose)
      if (e.gimbal > 0 && cmd) {
        const r = rel(e.pivot, tmpB); const rl = r.length(); if (rl > 0.05) {
          const rh = tmpC.copy(r).multiplyScalar(1 / rl); const dl = tmpD.crossVectors(cmd.c, rh).multiplyScalar(e.gimbal * -1);
          // delta = (tau x r)/|r| * gimbal, limited
          dl.copy(tmpD.crossVectors(cmd.c, rh)).multiplyScalar(e.gimbal);
          e.gimbalVec.copy(dl); dir.addScaledVector(dl, 1).normalize();
        }
      } else e.gimbalVec.set(0, 0, 0);
      const fv = tmpC.copy(dir).multiplyScalar(F0);
      F.add(fv); T.add(tmpB.crossVectors(rel(e.pivot, tmpD), fv));
      e.dirWorld = e.dirWorld || new V3(); e.dirWorld.copy(dir);
    }
    b.thrustNow = thrustNow; b.thrustMax = thrustMax;
    if (b.held) { if (thrustNow > 0) b.heldT = (b.heldT || 0) + dt; if (thrustNow > b.mass * g * 1.04 && b.heldT > 0.8 || b.heldT > 4) { b.held = false; if (b === this.active) { this.clampActive = false; } this.events.push({ t: 'liftoff' }); } }
    // ---------------- gravity
    F.y -= b.mass * g;
    // ---------------- aerodynamics
    b.dynQ = 0;
    this.updateSurfaces(b, cmd, dt, rho, windVec);
    if (rho > 1e-7) this.aero(b, F, T, rho, windVec);
    // ---------------- control torques (reaction wheels, RCS)
    if (cmd) this.applyControl(b, T, cmd, dt);
    // ---------------- electricity
    if (b.hasControl || b.ecCap > 0) this.electric(b, dt);
    // ---------------- ground contacts
    if (!b.held) this.ground(b, F, T, dt);
    // ---------------- heat
    this.heating(b, rho, dt, windVec);
    // ---------------- integrate
    if (b.massDirty) b.refresh();
    b.accel.copy(F).addScaledVector(tmpA.set(0, b.mass * g, 0), 1).multiplyScalar(1 / b.mass); // proper accel (non gravitational) approx
    if (b.held) { b.vel.set(0, 0, 0); b.w.set(0, 0, 0); return; }
    b.vel.addScaledVector(F, dt / b.mass);
    if (b.vel.lengthSq() > 4e8) b.vel.setLength(2e4);
    b.pos.addScaledVector(b.vel, dt);
    // angular
    const Rm = new M3().setFromMatrix4(tmpM.makeRotationFromQuaternion(b.q)); const Ri = new M3().copy(Rm).transpose();
    const w = b.w; const wl = tmpA.copy(w).applyMatrix3(Ri);       // body-frame w
    const Iw = tmpB.copy(wl).applyMatrix3(b.I);
    const tl = tmpC.copy(T).applyMatrix3(Ri);
    tl.sub(tmpD.crossVectors(wl, Iw));                            // gyroscopic
    const al = tl.applyMatrix3(b.Iinv); w.addScaledVector(al.applyMatrix3(Rm), dt);
    if (w.lengthSq() > 400) w.setLength(20);
    tmpQ.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(b.q); b.q.x += tmpQ.x; b.q.y += tmpQ.y; b.q.z += tmpQ.z; b.q.w += tmpQ.w; b.q.normalize();
    // parachute state machine + legs
    this.updateMisc(b, dt);
    // sleep
    if (b.contactCount > 0 && b.vel.lengthSq() < 0.0025 && b.w.lengthSq() < 0.0025 && thrustNow < 1 && !isActive && !b.autoland) { b.sleepTimer += dt; if (b.sleepTimer > 3) { b.asleep = true; b.vel.set(0, 0, 0); b.w.set(0, 0, 0); } } else b.sleepTimer = 0;
    // landed flag
    b.landed = b.contactCount > 0 && b.vel.lengthSq() < 0.04;
  }
  drawFuel(e, amount) {
    if (this.cheats.infFuel) { const src0 = e.sources.filter(p => !p.dead); if (src0.length) return amount; }
    const src = e.sources.filter(p => !p.dead && p.fuel > 1e-6); if (!src.length) return 0;
    let remaining = amount, taken = 0; let list = src;
    for (let it = 0; it < 3 && remaining > 1e-9 && list.length; it++) {
      const each = remaining / list.length; let next = [];
      for (const p of list) { const t = Math.min(p.fuel, each); p.fuel -= t; taken += t; remaining -= t; if (p.fuel > 1e-6) next.push(p); else p.fuel = 0; }
      list = next;
    }
    return taken;
  }
  attitudeCommand(b) {
    if (!b.hasControl && b.rcsTorque <= 0) return null;
    const isActive = b === this.active; const inp = this.inputs; const c = new V3();
    let user = false;
    if (isActive && !b.autoland) {
      const fr = inp.frame; const axisBody = tmpA.set(0, 1, 0).applyQuaternion(b.q);
      // user command: pitch about camera-right (W = nose away from camera => negative about right), yaw about forward, roll about body axis
      c.addScaledVector(fr.right, inp.pitch * -1); c.addScaledVector(fr.forward, inp.yaw); c.addScaledVector(axisBody, -inp.roll);
      user = c.length() > 0.001;
    }
    const sasOn = (isActive && !b.autoland) ? inp.sas : true;
    if (sasOn && b.hasControl && b.ec > 0) {
      if (user) { b.sasTarget = null; b.sasHold = 0; b.sasI.set(0, 0, 0); }
      else {
        // target direction for SAS modes (or the autopilot)
        let dir = null; const mode = isActive ? inp.sasMode : 'hold'; const sp = b.vel.length();
        if (b.autoland && b.apDir) dir = b.apDir;
        else if (isActive && mode === 'prograde' && sp > 2) dir = tmpC.copy(b.vel).multiplyScalar(1 / sp);
        else if (isActive && mode === 'retro' && sp > 2) dir = tmpC.copy(b.vel).multiplyScalar(-1 / sp);
        else if (isActive && mode === 'up') dir = tmpC.set(0, 1, 0);
        if (dir) { const ax = tmpD.set(0, 1, 0).applyQuaternion(b.q); b.sasTarget = (b.sasTarget || new Q4()).setFromUnitVectors(ax, dir).multiply(b.q); b.sasHold = 1; }
        else { b.sasHold += DT; if (!b.sasTarget && b.sasHold > 0.25) b.sasTarget = b.q.clone(); }
        const wrate = b.w; const Iavg = (b.I.elements[0] + b.I.elements[4] + b.I.elements[8]) / 3;
        if (b.sasTarget) {
          const err = tmpQ.copy(b.sasTarget).multiply(new Q4().copy(b.q).invert()); if (err.w < 0) { err.x *= -1; err.y *= -1; err.z *= -1; err.w *= -1; }
          const ev = new V3(err.x, err.y, err.z).multiplyScalar(2);
          const tauMax = Math.max(1, b.controlTorque + (inp.rcs ? b.rcsTorque : 0) + (b.thrustNow > 1 ? b.thrustNow : b.thrustMax * 0.3) * 0.05 * 3);
          const wn = 2.4; b.sasI.addScaledVector(ev, DT); b.sasI.clampScalar(-0.4, 0.4); const tau = tmpD.copy(ev).multiplyScalar(Iavg * wn * wn).addScaledVector(wrate, -2 * 0.9 * wn * Iavg).addScaledVector(b.sasI, Iavg * wn * wn * wn * 0.35);
          const cc = tau.multiplyScalar(1 / tauMax); if (cc.length() > 1) cc.normalize(); c.add(cc);
        } else { const tauMax = Math.max(1, b.controlTorque + b.thrustMax * 0.05 * 3); c.addScaledVector(wrate, -2 * Iavg / tauMax * 1.5); }
      }
    } else { b.sasTarget = null; }
    if (c.length() > 1) c.normalize();
    return { c, user };
  }
  applyControl(b, T, cmd, dt) {
    const c = cmd.c; if (c.lengthSq() < 1e-8) { b.rcsFiring = 0; return; }
    if (b.hasControl && b.ec > 0) { T.addScaledVector(c, b.controlTorque); b.ec = Math.max(0, b.ec - 0.04 * dt * c.length()); }
    b.rcsFiring = 0;
    if (this.inputs.rcs && b.rcsTorque > 0) {
      const use = 0.03 * dt * c.length(); let avail = 0; for (const p of b.parts) avail += p.mono;
      if (avail > use) { T.addScaledVector(c, b.rcsTorque); b.rcsFiring = c.length(); let rem = use; for (const p of b.parts) { if (p.mono > 0 && rem > 0) { const t = Math.min(p.mono, rem / Math.max(1, b.parts.filter(q => q.mono > 0).length)); p.mono -= t; } } b.massDirty = true; }
    }
  }
  electric(b, dt) {
    let gen = 0; if (b.ecCap > 0 || b.hasControl) {
      for (const p of b.parts) if (p.def.ecGen) { const n = tmpA.set(0, 0, 1).applyQuaternion(p.lq).applyQuaternion(b.q); gen += p.def.ecGen * (0.35 + 0.65 * Math.abs(n.dot(this.sunDir))) * p.k; }
    }
    const use = b.hasControl ? b.parts.reduce((s, p) => s + (p.def.control ? p.def.control.ecUse : 0), 0) : 0;
    b.ec = Math.max(0, Math.min(b.ecCap, b.ec + (gen - use) * dt));
    b.ecRate = gen - use;
  }
  aero(b, F, T, rho, wind) {
    const half = 0.5 * rho; const v = b.vel; let qmax = 0;
    for (const p of b.parts) {
      const a = p.aero; const c = a.center; const r = tmpB.copy(c).sub(b.com).applyQuaternion(b.q);
      const vp = tmpC.crossVectors(b.w, r).add(v).sub(wind);
      const sp2 = vp.lengthSq(); if (sp2 < 1e-4) continue; qmax = Math.max(qmax, half * sp2);
      const f = tmpD.set(0, 0, 0);
      if (a.type === 'cyl') {
        const ax = tmpE.copy(a.axis).applyQuaternion(b.q); const va = vp.dot(ax);
        // axial drag (exposed front/back area)
        const area = va > 0 ? a.areaF : a.areaB, cd = va > 0 ? a.cdF : a.cdB; f.addScaledVector(ax, -half * cd * area * Math.abs(va) * va);
        // lateral: cross-flow drag + linear normal force from cross-section changes (cones, flares)
        const vl = tmpA.copy(vp).addScaledVector(ax, -va); const sl = vl.length(); const V = Math.sqrt(sp2);
        f.addScaledVector(vl, -half * 1.1 * a.latArea * sl);
        if (a.dA) f.addScaledVector(vl, -half * 2 * a.dA * V * Math.max(-1, Math.min(1, va / (0.3 * V))));
      } else if (a.type === 'fin') {
        if (p.surf && p.surf.stow > 0.5) { if (p.chute && p.chute.f > 0.001) this.chuteForce(b, p, F, T, rho, wind, half); continue; }
        const n = tmpE.copy(a.normal).applyQuaternion(b.q); const vn = vp.dot(n); const V = Math.sqrt(sp2); const sa = Math.abs(vn) / V;
        const cn = 1.8 * sa * (1 + (6.0 / 1.8 - 1) / (1 + (sa / 0.25) * (sa / 0.25)));
        f.addScaledVector(n, -half * a.area * (a.k || 1) * V * V * cn * Math.sign(vn)); f.addScaledVector(vp, -half * 0.04 * a.area * V);
      } else { f.addScaledVector(vp, -half * 0.9 * a.area * Math.sqrt(sp2)); }
      // chute handled separately
      F.add(f); T.add(tmpA.crossVectors(r, f));
      if (p.chute && p.chute.f > 0.001) this.chuteForce(b, p, F, T, rho, wind, half);
    }
    b.dynQ = qmax;
  }
  chuteForce(b, p, F, T, rho, wind, half) {
    const ch = p.chute; const pos = tmpB.copy(p.lp).sub(b.com).applyQuaternion(b.q); const vp = tmpC.crossVectors(b.w, pos).add(b.vel).sub(wind); const sp = vp.length(); if (sp < 0.01) return;
    const q = half * sp * sp; if (q > 20000 && ch.state !== 'cut') { ch.state = 'cut'; ch.f = 0; this.events.push({ t: 'log', msg: 'Parachute torn off by dynamic pressure!' }); return; }
    const area = Math.PI * Math.pow(ch.canopy * ch.f, 2); let Cd = 2.1 * (0.35 + 0.65 * ch.f);
    let mag = half * Cd * area * sp; const maxF = b.mass * sp / DT * 0.5; // avoid overshoot
    const f = tmpD.copy(vp).multiplyScalar(-Math.min(mag, maxF / Math.max(sp, 1)));
    // canopy applied at canopy centre (above pack, trailing into the airflow)
    const lever = tmpA.copy(vp).multiplyScalar(-1 / sp).multiplyScalar(ch.canopy * ch.f * 1.8); const rr = tmpE.copy(pos).add(lever);
    F.add(f); T.add(tmpA.crossVectors(rr, f));
    ch.dir.copy(vp).multiplyScalar(-1 / sp);
  }
  ground(b, F, T, dt) {
    const pos = b.pos; const terr = this.terrain; const hT = terr.heightAt(pos.x, pos.z);
    const Nc = Math.max(4, b.prevContacts || 4); b.contactCount = 0; if (pos.y - b.radius > hT + 60) { b.prevContacts = 0; return; }
    const g = this.gravityAt(pos.y); const m = b.mass; let nLegs = 0, nRing = 0;
    for (const p of b.parts) { if (p.leg && p.leg.deployed > 0.5) nLegs++; }
    const n = tmpA; const crashList = [];
    const R = tmpM.makeRotationFromQuaternion(b.q);
    for (const p of b.parts) {
      if (p.dead) continue;
      for (const c of p.contacts) {
        if (c.kind === 'leg' && p.leg.deployed < 0.5) { c.touch = false; continue; }
        const r = tmpB.copy(c.lp).sub(b.com);
        if (c.kind === 'leg') { r.copy(p.leg.foot).multiplyScalar(1).applyQuaternion(p.lq).add(p.lp).sub(b.com); }
        r.applyQuaternion(b.q);
        const wx = pos.x + r.x, wy = pos.y + r.y, wz = pos.z + r.z; const gh = terr.heightAt(wx, wz); const depth = gh - wy;
        if (depth <= 0) { c.touch = false; continue; }
        terr.normalAt(wx, wz, n);
        const vp = tmpC.crossVectors(b.w, r).add(b.vel); const vn = vp.dot(n);
        const first = !c.touch; c.touch = true; b.contactCount++;
        if (first && -vn > p.crash && !b.held) { crashList.push([p, -vn]); }
        let k, cd;
        if (c.kind === 'leg') { k = m * 70 / Math.max(1, nLegs); cd = 2 * 0.65 * Math.sqrt(k * m / Math.max(1, nLegs)); }
        else { k = m * 900 / Nc; cd = 2 * 0.6 * Math.sqrt(k * m / Nc); }
        let fn = k * depth - (vn < 0 ? cd * vn : cd * vn * 0.3); if (fn < 0) fn = 0;
        fn = Math.min(fn, m * g * 30 + 1e5 * 0 + m * 40);
        const f = tmpD.copy(n).multiplyScalar(fn);
        const vt = tmpE.copy(vp).addScaledVector(n, -vn); const vtl = vt.length();
        const mu = 0.9; f.addScaledVector(vt, -mu * fn / Math.max(vtl, 0.15));
        F.add(f); T.add(tmpE.crossVectors(r, f));
      }
    }
    b.prevContacts = b.contactCount;
    if (b.contactCount > 0) { b.w.multiplyScalar(0.9985); }
    if (this.cheats.god) crashList.length = 0;
    for (const [p, sp] of crashList) { if (!p.dead && b.partMap.has(p.id)) { b.maxImpact = Math.max(b.maxImpact, sp); this.destroyPart(b, p, 'crash'); } }
  }
  heating(b, rho, dt, wind) {
    const v = tmpA.copy(b.vel).sub(wind); const sp = v.length(); if (rho < 1e-6 || sp < 200) { b.heat = Math.max(0, b.heat - 0.05 * dt); return; }
    const flux = 1.7e-4 * Math.sqrt(rho / 0.6) * sp * sp * sp; let rate = Math.max(0, flux - 4e5) / 6e6;
    const vh = v.multiplyScalar(1 / sp); let protectedBy = null;
    for (const p of b.parts) { if (p.heatProt > 0) { const out = tmpB.set(0, -1, 0).applyQuaternion(p.lq).applyQuaternion(b.q); if (out.dot(vh) < -0.55) protectedBy = p; } }
    // facing check: shield outward normal is local -Y (bottom). It protects when it faces the oncoming air (airflow comes from -v direction)
    for (const p of b.parts) { if (p.heatProt > 0) { const out = tmpB.set(0, -1, 0).applyQuaternion(p.lq).applyQuaternion(b.q); if (out.dot(vh) < -0.55) protectedBy = p; else if (!protectedBy) protectedBy = null; } }
    if (protectedBy) { rate *= 0.04; protectedBy.heatProt = Math.max(0, protectedBy.heatProt - flux * 2e-7 * dt * 60); protectedBy.ablated = true; }
    b.heat = Math.max(0, b.heat + rate * dt - 0.04 * dt);
    if (this.cheats.god || this.cheats.noHeat) b.heat = Math.min(b.heat, 0.9);
    if (b.heat > 1.0 && b.parts.length) {
      b.heatT += dt; if (b.heatT > 1.2) { b.heatT = 0; let worst = null, ws = -1e9; for (const p of b.parts) { const s = tmpB.copy(p.lp).sub(b.com).applyQuaternion(b.q).dot(vh) + (p.heatProt > 0 ? -50 : 0); if (s > ws) { ws = s; worst = p; } }
        if (worst) this.destroyPart(b, worst, 'heat'); b.heat = 0.8; }
    }
  }
  updateMisc(b, dt) {
    for (const p of b.parts) {
      if (p.chute) { const c = p.chute; if (c.state === 'deploying') { c.t += dt; c.f = Math.min(1, c.t / 4); if (c.f >= 1) c.state = 'deployed'; } }
      if (p.leg) { const l = p.leg; const d = l.target - l.deployed; l.deployed += Math.sign(d) * Math.min(Math.abs(d), dt / 1.5); }
    }
  }
  // -------------------------------------------------------------- queries for HUD
  telemetry() {
    const b = this.active; if (!b) return null; const h = b.pos.y; const terrH = this.terrain.heightAt(b.pos.x, b.pos.z);
    const g = this.gravityAt(h); const ft = b.fuelTotals(); const hv = Math.hypot(b.vel.x, b.vel.z);
    const engines = b.parts.filter(p => p.engine);
    return { altitude: h - (b.lowest || 0) * 0 , radar: Math.max(0, h + (b.lowest || 0) - terrH), speed: b.vel.length(), vspeed: b.vel.y, hspeed: hv, accel: b.accel.length(), accelG: b.accel.length() / G0_STD, mass: b.mass, thrust: b.thrustNow, thrustMax: b.thrustMax,
      twr: b.thrustMax / (b.mass * g), twrNow: b.thrustNow / (b.mass * g), liquid: ft.liquid, liquidCap: ft.liquidCap, solid: ft.solid, solidCap: ft.solidCap, mono: ft.mono, throttle: this.inputs.throttle, ec: b.ec, ecCap: b.ecCap, ecRate: b.ecRate || 0,
      stage: this.stageIndex, stageCount: this.stageCount, g, rho: b.rho, q: b.dynQ, heat: b.heat, landed: b.landed, hasControl: b.hasControl,
      engines: engines.map(p => ({ name: p.def.name, id: p.id, ignited: p.engine.ignited, on: p.engine.on, thrust: p.engine.thrust, burnedOut: p.engine.burnedOut, starved: p.engine.starved, liquid: p.engine.liquid, stage: p.stage })),
      chutes: b.parts.filter(p => p.chute).map(p => p.chute.state), legs: b.parts.some(p => p.leg), sas: this.inputs.sas, rcs: this.inputs.rcs, bodies: this.bodies.length, parts: b.parts.length, sasMode: this.inputs.sasMode, autoland: b.autoland, apBurn: b.apBurn, clearance: b.clearance, fins: b.parts.some(p => p.surf && p.surf.stowDef) ? (b.parts.find(p => p.surf && p.surf.stowDef).surf.stowTarget < 0.5 ? 'out' : 'stowed') : null, controllable: this.controllableCount(), vehicle: b.name };
  }
}

