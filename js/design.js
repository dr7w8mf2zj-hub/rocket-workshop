// Construction data model: parts, attachment links (stack + radial), tree layout, validation, staging, serialisation, undo/redo.
import * as THREE from 'three';
import { PARTS, geom, engineGeom, nodes, radiusAt, radialOffset, partMass, fuelCapacity, solidCapacity, engineStats, defaultAppearance, defaultDims, fillDims } from './registry.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const Q = (a) => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
const UP = new THREE.Vector3(0, 1, 0);
export const SCHEMA = 'rocket-workshop-design';
export const SCHEMA_VERSION = 1;

export class Design {
  constructor() { this.reset(); }
  reset() {
    this.name = 'Untitled Rocket'; this.idCode = 'RW-001';
    this.parts = new Map(); this.links = []; this.rootId = null; this._n = 1; this.settings = { symmetry: 1, autoStage: false };
  }
  newId() { return 'p' + (this._n++); }
  get(id) { return this.parts.get(id); }
  def(part) { return PARTS[part.type]; }
  all() { return [...this.parts.values()]; }

  // ---------------------------------------------------------------- part management
  addPart(type, o = {}) {
    const def = PARTS[type]; if (!def) throw new Error('unknown part ' + type);
    const id = o.id || this.newId();
    const part = {
      id, type, pos: o.pos ? [...o.pos] : [0, 0, 0], quat: o.quat ? [...o.quat] : [0, 0, 0, 1],
      dims: fillDims(def, o.dims), appearance: Object.assign(defaultAppearance(), o.appearance || {}),
      config: Object.assign({ fill: 1, thrustLimit: 1, gimbal: true, sep: !!def.radialSep, canopyDeploy: 'manual' }, o.config || {}),
      stage: o.stage != null ? o.stage : -1, sepStage: o.sepStage != null ? o.sepStage : -1, label: o.label || '',
    };
    this.parts.set(id, part); if (!this.rootId) this.rootId = id;
    return part;
  }
  removePart(id) {
    const p = this.parts.get(id); if (!p) return;
    this.links = this.links.filter(l => l.parent !== id && l.child !== id);
    this.parts.delete(id);
    if (this.rootId === id) this.rootId = null;
  }
  removeSubtree(id) { for (const s of this.subtree(id)) this.removePart(s); }
  duplicate(id, withChildren = true, offset = [0.8, 0, 0]) {
    const ids = withChildren ? this.subtree(id) : [id]; const map = new Map(); const out = [];
    for (const sid of ids) {
      const s = this.parts.get(sid);
      const c = this.addPart(s.type, { pos: [s.pos[0] + offset[0], s.pos[1] + offset[1], s.pos[2] + offset[2]], quat: s.quat, dims: JSON.parse(JSON.stringify(s.dims)), appearance: JSON.parse(JSON.stringify(s.appearance)), config: JSON.parse(JSON.stringify(s.config)), stage: s.stage, sepStage: s.sepStage, label: s.label });
      map.set(sid, c.id); out.push(c);
    }
    for (const l of this.links) if (map.has(l.parent) && map.has(l.child)) this.links.push({ ...l, radial: l.radial ? { ...l.radial } : null, parent: map.get(l.parent), child: map.get(l.child) });
    return out;
  }
  // ---------------------------------------------------------------- links
  parentLink(id) { return this.links.find(l => l.child === id) || null; }
  childLinks(id) { return this.links.filter(l => l.parent === id); }
  parentOf(id) { const l = this.parentLink(id); return l ? l.parent : null; }
  childrenOf(id) { return this.childLinks(id).map(l => l.child); }
  link(parent, child, info) {
    this.unlink(child);
    this.links.push({ parent, child, pn: info.pn || null, cn: info.cn || null, radial: info.radial ? { ang: info.radial.ang, y: info.radial.y } : null, roll: info.roll || 0 });
  }
  unlink(child) { this.links = this.links.filter(l => l.child !== child); }
  subtree(id) { const out = [id]; for (let i = 0; i < out.length; i++) for (const c of this.childrenOf(out[i])) out.push(c); return out; }
  componentRoot(id) { let cur = id, guard = 0; while (this.parentOf(cur) && guard++ < 999) cur = this.parentOf(cur); return cur; }
  component(id) { return this.subtree(this.componentRoot(id)); }
  isDescendant(id, ancestor) { return this.subtree(ancestor).includes(id); }
  occupied(partId, nodeId) { return this.links.some(l => (l.parent === partId && l.pn === nodeId) || (l.child === partId && l.cn === nodeId)); }

  // ---------------------------------------------------------------- transforms / layout
  nodesOf(part) { return nodes(PARTS[part.type], part.dims); }
  worldNodes(part) {
    const q = Q(part.quat), p = V(part.pos);
    return this.nodesOf(part).map(n => ({ id: n.id, r: n.r, pos: V(n.p).applyQuaternion(q).add(p), dir: V(n.d).applyQuaternion(q), partId: part.id }));
  }
  /** Compute transform of `child` given parent and link (stack or radial). */
  childTransform(link, parent, child) {
    const pd = PARTS[parent.type], cd = PARTS[child.type];
    const Pp = V(parent.pos), Qp = Q(parent.quat);
    if (link.radial) {
      const { ang, y } = link.radial; const L = geom(pd, parent.dims).L;
      const yy = Math.max(-L / 2, Math.min(L / 2, y)); const rH = radiusAt(pd, parent.dims, yy);
      const u = new THREE.Vector3(Math.cos(ang), 0, -Math.sin(ang));
      const outward = u.clone().applyQuaternion(Qp); const axis = UP.clone().applyQuaternion(Qp);
      const z = new THREE.Vector3().crossVectors(outward, axis);
      const m = new THREE.Matrix4().makeBasis(outward, axis, z); const qc = new THREE.Quaternion().setFromRotationMatrix(m);
      const contact = u.clone().multiplyScalar(rH).add(new THREE.Vector3(0, yy, 0)).applyQuaternion(Qp).add(Pp);
      const pos = contact.add(outward.multiplyScalar(radialOffset(cd, child.dims)));
      return { pos, quat: qc };
    }
    const pn = nodes(pd, parent.dims).find(n => n.id === link.pn), cn = nodes(cd, child.dims).find(n => n.id === link.cn);
    if (!pn || !cn) return null;
    const Np = V(pn.p).applyQuaternion(Qp).add(Pp), Dp = V(pn.d).applyQuaternion(Qp);
    const dc = V(cn.d);
    const qb = new THREE.Quaternion().setFromUnitVectors(dc, Dp.clone().negate());
    const qr = new THREE.Quaternion().setFromAxisAngle(Dp, link.roll || 0);
    const qc = qr.multiply(qb);
    const pos = Np.sub(V(cn.p).applyQuaternion(qc));
    return { pos, quat: qc };
  }
  layout() {
    const done = new Set();
    const visit = (id) => {
      for (const l of this.childLinks(id)) {
        const par = this.parts.get(l.parent), ch = this.parts.get(l.child); if (!par || !ch || done.has(ch.id)) continue;
        const t = this.childTransform(l, par, ch);
        if (t) { ch.pos = t.pos.toArray(); ch.quat = t.quat.toArray(); }
        done.add(ch.id); visit(ch.id);
      }
    };
    for (const p of this.parts.values()) if (!this.parentOf(p.id)) visit(p.id);
  }
  /** Apply rigid motion (about origin of world) to ids. */
  transformIds(ids, fn) { // fn(pos:Vector3, quat:Quaternion) mutates
    for (const id of ids) { const p = this.parts.get(id); const pos = V(p.pos), q = Q(p.quat); fn(pos, q); p.pos = pos.toArray(); p.quat = q.toArray(); }
  }
  move(ids, delta) { this.transformIds(ids, (p) => p.add(delta)); }
  /** Rotate ids about a pivot by quaternion dq (world frame). */
  rotateAbout(ids, pivot, dq) { this.transformIds(ids, (p, q) => { p.sub(pivot).applyQuaternion(dq).add(pivot); q.premultiply(dq); }); }
  bounds(ids) {
    const box = new THREE.Box3();
    for (const id of ids) { const p = this.parts.get(id), d = PARTS[p.type]; const { r, L } = geom(d, p.dims); const rr = d.stack === 'none' ? Math.max(r, ...Object.values(fillDims(d, p.dims)).slice(0, 2)) : Math.max(r, L / 2); box.expandByPoint(V(p.pos).addScalar(rr)); box.expandByPoint(V(p.pos).addScalar(-rr)); }
    return box;
  }

  // ---------------------------------------------------------------- vehicle / roots
  flightRoot() {
    if (this.rootId && this.parts.has(this.rootId)) return this.rootId;
    for (const p of this.parts.values()) if (PARTS[p.type].control) return p.id;
    return this.parts.size ? this.parts.keys().next().value : null;
  }
  setRoot(id) { if (this.parts.has(id)) this.rootId = id; }
  /** Parts connected to the flight root (undirected). Oriented edges: [{near, far, link}] */
  vehicle() {
    const root = this.flightRoot(); if (!root) return { root: null, ids: [], edges: [], parent: new Map() };
    const adj = new Map(); for (const l of this.links) { (adj.get(l.parent) || adj.set(l.parent, []).get(l.parent)).push([l.child, l]); (adj.get(l.child) || adj.set(l.child, []).get(l.child)).push([l.parent, l]); }
    const seen = new Set([root]); const q = [root]; const edges = []; const parent = new Map();
    while (q.length) { const a = q.shift(); for (const [b, l] of adj.get(a) || []) { if (seen.has(b)) continue; seen.add(b); q.push(b); edges.push({ near: a, far: b, link: l }); parent.set(b, { id: a, link: l }); } }
    return { root, ids: [...seen], edges, parent };
  }
  isSeparator(part) { const d = PARTS[part.type]; if (d.sep && d.id === 'decoupler') return true; if (d.sep && part.stage >= 0) return true; return !!(PARTS[part.type].radialSep && part.config.sep && this.parentLink(part.id) && this.parentLink(part.id).radial); }
  /** Tanks reachable from engine without passing separators / engines. */
  fuelSources(engineId) {
    const out = []; const seen = new Set([engineId]); const q = [engineId];
    const adj = (id) => this.links.filter(l => l.parent === id || l.child === id).map(l => [l.parent === id ? l.child : l.parent, l]);
    while (q.length) {
      const a = q.shift();
      for (const [b, l] of adj(a)) {
        if (seen.has(b)) continue; const bp = this.parts.get(b), bd = PARTS[bp.type];
        if (this.isSeparator(bp) || bd.engine && b !== engineId) continue;
        // radial-separated boosters are cut off from the core's fuel
        const ap = this.parts.get(a);
        if ((this.isSeparator(ap) && a !== engineId)) continue;
        seen.add(b); if (bd.fuel) out.push(b); q.push(b);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- staging
  stageCapable() { return this.all().filter(p => { const d = PARTS[p.type]; return d.engine || d.chute || d.id === 'decoupler' || d.sep || (d.radialSep && p.config.sep && this.parentLink(p.id)?.radial); }); }
  stageCount() { let m = -1; for (const p of this.parts.values()) m = Math.max(m, p.stage, p.sepStage); return m + 1; }
  /** Staging items: one per action. [{id, action:'ignite'|'separate'|'deploy', stage}] for the flight vehicle. */
  stageItems() {
    const veh = this.vehicle(); const out = [];
    for (const id of veh.ids) {
      const p = this.parts.get(id), d = PARTS[p.type]; const rad = !!veh.parent.get(id)?.link.radial;
      if (d.engine) out.push({ id, action: 'ignite', stage: p.stage });
      if (d.chute) out.push({ id, action: 'deploy', stage: p.stage });
      if (d.id === 'decoupler' || d.id === 'docking_port') out.push({ id, action: 'separate', stage: p.stage });
      if (d.radialSep && p.config.sep && rad) out.push({ id, action: 'separate', stage: p.sepStage });
    }
    return out;
  }
  setItemStage(id, action, stage) { const p = this.parts.get(id); if (!p) return; const d = PARTS[p.type]; if (action === 'separate' && d.engine) p.sepStage = stage; else p.stage = stage; }
  autoStage() {
    const veh = this.vehicle(); const ids = new Set(veh.ids);
    const stackSep = (p) => PARTS[p.type].id === 'decoupler';
    const radSep = (p) => PARTS[p.type].radialSep && p.config.sep && !!veh.parent.get(p.id)?.link.radial;
    const depth = (p) => { let n = 0; let cur = veh.parent.get(p.id); while (cur) { const pp = this.parts.get(cur.id); if (pp && stackSep(pp)) n++; cur = veh.parent.get(cur.id); } return n; };
    const engs = [], dec = [], rad = [], chutes = [];
    for (const p of this.parts.values()) {
      const d = PARTS[p.type]; p.stage = -1; p.sepStage = -1; if (!ids.has(p.id)) continue;
      if (d.engine) engs.push(p); if (d.chute) chutes.push(p); if (stackSep(p)) dec.push(p); if (radSep(p)) rad.push(p);
    }
    const maxD = Math.max(0, ...engs.map(depth), ...dec.map(p => depth(p) + 1));
    let idx = 0;
    for (let ph = 0; ph <= maxD; ph++) {
      const dd = maxD - ph; let any = false;
      for (const e of engs) if (depth(e) === dd) { e.stage = idx; any = true; }
      for (const s of dec) if (depth(s) === dd) { s.stage = idx; any = true; }
      if (any) idx++;
      const rs = rad.filter(r => depth(r) === dd); if (rs.length) { for (const r of rs) { if (PARTS[r.type].engine) r.sepStage = idx; else r.stage = idx; } idx++; }
    }
    chutes.forEach(c => { c.stage = idx; });
  }
  isSepNodeOld(p, veh) { const d = PARTS[p.type]; return d.id === 'decoupler' || (d.radialSep && p.config.sep && veh.parent.get(p.id)?.link.radial) || (d.sep && d.id === 'docking_port' && p.stage >= 0); }

  // ---------------------------------------------------------------- stats & validation
  stats() {
    const veh = this.vehicle(); let dry = 0, fuel = 0, solid = 0, thrust0 = 0, thrustAll = 0, ec = 0, burn0 = 0;
    for (const id of veh.ids) {
      const p = this.parts.get(id), d = PARTS[p.type]; dry += partMass(d, p.dims);
      const f = fuelCapacity(d, p.dims) * p.config.fill; fuel += f; const s = solidCapacity(d, p.dims) * p.config.fill; solid += s;
      if (d.ec) ec += d.ec;
      const es = engineStats(d, p.dims);
      if (es) { thrustAll += es.thrust; if (p.stage === 0 || p.stage === -1 && false) { thrust0 += es.thrust; } }
    }
    const wet = dry + fuel + solid;
    return { parts: veh.ids.length, dry, fuel: fuel + solid, wet, thrust0, thrustAll, twr: thrust0 > 0 ? thrust0 / (wet * 9.81) : 0, ec };
  }
  validate() {
    const out = []; const add = (level, msg, ids = []) => out.push({ level, msg, ids });
    if (!this.parts.size) { add('error', 'The workshop is empty. Add parts from the inventory.'); return out; }
    const veh = this.vehicle(); const inVeh = new Set(veh.ids);
    const loose = this.all().filter(p => !inVeh.has(p.id));
    if (loose.length) add('warn', `${loose.length} part(s) not connected to the main assembly (they will be left behind): ${loose.slice(0, 4).map(p => PARTS[p.type].name).join(', ')}${loose.length > 4 ? '…' : ''}`, loose.map(p => p.id));
    const vp = veh.ids.map(id => this.parts.get(id));
    if (!vp.some(p => PARTS[p.type].control)) add('warn', 'No flight control module: the rocket cannot be steered.');
    const engines = vp.filter(p => PARTS[p.type].engine);
    if (!engines.length) add('error', 'No engines in the main assembly: the rocket cannot launch.');
    for (const e of engines) {
      const d = PARTS[e.type];
      if (d.engine.liquid) { const src = this.fuelSources(e.id); if (!src.some(id => this.parts.get(id).config.fill > 0)) add('error', `${d.name} has no fuel tank connected (fuel cannot cross decouplers/engines).`, [e.id]); }
      if (e.stage < 0) add('warn', `${d.name} is not assigned to a stage and will never ignite. Use the staging editor.`, [e.id]);
    }
    for (const p of vp) { const d = PARTS[p.type];
      if (d.engine && d.engine.liquid) {  // engine pointing up check
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(Q(p.quat)); const rootUp = new THREE.Vector3(0, 1, 0).applyQuaternion(Q(this.parts.get(veh.root).quat));
        if (up.dot(rootUp) < 0.5) add('warn', `${d.name} is not pointing along the rocket axis.`, [p.id]);
      }
      if (d.chute && p.stage < 0) add('info', 'Parachute is not staged: deploy manually with P.', [p.id]);
    }
    // stack radius mismatches
    for (const l of this.links) { if (l.radial) continue; const a = this.parts.get(l.parent), b = this.parts.get(l.child); if (!a || !b) continue;
      const ra = nodes(PARTS[a.type], a.dims).find(n => n.id === l.pn)?.r, rb = nodes(PARTS[b.type], b.dims).find(n => n.id === l.cn)?.r;
      if (ra && rb && Math.abs(ra - rb) / Math.max(ra, rb) > 0.35) add('warn', `Radius mismatch between ${PARTS[a.type].name} and ${PARTS[b.type].name} (${ra.toFixed(2)} m vs ${rb.toFixed(2)} m).`, [a.id, b.id]);
    }
    { // landing legs must reach lower than the engine bells, or the nozzle takes the impact
      const ax = UP.clone().applyQuaternion(Q(this.parts.get(veh.root).quat)); const legs = vp.filter(p => PARTS[p.type].leg);
      if (legs.length) { let footLo = Infinity, engLo = Infinity;
        for (const p of legs) footLo = Math.min(footLo, V(p.pos).dot(ax) - (0.78 * geom(PARTS[p.type], p.dims).L + 0.05));
        for (const e of engines) { const g = engineGeom(PARTS[e.type], e.dims); engLo = Math.min(engLo, V(e.pos).dot(ax) + g.exitY); }
        if (engLo < footLo - 0.05) add('warn', `Landing legs are ${(footLo - engLo).toFixed(1)} m too short: the engine nozzle would touch down first. Scale the legs up or mount them lower.`, legs.map(p => p.id)); }
    }
    const st = this.stats();
    if (engines.length) { const s0 = engines.filter(e => e.stage === 0); if (s0.length && st.twr < 1) add('warn', `Thrust-to-weight at launch is ${st.twr.toFixed(2)} (< 1): the rocket will not lift off.`); }
    // overlaps
    const sp = vp.filter(p => PARTS[p.type].stack !== 'none' && !this.parentLink(p.id)?.radial);
    for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
      const a = sp[i], b = sp[j]; if (this.areLinked(a.id, b.id)) continue;
      const ga = geom(PARTS[a.type], a.dims), gb = geom(PARTS[b.type], b.dims); const dv = V(a.pos).sub(V(b.pos));
      const ax = UP.clone().applyQuaternion(Q(a.quat)); const bx = UP.clone().applyQuaternion(Q(b.quat));
      if (Math.abs(ax.dot(bx)) < 0.95) continue; const axial = Math.abs(dv.dot(ax)); const lat = dv.clone().addScaledVector(ax, -dv.dot(ax)).length();
      if (axial < (ga.L + gb.L) / 2 * 0.8 && lat < (ga.r + gb.r) * 0.7) add('warn', `${PARTS[a.type].name} overlaps ${PARTS[b.type].name}.`, [a.id, b.id]);
    }
    const stab = this.stability();
    if (stab && engines.length) { if (stab.marginFull < 0) add('warn', `Aerodynamically unstable (centre of pressure is ahead of the centre of mass by ${(-stab.marginFull).toFixed(2)} calibres). Add fins near the bottom.`); else if (stab.marginEmpty < 0) add('warn', `Stable at launch (${stab.marginFull.toFixed(2)} cal) but becomes unstable as fuel burns off (${stab.marginEmpty.toFixed(2)} cal). Add larger fins.`); }
    if (!out.some(o => o.level === 'error' || o.level === 'warn')) add('ok', 'Assembly valid. Ready for launch.');
    return out;
  }
  /** Static aerodynamic stability: centre of mass vs centre of pressure along the rocket axis (same coefficients as the flight model). */
  stability() {
    const veh = this.vehicle(); if (!veh.ids.length) return null; const root = this.parts.get(veh.root);
    const axis = UP.clone().applyQuaternion(Q(root.quat)); const o = V(root.pos);
    let mFull = 0, mEmpty = 0, cFull = 0, cEmpty = 0, cn = 0, cnx = 0, rmax = 0.1;
    for (const id of veh.ids) {
      const p = this.parts.get(id), d = PARTS[p.type]; const g = geom(d, p.dims); const y = V(p.pos).sub(o).dot(axis);
      const dry = partMass(d, p.dims), fuel = (fuelCapacity(d, p.dims) + solidCapacity(d, p.dims)) * p.config.fill;
      mFull += dry + fuel; cFull += (dry + fuel) * y; mEmpty += dry; cEmpty += dry * y;
      if (d.stack !== 'none') rmax = Math.max(rmax, g.r);
      let c = 0, yy = y;
      if (d.finArea) { c = 6.0 * p.dims.span * p.dims.chord * 0.5; }
      else if (d.model === 'cone') c = 2 * Math.PI * g.r * g.r;
      else if (d.model === 'adapter' || d.model === 'pod') c = 2 * Math.PI * g.r * g.r * (1 - d.topK * d.topK);
      else if (d.model === 'engine') { c = 2 * Math.PI * (Math.pow(d.bellK * 0.85 * g.r, 2) - Math.pow(0.9 * g.r, 2)); }
      if (d.id === 'solar_panels') c = 6.0 * p.dims.length * p.dims.width;  // conservative: worst-case plane
      if (c) { cn += c; cnx += c * yy; }
    }
    if (!(mFull > 0)) return null;
    const comF = cFull / mFull, comE = cEmpty / mEmpty; const cop = cn > 0.01 ? cnx / cn : null;
    const mf = cop == null ? -9 : (comF - cop) / (2 * rmax), me = cop == null ? -9 : (comE - cop) / (2 * rmax);
    const toWorld = (yv) => o.clone().addScaledVector(axis, yv);
    // lateral COM offset: use actual mass-weighted centre for the marker
    const com = new THREE.Vector3(); let mt = 0; for (const id of veh.ids) { const p = this.parts.get(id), d = PARTS[p.type]; const m = partMass(d, p.dims) + (fuelCapacity(d, p.dims) + solidCapacity(d, p.dims)) * p.config.fill; com.addScaledVector(V(p.pos), m); mt += m; }
    com.multiplyScalar(1 / mt);
    return { com, cop: cop == null ? null : toWorld(cop), marginFull: mf, marginEmpty: me, axis };
  }
  areLinked(a, b) { return this.links.some(l => (l.parent === a && l.child === b) || (l.parent === b && l.child === a)); }

  // ---------------------------------------------------------------- serialisation
  toJSON() {
    return { schema: SCHEMA, version: SCHEMA_VERSION, name: this.name, idCode: this.idCode, rootId: this.rootId, nextId: this._n, settings: { ...this.settings },
      parts: this.all().map(p => ({ id: p.id, type: p.type, pos: p.pos.map(round6), quat: p.quat.map(round6), dims: { ...p.dims }, appearance: { ...p.appearance }, config: { ...p.config }, stage: p.stage, sepStage: p.sepStage, label: p.label })),
      links: this.links.map(l => ({ ...l, radial: l.radial ? { ...l.radial } : null })) };
  }
  fromJSON(j) {
    if (!j || j.schema !== SCHEMA || !Array.isArray(j.parts)) throw new Error('Not a Rocket Workshop design file');
    this.reset(); this.name = j.name || 'Imported Rocket'; this.idCode = j.idCode || 'RW-001'; this.settings = Object.assign({ symmetry: 1, autoStage: false }, j.settings || {});
    for (const p of j.parts) { if (!PARTS[p.type]) continue; this.addPart(p.type, p); const q = this.parts.get(p.id); q.stage = p.stage != null ? p.stage : -1; q.sepStage = p.sepStage != null ? p.sepStage : -1; }
    this._n = Math.max(j.nextId || 1, ...[...this.parts.keys()].map(k => parseInt(k.slice(1)) + 1 || 1));
    this.rootId = j.rootId && this.parts.has(j.rootId) ? j.rootId : (this.parts.size ? this.parts.keys().next().value : null);
    for (const l of j.links || []) if (this.parts.has(l.parent) && this.parts.has(l.child)) this.links.push({ parent: l.parent, child: l.child, pn: l.pn || null, cn: l.cn || null, radial: l.radial || null, roll: l.roll || 0 });
    this.layout();
    return this;
  }
}
const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** Snapshot-based undo/redo. */
export class History {
  constructor(design, limit = 120) { this.design = design; this.undoStack = []; this.redoStack = []; this.limit = limit; this.listeners = []; }
  snap() { return JSON.stringify(this.design.toJSON()); }
  commit() { this.undoStack.push(this.snap()); if (this.undoStack.length > this.limit) this.undoStack.shift(); this.redoStack.length = 0; this.emit(); }
  init() { this.undoStack = [this.snap()]; this.redoStack = []; this.emit(); }
  undo() { if (this.undoStack.length < 2) return false; this.redoStack.push(this.undoStack.pop()); this.design.fromJSON(JSON.parse(this.undoStack[this.undoStack.length - 1])); this.emit(); return true; }
  redo() { if (!this.redoStack.length) return false; const s = this.redoStack.pop(); this.undoStack.push(s); this.design.fromJSON(JSON.parse(s)); this.emit(); return true; }
  get canUndo() { return this.undoStack.length > 1; }
  get canRedo() { return this.redoStack.length > 0; }
  emit() { this.listeners.forEach(f => f()); }
}
