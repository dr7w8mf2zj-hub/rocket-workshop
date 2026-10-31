// Construction workshop: 3D viewport, picking, drag & drop with snapping, selection, editing operations.
import { getEnvironment } from './env.js';
import * as THREE from 'three';
import { PARTS, geom, nodes, fillDims, finishes, radiusAt, colorSchemes } from './registry.js';
import { PartView, makeNodeMarker } from './models.js';
import { OrbitRig } from './camera.js';

const V3 = THREE.Vector3;

export class Workshop {
  constructor(renderer, canvas, design, history, lib) {
    this.renderer = renderer; this.canvas = canvas; this.design = design; this.history = history; this.lib = lib;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x1b2430); this.scene.fog = new THREE.Fog(0x1b2430, 60, 220); this.scene.environment = getEnvironment(renderer); this.scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.rig = new OrbitRig(this.camera, canvas); this.rig.target.set(0, 4, 0); this.rig.dist = 16;
    this.enabled = true; this.views = new Map(); this.selected = null; this.hover = null; this.drag = null; this.pending = null; this.claimed = false;
    this.showNodes = true; this.markers = []; this.markerGroup = new THREE.Group(); this.scene.add(this.markerGroup);
    this.raycaster = new THREE.Raycaster(); this.listeners = { change: [], select: [], status: [] };
    this.buildEnvironment(); this.bindPointer(); this.rig.attach(() => !this.claimed);
  }
  on(ev, fn) { this.listeners[ev].push(fn); }
  emit(ev, ...a) { this.listeners[ev].forEach(f => f(...a)); }
  status(msg) { this.emit('status', msg); }

  // ------------------------------------------------------------ environment
  buildEnvironment() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xcfe0ff, 0x3a3228, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2); sun.position.set(14, 30, 18); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); const c = sun.shadow.camera; c.left = -22; c.right = 22; c.top = 30; c.bottom = -8; c.near = 1; c.far = 90; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    s.add(sun); this.sun = sun;
    const fill = new THREE.DirectionalLight(0x88aaff, 0.6); fill.position.set(-20, 10, -10); s.add(fill);
    const floorMat = new THREE.MeshStandardMaterial({ map: this.lib.get('launchpad_concrete'), color: 0x9aa4b0, roughness: 0.95, metalness: 0 });
    if (floorMat.map) { floorMat.map = floorMat.map.clone(); floorMat.map.repeat.set(12, 12); floorMat.map.needsUpdate = true; this._floorTex = floorMat.map; }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const grid = new THREE.GridHelper(40, 40, 0x6a85a8, 0x3b4a5c); grid.position.y = 0.01; grid.material.transparent = true; grid.material.opacity = 0.55; s.add(grid);
    // gantry columns for ambience
    const gm = new THREE.MeshStandardMaterial({ color: 0x59636f, roughness: 0.6, metalness: 0.7 });
    for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 26, 0.6), gm); m.position.set(x, 13, z); m.castShadow = true; s.add(m); }
    this._env = { floorMat, floor, grid, gm };
  }
  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  render() { this.rig.update(); this.renderer.render(this.scene, this.camera); }

  // ------------------------------------------------------------ views
  syncViews() {
    const d = this.design;
    for (const [id, v] of this.views) if (!d.parts.has(id)) { v.dispose(); this.views.delete(id); }
    const info = { name: d.name, id: d.idCode };
    for (const p of d.parts.values()) {
      let v = this.views.get(p.id); const sig = p.type + JSON.stringify(p.dims);
      if (v && v._sig !== sig) { v.part = p; v._sig = sig; v.build(); v._asig = null; }
      if (!v) { v = new PartView(p, this.lib); v._sig = sig; this.scene.add(v.group); this.views.set(p.id, v); v._asig = null; }
      v.part = p;
      const asig = JSON.stringify(p.appearance) + info.name + info.id;
      if (v._asig !== asig) { v._asig = asig; v.applyAppearance(info); }
      v.group.position.set(...p.pos); v.group.quaternion.set(...p.quat);
    }
    if (this.selected && !d.parts.has(this.selected)) this.select(null);
    this.refreshHighlights(); this.refreshMarkers();
  }
  refreshHighlights() {
    const warn = new Set(); if (!this.drag) for (const w of this.design.validate()) if (w.level === 'warn' || w.level === 'error') for (const id of w.ids) warn.add(id);
    const loose = new Set(); const veh = this.design.vehicle(); const inV = new Set(veh.ids); for (const id of this.design.parts.keys()) if (!inV.has(id)) loose.add(id);
    for (const [id, v] of this.views) {
      let h = null;
      if (this.drag && this.drag.snapHost === id) h = 'host';
      else if (id === this.selected) h = (this.drag && this.drag.snap) ? 'snap' : 'select';
      else if (this.drag && this.drag.ids.includes(id)) h = this.drag.snap ? 'snap' : 'select';
      else if (id === this.hover) h = 'hover';
      else if (loose.has(id) && this.design.parts.size > 1) h = 'invalid';
      v.setHighlight(h);
    }
  }
  refreshMarkers() {
    // node markers: green = free node, orange = occupied, bright when a drag candidate
    const want = [];
    if (this.showNodes) {
      for (const p of this.design.parts.values()) for (const n of this.design.worldNodes(p)) want.push({ pos: n.pos, occ: this.design.occupied(p.id, n.id), key: p.id + n.id });
    }
    while (this.markers.length < want.length) { const m = makeNodeMarker(); this.markerGroup.add(m); this.markers.push(m); }
    this.markers.forEach((m, i) => {
      if (i >= want.length) { m.visible = false; return; }
      const w = want[i]; m.visible = true; m.position.copy(w.pos); m.material.color.set(w.occ ? 0x777777 : 0x33dd66); m.material.opacity = w.occ ? 0.25 : 0.85;
      const k = this.drag ? 1 : 0.8; const t = this.drag && this.drag.snap && this.drag.snap.targetKey === w.key; m.scale.setScalar(t ? 2.6 : k); if (t) { m.material.color.set(0xffee33); m.material.opacity = 1; }
    });
  }
  disposeAll() {
    for (const v of this.views.values()) v.dispose(); this.views.clear();
    for (const m of this.markers) { m.geometry.dispose(); m.material.dispose(); } this.markers = [];
    if (this._floorTex) this._floorTex.dispose();
    const e = this._env; e.floor.geometry.dispose(); e.floorMat.dispose(); e.grid.geometry.dispose(); e.grid.material.dispose();
  }

  // ------------------------------------------------------------ selection
  select(id) { this.selected = id; this.refreshHighlights(); this.emit('select', id); }
  ndc(ev) { const r = this.canvas.getBoundingClientRect(); return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -(((ev.clientY - r.top) / r.height) * 2 - 1)); }
  setRay(ev) { this.raycaster.setFromCamera(this.ndc(ev), this.camera); return this.raycaster.ray; }
  pick(ev, filterIds = null) {
    this.setRay(ev); const objs = []; for (const [id, v] of this.views) if (!filterIds || !filterIds.includes(id)) objs.push(v.group);
    const hits = this.raycaster.intersectObjects(objs, true);
    for (const h of hits) { let o = h.object; while (o && o.userData.partId == null) o = o.parent; if (o) return { id: o.userData.partId, hit: h }; }
    return null;
  }
  overCanvas(ev) { const r = this.canvas.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; }

  // ------------------------------------------------------------ pointer handling (parts)
  bindPointer() {
    const c = this.canvas; const on = (t, f) => c.addEventListener(t, (e) => { if (this.enabled) f(e); });
    on('pointerdown', (e) => {
      this.claimed = false; if (this.drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const hit = this.pick(e);
      if (hit) { this.claimed = true; this.select(hit.id); this.pending = { id: hit.id, x: e.clientX, y: e.clientY, pid: e.pointerId, hit: hit.hit.point.clone() }; c.setPointerCapture?.(e.pointerId); }
      else this.pending = { id: null, x: e.clientX, y: e.clientY, empty: true };
    });
    on('pointermove', (e) => {
      if (this.drag) return;
      if (this.pending && this.pending.id && Math.hypot(e.clientX - this.pending.x, e.clientY - this.pending.y) > 5) { this.beginDrag(this.pending.id, e, this.pending.hit); this.pending = null; return; }
      if (e.pointerType === 'mouse' && !e.buttons) { const h = this.pick(e); const hid = h ? h.id : null; if (hid !== this.hover) { this.hover = hid; this.refreshHighlights(); c.style.cursor = hid ? 'grab' : 'default'; } }
    });
    on('pointerup', (e) => {
      if (this.drag && !this.drag.external) { this.endDrag(e); }
      else if (this.pending && this.pending.empty && this.rig.moved < 5) { this.select(null); }
      this.pending = null; this.claimed = false;
    });
    on('pointercancel', () => { if (this.drag && !this.drag.external) this.cancelDrag(); this.pending = null; this.claimed = false; });
    on('pointermove', (e) => { if (this.drag && !this.drag.external) this.updateDrag(e); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.drag) this.cancelDrag(); });
  }

  // ------------------------------------------------------------ dragging
  beginDrag(id, ev, hitPoint, opts = {}) {
    const d = this.design; const part = d.get(id);
    if (!opts.isNew) this.preDrag = this.history.snap();
    const ids = d.subtree(id); const par = d.parentLink(id); if (par) d.unlink(id);
    const dir = new V3(); this.camera.getWorldDirection(dir);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, new V3(...part.pos));
    const ray = this.setRay(ev); const p = new V3(); ray.intersectPlane(plane, p);
    const offset = new V3(...part.pos).sub(p.lengthSq() && !opts.isNew ? p : new V3(...part.pos));
    this.drag = { id, ids, plane, offset: opts.isNew ? new V3() : offset, isNew: !!opts.isNew, external: !!opts.external, snap: null, hadParent: !!par };
    this.canvas.style.cursor = 'grabbing'; this.status('Drag to a green node to snap. Esc cancels.');
    this.refreshHighlights(); this.refreshMarkers();
  }
  startInventoryDrag(type, ev) {
    const d = this.design; const def = PARTS[type];
    const p = d.addPart(type, { pos: this.rig.target.toArray() });
    if (d.parts.size === 1) d.rootId = p.id; // pending
    this.preDrag = this.history.snap(); this.newPartId = p.id;
    this.syncViews(); this.select(p.id);
    this.beginDrag(p.id, ev, null, { isNew: true, external: true });
    this.drag.hidden = true; const v = this.views.get(p.id); v.group.visible = false;
    const move = (e) => { if (!this.drag) return; this.updateDrag(e, true); };
    const up = (e) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (!this.drag) return;
      if (!this.overCanvas(e) || e.type === 'pointercancel') { this.cancelDrag(true); return; }
      this.updateDrag(e, true); this.endDrag(e);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return p;
  }
  updateDrag(ev, fromWindow = false) {
    const dr = this.drag; if (!dr) return; const d = this.design;
    const over = this.overCanvas(ev); const v = this.views.get(dr.id);
    if (dr.isNew) { if (v) v.group.visible = over; if (!over) { dr.snap = null; this.refreshHighlights(); this.refreshMarkers(); return; } }
    const root = d.get(dr.id); const ray = this.setRay(ev);
    const hitP = new V3();
    if (!ray.intersectPlane(dr.plane, hitP)) return;
    if (dr.isNew && !dr.placed) { dr.plane.setFromNormalAndCoplanarPoint(dr.plane.normal, this.rig.target); ray.intersectPlane(dr.plane, hitP); dr.placed = true; }
    const want = hitP.add(dr.offset); const cur = new V3(...root.pos);
    d.move(dr.ids, want.sub(cur));
    const snap = this.findSnap(dr, ev);
    dr.snap = snap; dr.snapHost = snap && snap.kind === 'radial' ? snap.target : null;
    if (snap) {
      const t = snap.transform; const rp = new V3(...root.pos); const q = new THREE.Quaternion(...root.quat);
      const dq = t.quat.clone().multiply(q.invert());
      d.rotateAbout(dr.ids, rp, dq); d.move(dr.ids, t.pos.clone().sub(new V3(...d.get(dr.id).pos)));
    }
    this.syncViewsLight(); this.refreshHighlights(); this.refreshMarkers();
  }
  syncViewsLight() { for (const id of this.drag ? this.drag.ids : []) { const p = this.design.get(id), v = this.views.get(id); if (p && v) { v.group.position.set(...p.pos); v.group.quaternion.set(...p.quat); } } }
  snapThreshold() { return Math.max(0.4, this.rig.dist * 0.045); }
  /** Compute best attachment for the dragged root part. */
  findSnap(dr, ev) {
    const d = this.design; const root = d.get(dr.id); const rdef = PARTS[root.type]; const thr = this.snapThreshold();
    let best = null;
    const myNodes = d.worldNodes(root).filter(n => !d.occupied(root.id, n.id));
    for (const p of d.parts.values()) {
      if (dr.ids.includes(p.id)) continue;
      for (const n of d.worldNodes(p)) {
        if (d.occupied(p.id, n.id)) continue;
        for (const mn of myNodes) {
          const dist = mn.pos.distanceTo(n.pos); if (dist > thr) continue;
          const cost = dist + (mn.dir.dot(n.dir) > -0.5 ? thr * 0.8 : 0);
          if (!best || cost < best.cost) best = { kind: 'stack', target: p.id, pn: n.id, cn: mn.id, cost, targetKey: p.id + n.id };
        }
      }
    }
    if (ev && !(best && best.cost < thr * 0.3)) { // cursor-based snapping: the pointer ray passing close to a free node also selects it
      const ray = this.setRay(ev); const pr = new V3();
      for (const p of d.parts.values()) {
        if (dr.ids.includes(p.id)) continue;
        for (const n of d.worldNodes(p)) {
          if (d.occupied(p.id, n.id)) continue; ray.closestPointToPoint(n.pos, pr); const dist = pr.distanceTo(n.pos); if (dist > thr * 0.8) continue;
          for (const mn of myNodes) { if (mn.dir.dot(n.dir) > -0.5) continue; const cost = dist + thr * 0.25; if (!best || cost < best.cost) best = { kind: 'stack', target: p.id, pn: n.id, cn: mn.id, cost, targetKey: p.id + n.id }; }
        }
      }
    }
    if (rdef.radial && ev) {
      const hostIds = [...d.parts.values()].filter(p => PARTS[p.type].host && !dr.ids.includes(p.id)).map(p => p.id);
      this.setRay(ev); const objs = hostIds.map(id => this.views.get(id)?.group).filter(Boolean);
      const hits = this.raycaster.intersectObjects(objs, true);
      for (const h of hits) {
        let o = h.object; while (o && o.userData.partId == null) o = o.parent; if (!o || h.object.userData.isDecal) continue;
        const host = d.get(o.userData.partId); const hd = PARTS[host.type];
        const q = new THREE.Quaternion(...host.quat); const inv = q.clone().invert();
        const lp = h.point.clone().sub(new V3(...host.pos)).applyQuaternion(inv);
        const ln = (h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new V3(1, 0, 0)).applyQuaternion(inv);
        if (Math.abs(ln.y) > 0.6) continue;
        const ang = Math.atan2(-lp.z, lp.x); const y = Math.round(lp.y / 0.05) * 0.05;
        const L = geom(hd, host.dims).L;
        const info = { kind: 'radial', target: host.id, radial: { ang: Math.round(ang / (Math.PI / 36)) * (Math.PI / 36), y: Math.max(-L / 2 + 0.05, Math.min(L / 2 - 0.05, y)) }, cost: thr * 0.5 };
        if (!best || best.cost > thr * 0.45) best = info;
        break;
      }
    }
    if (best) {
      const par = d.get(best.target); const link = best.kind === 'stack' ? { pn: best.pn, cn: best.cn, roll: 0 } : { radial: best.radial };
      const t = d.childTransform(link, par, root); if (!t) return null; best.transform = t; best.link = link;
    }
    return best;
  }
  endDrag(ev) {
    const dr = this.drag; if (!dr) return; const d = this.design;
    if (dr.snap) {
      d.link(dr.snap.target, dr.id, dr.snap.link);
      d.layout();
      if (dr.snap.kind === 'radial') this.applySymmetry(dr.id, dr.snap);
      if (dr.isNew && d.parts.size === 2) { /* keep first part as root */ }
    }
    this.finishDrag(true);
  }
  cancelDrag(removeNew = false) {
    const dr = this.drag; if (!dr) return;
    this.drag = null; this.canvas.style.cursor = 'default';
    this.design.fromJSON(JSON.parse(this.preDrag)); this.selected = dr.isNew ? null : this.selected;
    this.syncViews(); this.emit('select', this.selected); this.emit('change'); this.status('Cancelled');
  }
  finishDrag(commit) {
    const dr = this.drag; this.drag = null; this.canvas.style.cursor = 'default';
    const v = this.views.get(dr.id); if (v) v.group.visible = true;
    if (!this.design.rootId || !this.design.parts.has(this.design.rootId)) this.design.rootId = this.design.flightRoot();
    this.history.commit(); this.syncViews(); this.emit('change'); this.emit('select', this.selected);
    this.status(dr.snap ? 'Attached.' : (this.design.parts.size > 1 ? 'Placed (not attached — drop near a green node to snap).' : 'Placed.'));
  }
  applySymmetry(id, snap) {
    const n = this.design.settings.symmetry || 1; if (n <= 1) return; const d = this.design; const src = d.get(id); src.sym = d.newSym();
    for (let k = 1; k < n; k++) {
      const c = d.addPart(src.type, { sym: src.sym, dims: { ...src.dims }, appearance: JSON.parse(JSON.stringify(src.appearance)), config: JSON.parse(JSON.stringify(src.config)), stage: src.stage });
      d.link(snap.target, c.id, { radial: { ang: snap.radial.ang + (Math.PI * 2 * k) / n, y: snap.radial.y } });
    }
    d.layout();
  }

  // ------------------------------------------------------------ editing operations
  commit() { this.history.commit(); this.syncViews(); this.emit('change'); }
  changed(commit = true) { this.design.layout(); if (commit) this.history.commit(); this.syncViews(); this.emit('change'); }
  /** Add part by tapping inventory: auto attaches to selected part (or free node), good for touch. */
  quickAdd(type) {
    const d = this.design; const def = PARTS[type];
    const first = d.parts.size === 0;
    const p = d.addPart(type, { pos: [0, 3, 0] });
    if (first) { p.pos = [0, geom(def, p.dims).L / 2 + 0.01, 0]; d.rootId = p.id; }
    else {
      const sel = this.selected && d.get(this.selected) && this.selected !== p.id ? d.get(this.selected) : null;
      const placed = this.autoPlace(p, sel);
      if (!placed) { const c = d.bounds(d.all().filter(x => x.id !== p.id).map(x => x.id)).getCenter(new V3()); p.pos = [c.x + 3, 2, c.z]; this.status('No free node found — placed loose. Drag it to a green node.'); }
    }
    d.layout(); this.history.commit(); this.syncViews(); this.select(p.id); this.emit('change');
    if (first) this.frame(); return p;
  }
  autoPlace(p, sel) {
    const d = this.design, def = PARTS[p.type];
    const topFirst = !!(def.stack === 'bottom' || def.chute);
    const candParts = sel ? [sel, ...d.all().filter(x => x.id !== sel.id && x.id !== p.id)] : d.all().filter(x => x.id !== p.id).reverse();
    if (def.stack !== 'none') {
      for (const tp of candParts) {
        const ns = d.nodesOf(tp).filter(n => !d.occupied(tp.id, n.id));
        const order = topFirst ? ['top', 'bottom'] : ['bottom', 'top'];
        for (const want of order) {
          const tn = ns.find(n => n.id === want); if (!tn) continue;
          const mine = nodes(def, p.dims); const mn = mine.find(n => n.id === (want === 'bottom' ? 'top' : 'bottom'));
          if (!mn) continue;
          d.link(tp.id, p.id, { pn: tn.id, cn: mn.id }); const t = d.childTransform(d.parentLink(p.id), tp, p); p.pos = t.pos.toArray(); p.quat = t.quat.toArray(); return true;
        }
        if (sel) break; // with an explicit selection only try that part, then fall back to others only if it fails
      }
      if (sel) { const r = this.autoPlaceAny(p, candParts.slice(1), topFirst, def); if (r) return true; }
    }
    if (def.radial) {
      const hosts = (sel && PARTS[sel.type].host ? [sel] : []).concat(d.all().filter(x => PARTS[x.type].host && x.id !== p.id && (!sel || x.id !== sel.id)));
      const host = hosts[0]; if (!host) return false;
      const hd = PARTS[host.type]; const L = geom(hd, host.dims).L; const used = d.childLinks(host.id).filter(l => l.radial).map(l => l.radial.ang);
      let ang = 0; for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12 * 1; if (!used.some(u => Math.abs(Math.atan2(Math.sin(u - a), Math.cos(u - a))) < 0.2)) { ang = a; break; } }
      const lowFin = def.finArea || def.leg; const y = lowFin ? -L / 2 + (def.finArea ? p.dims.chord / 2 : 0.35) : 0;
      d.link(host.id, p.id, { radial: { ang, y } });
      const snap = { target: host.id, radial: { ang, y } }; d.layout(); this.applySymmetry(p.id, snap); return true;
    }
    return false;
  }
  autoPlaceAny(p, parts, topFirst, def) {
    const d = this.design;
    for (const tp of parts) for (const want of (topFirst ? ['top', 'bottom'] : ['bottom', 'top'])) {
      const tn = d.nodesOf(tp).find(n => n.id === want && !d.occupied(tp.id, n.id)); if (!tn) continue;
      const mn = nodes(def, p.dims).find(n => n.id === (want === 'bottom' ? 'top' : 'bottom')); if (!mn) continue;
      d.link(tp.id, p.id, { pn: tn.id, cn: mn.id }); const t = d.childTransform(d.parentLink(p.id), tp, p); p.pos = t.pos.toArray(); p.quat = t.quat.toArray(); return true;
    }
    return false;
  }
  deleteSelected(withChildren = false) {
    const id = this.selected; if (!id) return; const d = this.design;
    const par = d.parentOf(id);
    const grp = d.symGroup(id); for (const gid of grp) { if (!d.get(gid)) continue; if (withChildren) d.removeSubtree(gid); else d.removePart(gid); }
    if (!d.rootId || !d.parts.has(d.rootId)) d.rootId = d.flightRoot();
    this.selected = null; this.history.commit(); this.syncViews(); this.emit('select', null); this.emit('change'); this.status('Deleted.');
  }
  duplicateSelected() {
    const id = this.selected; if (!id) return; const d = this.design; const src = d.get(id);
    let off = [1.6 + geom(PARTS[src.type], src.dims).r, 0, 0];
    const par = d.parentLink(id);
    const copies = d.duplicate(id, true, off);
    // radial parts duplicate onto the same host at the next free angle
    if (par && par.radial) { const c = copies[0]; d.link(par.parent, c.id, { radial: { ang: par.radial.ang + Math.PI / 6, y: par.radial.y } }); }
    d.layout(); this.history.commit(); this.syncViews(); this.select(copies[0].id); this.emit('change'); this.status('Duplicated.');
  }
  detachSelected() { const id = this.selected; if (!id || !this.design.parentLink(id)) { this.status('Part is not attached to a parent.'); return; } this.design.unlink(id); this.changed(); this.status('Detached (moves with its own sub-assembly).'); }
  attachSelected() {
    const id = this.selected; if (!id) return; const d = this.design; const root = d.get(id);
    d.unlink(id); const ids = d.subtree(id); const dr = { id, ids }; const keep = this.rig.dist; this.rig.dist = 40; // generous threshold
    const snap = this.findSnap(dr, null); this.rig.dist = keep;
    if (!snap) { this.status('No free compatible node nearby. Move the part closer first.'); this.changed(); return; }
    const t = snap.transform; const q = new THREE.Quaternion(...root.quat); const dq = t.quat.clone().multiply(q.invert());
    d.rotateAbout(ids, new V3(...root.pos), dq); d.move(ids, t.pos.clone().sub(new V3(...d.get(id).pos)));
    d.link(snap.target, id, snap.link); this.changed(); this.status('Attached.');
  }
  /** Rotate by degrees about 'x'|'y'|'z' (world axes for loose parts; y = roll for stack-attached). */
  rotateSelected(axis, deg) {
    const id = this.selected; if (!id) return; const d = this.design; const lk = d.parentLink(id); const rad = deg * Math.PI / 180;
    if (lk && !lk.radial && axis === 'y') { lk.roll = (lk.roll || 0) + rad; this.changed(); return; }
    if (lk && lk.radial) { lk.radial.ang += (axis === 'y' ? rad : 0); if (axis !== 'y') this.status('Radial parts can only be rotated around the host (use Detach to rotate freely).'); this.changed(); return; }
    const ids = d.subtree(id); const p = d.get(id);
    const ax = axis === 'x' ? new V3(1, 0, 0) : axis === 'z' ? new V3(0, 0, 1) : new V3(0, 1, 0).applyQuaternion(new THREE.Quaternion(...p.quat));
    d.rotateAbout(ids, new V3(...p.pos), new THREE.Quaternion().setFromAxisAngle(ax, rad)); this.changed();
  }
  nudgeSelected(dx, dy, dz) {
    const id = this.selected; if (!id) return; const d = this.design; const lk = d.parentLink(id);
    if (lk && lk.radial) { lk.radial.y += dy; lk.radial.ang -= dx * 0.4; this.changed(); return; }
    if (lk) { this.status('Detached to move. Press Attach to snap back.'); d.unlink(id); }
    d.move(d.subtree(id), new V3(dx, dy, dz)); this.changed();
  }
  setPosition(axis, value) {
    const id = this.selected; if (!id || !Number.isFinite(value)) return; const d = this.design; const p = d.get(id);
    if (d.parentLink(id)) d.unlink(id); const delta = new V3(); delta['xyz'[axis]] = value - p.pos[axis]; d.move(d.subtree(id), delta); this.changed();
  }
  setEuler(axis, deg) {
    const id = this.selected; if (!id || !Number.isFinite(deg)) return; const d = this.design; const p = d.get(id); if (d.parentLink(id)) d.unlink(id);
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...p.quat), 'YXZ'); const a = [e.x, e.y, e.z]; a[axis] = deg * Math.PI / 180;
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(a[0], a[1], a[2], 'YXZ')); const cur = new THREE.Quaternion(...p.quat);
    d.rotateAbout(d.subtree(id), new V3(...p.pos), target.multiply(cur.invert())); this.changed();
  }
  setDim(key, value, commit = true) {
    const id = this.selected; if (!id) return; const p = this.design.get(id); if (!(key in p.dims)) return; for (const gid of this.design.symGroup(id)) { const q = this.design.get(gid); if (q && key in q.dims) q.dims[key] = value; } this.changed(commit);
  }
  setAppearance(patch, ids = null, commit = true) {
    const targets = ids || (this.selected ? this.design.symGroup(this.selected) : []);
    for (const id of targets) { const p = this.design.get(id); if (p) Object.assign(p.appearance, patch); }
    if (commit) this.history.commit(); this.syncViews(); this.emit('change');
  }
  setConfig(patch, commit = true) { const p = this.design.get(this.selected); if (!p) return; for (const gid of this.design.symGroup(this.selected)) Object.assign(this.design.get(gid).config, patch); if (commit) this.history.commit(); this.syncViews(); this.emit('change'); }
  applyScheme(name) {
    const sc = colorSchemes[name]; if (!sc) return; const d = this.design; const veh = new Set(d.vehicle().ids);
    for (const p of d.parts.values()) {
      const def = PARTS[p.type]; let c = sc.primary;
      if (def.model === 'cone' || def.id === 'fins' || def.id === 'adapter') c = sc.secondary;
      else if (def.engine || def.id === 'decoupler' || def.model === 'connector' || def.leg || def.id === 'heat_shield' || def.id === 'rcs_thruster') c = sc.accent;
      p.appearance.color = c;
      if (name === 'Retro Chequer') { p.appearance.stripe = def.model === 'tank' || def.model === 'tube'; p.appearance.stripeColor = sc.accent; }
      else if (def.decal) { p.appearance.stripe = true; p.appearance.stripeColor = sc.secondary; }
    }
    this.history.commit(); this.syncViews(); this.emit('change');
  }
  setHeatDamageAll(on) { for (const p of this.design.parts.values()) p.appearance.heatDamage = on; this.history.commit(); this.syncViews(); this.emit('change'); }
  frame() {
    const ids = [...this.design.parts.keys()]; if (!ids.length) { this.rig.target.set(0, 4, 0); this.rig.dist = 16; return; }
    const box = new THREE.Box3(); for (const v of this.views.values()) box.expandByObject(v.group); this.rig.frame(box);
  }
  clearAll() { this.design.reset(); this.selected = null; this.history.commit(); this.syncViews(); this.emit('select', null); this.emit('change'); }
  loadDesign(json, fit = true) {
    this.design.fromJSON(json); this.selected = null; this.history.commit(); this.syncViews(); this.emit('select', null); this.emit('change'); if (fit) this.frame();
  }
  toggleNodes() { this.showNodes = !this.showNodes; this.refreshMarkers(); return this.showNodes; }
}

/** Render a small thumbnail for each part type (one PartView at a time, then disposed). */
export function renderThumbnails(renderer, lib, size = 112) {
  const out = {}; const scene = new THREE.Scene(); scene.background = null; scene.environment = getEnvironment(renderer); scene.environmentIntensity = 0.7;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2)); const dl = new THREE.DirectionalLight(0xffffff, 2.4); dl.position.set(3, 5, 4); scene.add(dl);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4, colorSpace: THREE.SRGBColorSpace }); const buf = new Uint8Array(size * size * 4);
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const ctx = cv.getContext('2d'); const img = ctx.createImageData(size, size);
  const prev = renderer.getRenderTarget(); const prevClear = renderer.getClearColor(new THREE.Color()); const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  for (const def of Object.values(PARTS)) {
    const part = { id: 'thumb', type: def.id, dims: fillDims(def, {}), appearance: { color: '#ffffff', finish: 'default', metalness: null, roughness: null, insignia: 'none' }, config: {} };
    const v = new PartView(part, lib); scene.add(v.group);
    const box = new THREE.Box3().setFromObject(v.group); const c = box.getCenter(new V3()), s = box.getSize(new V3()); const rad = Math.max(s.x, s.y, s.z) * 0.62 + 0.1;
    v.group.position.sub(c); v.group.rotation.set(0.0, 0.7, 0);
    cam.position.set(0, rad * 0.55, rad * 3.6); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    for (let y = 0; y < size; y++) img.data.set(buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    ctx.putImageData(img, 0, 0); out[def.id] = cv.toDataURL('image/png');
    scene.remove(v.group); v.dispose();
  }
  renderer.setRenderTarget(prev); renderer.setClearColor(prevClear, prevAlpha); rt.dispose();
  return out;
}
