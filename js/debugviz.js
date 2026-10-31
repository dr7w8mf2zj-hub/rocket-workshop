// Debug overlay drawn into the flight scene (centre of mass, centre of pressure, thrust vectors, attachment nodes).
// Driven by flags that the separate admin page toggles (see adminbridge.js); invisible and free when all flags are off.
import * as THREE from 'three';
import { nodes } from './registry.js';
const V3 = THREE.Vector3;

export class DebugViz {
  constructor(scene) {
    this.scene = scene; this.group = new THREE.Group(); this.group.visible = false; this.group.renderOrder = 50; scene.add(this.group);
    const mkPts = (n, size) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const m = new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }); const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 50; this.group.add(p); return p; };
    const mkLines = (n) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      const m = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }); const l = new THREE.LineSegments(g, m); l.frustumCulled = false; l.renderOrder = 50; this.group.add(l); return l; };
    this.marks = mkPts(64, 15); this.nodePts = mkPts(1500, 6); this.lines = mkLines(400); this.tmp = new V3();
  }
  put(attr, i, v, c) { const a = attr.array; a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z; const k = attr.itemSize; const col = this.cur; }
  update(phys, flags) {
    const any = flags.com || flags.cop || flags.thrust || flags.nodes; this.group.visible = any; if (!any || !phys) return;
    const mp = this.marks.geometry.attributes.position, mc = this.marks.geometry.attributes.color; let mi = 0;
    const np = this.nodePts.geometry.attributes.position, nc = this.nodePts.geometry.attributes.color; let ni = 0;
    const lp = this.lines.geometry.attributes.position, lc = this.lines.geometry.attributes.color; let li = 0;
    const setP = (pos, col, i, v, c) => { pos.array[i * 3] = v.x; pos.array[i * 3 + 1] = v.y; pos.array[i * 3 + 2] = v.z; col.array[i * 3] = c[0]; col.array[i * 3 + 1] = c[1]; col.array[i * 3 + 2] = c[2]; };
    const setL = (a, b, c) => { if (li >= 400) return; setP(lp, lc, li * 2, a, c); setP(lp, lc, li * 2 + 1, b, c); li++; };
    const v = this.tmp;
    for (const b of phys.bodies) {
      if (b.removed || !b.parts.length) continue;
      if (flags.com && mi < 62) setP(mp, mc, mi++, b.worldPoint(new V3().set(0, 0, 0).add(b.com), new V3()), [1, 0.9, 0.1]);
      if (flags.cop && mi < 62) { const c = phys.copWorld(b, new V3()); if (c) setP(mp, mc, mi++, c, [0.2, 0.9, 1]); }
      if (flags.thrust) for (const p of b.parts) { const e = p.engine; if (!e || e.thrust < 1) continue; const o = b.worldPoint(e.exit, new V3()); const d = (e.dirWorld || new V3(0, 1, 0)).clone().multiplyScalar(-Math.min(60, 4 + e.thrust / 25000)); setL(o, o.clone().add(d), [1, 0.4, 0.1]); }
      if (flags.nodes) for (const p of b.parts) {
        for (const n of nodes(p.def, p.design.dims)) { if (ni >= 1500) break; const lpnt = new V3(...n.p).applyQuaternion(p.lq).add(p.lp); const w = b.worldPoint(lpnt, new V3()); setP(np, nc, ni++, w, p.parent && (p.parentNode === n.id) ? [0.2, 1, 0.3] : [1, 0.3, 0.3]); }
        if (p.parent) { const a = b.worldPoint(p.lp, new V3()), c = b.worldPoint(p.parent.lp, new V3()); setL(a, c, [0.6, 0.7, 1]); }
      }
    }
    this.marks.geometry.setDrawRange(0, mi); this.nodePts.geometry.setDrawRange(0, ni); this.lines.geometry.setDrawRange(0, li * 2);
    for (const a of [mp, mc, np, nc, lp, lc]) a.needsUpdate = true;
  }
}
