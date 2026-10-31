// 3D part models. Each part type has its own procedural model builder; every PartView owns its geometries and
// CLONED materials (so appearance edits never leak between parts) and disposes them in dispose().
import * as THREE from 'three';
import { PARTS, geom, fillDims, finishes, surfacePresets, insignias, engineGeom } from './registry.js';

const SEG = 40;
const TAU = Math.PI * 2;

function cylGeo(rTop, rBot, h, tileV, openEnded = true, seg = SEG) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, openEnded);
  const uv = g.attributes.uv;
  g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(uv.array), 2));
  if (tileV) {
    const rAvg = (rTop + rBot) / 2; const s = h / (Math.PI * rAvg);
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * s);
  }
  return g;
}
function capGeo(r, up) {
  const g = new THREE.CircleGeometry(r, SEG); g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); return g;
}
/** Lathe along Y from points [[r,y],...] ordered bottom->top; uv1 = copy of uv. */
function latheGeo(pts, seg = SEG) {
  const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg);
  g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(g.attributes.uv.array), 2));
  return g;
}
function bellPts(rt, re, y0, y1, n = 14) { // y0 exit (bottom) -> y1 throat (top)
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; // 0 exit .. 1 throat
    const f = 1 - t; const r = rt + (re - rt) * Math.pow(f, 0.55); pts.push([Math.max(0.001, r), y0 + (y1 - y0) * t]); }
  return pts;
}

const ROLE_DEFAULT = { main: { metalness: 0.3, roughness: 0.55 }, metal: { metalness: 0.85, roughness: 0.4 }, dark: { metalness: 0.6, roughness: 0.5 }, rubber: { metalness: 0.0, roughness: 0.95 } };

export class PartView {
  constructor(part, lib) {
    this.part = part; this.lib = lib; this.def = PARTS[part.type];
    this.group = new THREE.Group(); this.group.userData.partId = part.id;
    this.entries = []; // {mesh, mat, role, texKey}
    this.extras = {}; this.legs = []; this.exhaust = null; this.rcsNozzles = [];
    this.decal = null; this.heat = 0; this.highlight = null;
    this.build();
  }
  // -------------------------------------------------------------- building
  mat(role, texKey, opts = {}) {
    const def = ROLE_DEFAULT[role] || ROLE_DEFAULT.main;
    const m = new THREE.MeshStandardMaterial({ metalness: def.metalness, roughness: def.roughness, side: opts.double ? THREE.DoubleSide : THREE.FrontSide });
    return { mat: m, role, texKey, double: !!opts.double };
  }
  add(geo, role, texKey, opts = {}) {
    const e = this.mat(role, texKey, opts);
    const mesh = new THREE.Mesh(geo, e.mat);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.partId = this.part.id;
    if (opts.pos) mesh.position.set(...opts.pos);
    if (opts.rot) mesh.rotation.set(...opts.rot);
    (opts.parent || this.group).add(mesh);
    e.mesh = mesh; this.entries.push(e); return mesh;
  }
  clear() {
    for (const e of this.entries) { e.mat.dispose(); }
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    if (this.decal) { this.decal.tex.dispose(); this.decal.mat.dispose(); this.decal = null; }
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.entries = []; this.legs = []; this.rcsNozzles = []; this.extras = {};
  }
  build() {
    this.clear();
    const { def, part } = this; const { r, L, d } = geom(def, part.dims);
    const tex = def.texture, tex2 = def.texture2 || def.texture, tv = def.tileV;
    let decalGeo = null;
    const mk = {
      cone: () => {
        const n = 26, pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([Math.max(0.002, r * Math.pow(Math.max(0, 1 - Math.pow(t, 1.6)), 0.6)), -L / 2 + t * L]); }
        const g = latheGeo(pts); this.add(g, 'main', tex); this.add(capGeo(r, false), 'main', tex, { pos: [0, -L / 2, 0] }); decalGeo = g;
      },
      adapter: () => { const g = cylGeo(r * def.topK, r, L, false); this.add(g, 'main', tex); this.add(capGeo(r * def.topK, true), 'main', tex, { pos: [0, L / 2, 0] }); this.add(capGeo(r, false), 'main', tex, { pos: [0, -L / 2, 0] }); decalGeo = g; },
      tube: () => { const g = cylGeo(r, r, L, tv); this.add(g, 'main', tex); this.add(capGeo(r, true), 'main', tex, { pos: [0, L / 2, 0] }); this.add(capGeo(r, false), 'main', tex, { pos: [0, -L / 2, 0] }); decalGeo = cylGeo(r, r, L, false); },
      tank: () => {
        const g = cylGeo(r, r, L, tv); this.add(g, 'main', tex);
        for (const s of [1, -1]) { this.add(cylGeo(r * 1.02, r * 1.02, 0.07, false, false), 'main', tex, { pos: [0, s * (L / 2 - 0.035), 0] }); }
        this.add(capGeo(r, true), 'main', tex, { pos: [0, L / 2, 0] }); this.add(capGeo(r, false), 'main', tex, { pos: [0, -L / 2, 0] });
        decalGeo = cylGeo(r, r, L, false);
      },
      connector: () => {
        this.add(cylGeo(r, r, L, false), 'main', tex); this.add(capGeo(r, true), 'main', tex, { pos: [0, L / 2, 0] }); this.add(capGeo(r, false), 'main', tex, { pos: [0, -L / 2, 0] });
        if (def.id === 'structural_connector') decalGeo = null;
      },
      dock: () => {
        this.add(cylGeo(r, r, L * 0.6, false), 'main', tex, { pos: [0, -L * 0.2, 0] });
        this.add(cylGeo(r * 0.78, r * 0.78, L * 0.4, false), 'main', tex, { pos: [0, L * 0.3, 0] });
        this.add(new THREE.TorusGeometry(r * 0.7, r * 0.07, 10, SEG), 'rubber', 'none', { pos: [0, L * 0.5, 0], rot: [Math.PI / 2, 0, 0] });
        this.add(capGeo(r * 0.78, true), 'main', tex, { pos: [0, L / 2, 0] }); this.add(capGeo(r, false), 'main', tex, { pos: [0, -L / 2, 0] });
      },
      pod: () => {
        const n = 28, pts = [[0.002, -L / 2]]; const nc = Math.round(n * 0.72), ncone = n - nc; const yc = -L / 2 + 0.6 * L;
        for (let i = 0; i <= nc; i++) pts.push([r, -L / 2 + (yc + L / 2) * i / nc]);
        for (let i = 1; i <= ncone; i++) { const t = i / ncone; pts.push([r * (1 - (1 - def.topK) * t), yc + (L / 2 - yc) * t]); }
        pts.push([0.002, L / 2]);
        const g = latheGeo(pts); this.add(g, 'main', tex); decalGeo = null;
        this.extras.cockpitY = L * 0.12;
      },
      shield: () => {
        const pts = [[0.002, -L / 2 - 0.02], [r * 0.5, -L / 2 - 0.0], [r * 0.85, -L / 2 + 0.05], [r, -L / 2 + 0.11], [r, L / 2], [0.002, L / 2]];
        this.add(latheGeo(pts), 'dark', tex);
      },
      engine: () => {
        const hH = 0.38 * L, hB = L - hH, re = r * def.bellK * 0.85, rt = r * 0.2 * def.bellK;
        this.add(cylGeo(r * 0.9, r * 0.9, hH, false), 'main', tex, { pos: [0, L / 2 - hH / 2, 0] });
        this.add(capGeo(r * 0.9, true), 'main', tex, { pos: [0, L / 2, 0] });
        this.add(cylGeo(r, r, 0.05, false, false), 'metal', tex, { pos: [0, L / 2 - 0.025, 0] });
        this.add(latheGeo(bellPts(rt, re, -L / 2, L / 2 - hH)), 'metal', tex2, { double: true });
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; this.add(cylGeo(r * 0.07, r * 0.07, hH * 0.8, false), 'dark', tex, { pos: [Math.cos(a) * r * 0.93, L / 2 - hH * 0.5, Math.sin(a) * r * 0.93] }); }
      },
      nozzle: () => { this.add(latheGeo(bellPts(r * 0.35, r, -L / 2, L / 2)), 'metal', tex, { double: true }); this.add(cylGeo(r * 0.36, r * 0.36, 0.05, false), 'metal', tex, { pos: [0, L / 2 - 0.02, 0] }); },
      srb: () => {
        const bH = Math.min(r * 1.1, L * 0.25), nH = r * 0.9; const bodyH = L - bH * 0.55 - nH;
        const yb = -L / 2 + bH * 0.55 + bodyH / 2;
        const g = cylGeo(r, r, bodyH, tv); this.add(g, 'main', tex, { pos: [0, yb, 0] });
        const cap = new THREE.SphereGeometry(r, SEG, 12, 0, TAU, 0, Math.PI / 2); cap.scale(1, nH / r, 1);
        cap.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(cap.attributes.uv.array), 2));
        this.add(cap, 'main', tex, { pos: [0, yb + bodyH / 2, 0] });
        this.add(capGeo(r, false), 'main', tex, { pos: [0, yb - bodyH / 2, 0] });
        this.add(latheGeo(bellPts(r * 0.15, r * 0.78, -L / 2, -L / 2 + bH)), 'metal', tex2, { double: true });
        decalGeo = cylGeo(r, r, bodyH, false); this.extras.decalPos = [0, yb, 0]; this.extras.decalLen = bodyH;
      },
      fin: () => {
        const c = d.chord, s = d.span; const sh = new THREE.Shape();
        sh.moveTo(-0.03, -c / 2); sh.lineTo(s, -c / 2); sh.lineTo(s, -c / 2 + 0.3 * c); sh.lineTo(-0.03, c / 2); sh.closePath();
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false }); g.translate(0, 0, -0.025);
        const p = g.attributes.position, uv = g.attributes.uv;
        for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 0.03) / (s + 0.03), p.getY(i) / c + 0.5);
        this.add(g, 'main', tex);
      },
      leg: () => {
        const pivot = new THREE.Group(); this.group.add(pivot); this.legs.push(pivot);
        const fx = 0.55 * L, fy = -0.78 * L; const len = Math.hypot(fx, fy), ang = Math.atan2(fy, fx);
        const strut = cylGeo(0.04, 0.05, len, false); this.add(strut, 'main', tex, { parent: pivot, pos: [fx / 2, fy / 2, 0], rot: [0, 0, ang - Math.PI / 2] });
        const brace = cylGeo(0.025, 0.025, len * 0.7, false); this.add(brace, 'metal', tex, { parent: pivot, pos: [fx * 0.28 + 0.05, fy * 0.5 + len * 0.1, 0.0], rot: [0, 0, ang - Math.PI / 2 + 0.22] });
        this.add(cylGeo(0.16, 0.18, 0.05, false, false), 'rubber', tex, { parent: pivot, pos: [fx, fy - 0.02, 0] });
        this.add(new THREE.SphereGeometry(0.06, 12, 8), 'metal', tex, { parent: pivot });
        this.extras.foot = [fx, fy - 0.05, 0];
      },
      solar: () => {
        const len = d.length, w = d.width;
        this.add(cylGeo(0.035, 0.035, 0.2, false), 'metal', tex, { pos: [0.1, 0, 0], rot: [0, 0, Math.PI / 2] });
        this.add(new THREE.BoxGeometry(len, w, 0.035), 'main', tex, { pos: [0.2 + len / 2, 0, 0] });
        this.add(new THREE.BoxGeometry(len + 0.05, w + 0.05, 0.02), 'dark', 'none', { pos: [0.2 + len / 2, 0, -0.012] });
      },
      rcs: () => {
        const s = 0.25 * d.scale;
        this.add(new THREE.BoxGeometry(s, s, s), 'main', tex, { pos: [s / 2, 0, 0] });
        const nz = [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0]];
        for (const [x, y, z] of nz) {
          const g = cylGeo(s * 0.1, s * 0.2, s * 0.3, false);
          const m = this.add(g, 'dark', tex, { pos: [s / 2 + x * s * 0.6, y * s * 0.6, z * s * 0.6] });
          m.lookAt(m.position.clone().add(new THREE.Vector3(x, y, z))); m.rotateX(Math.PI / 2);
          this.rcsNozzles.push({ pos: new THREE.Vector3(s / 2 + x * s * 0.7, y * s * 0.7, z * s * 0.7), dir: new THREE.Vector3(x, y, z) });
        }
      },
      chute: () => {
        const h = L; this.add(cylGeo(r * 0.8, r, h * 0.8, false), 'main', tex, { pos: [0, -h * 0.1, 0] });
        this.add(cylGeo(r * 0.55, r * 0.8, h * 0.2, false), 'main', tex, { pos: [0, h * 0.4, 0] });
        this.add(capGeo(r * 0.55, true), 'main', tex, { pos: [0, h * 0.5, 0] }); this.add(capGeo(r, false), 'main', tex, { pos: [0, -h * 0.5, 0] });
      },
    };
    (mk[def.model] || mk.tube)();
    // radial parts that are cylinders keep their local origin at the centre; others at the attach point. nothing to do here.
    this.setupDecal(decalGeo);
    if (def.engine) { const eg = engineGeom(def, part.dims); this.exhaust = { pivot: new THREE.Vector3(0, eg.pivotY, 0), exit: new THREE.Vector3(0, eg.exitY, 0), r: eg.exitR }; }
    this.applyAppearance();
  }
  // -------------------------------------------------------------- decals (rocket name / ID / insignia / stripe / scorch)
  setupDecal(geo) {
    if (!this.def.decal || !geo) return;
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.channel = 1; tex.anisotropy = 4;
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.6, metalness: 0.1 });
    const mesh = new THREE.Mesh(geo, mat); mesh.scale.set(1.004, 1, 1.004); mesh.userData.partId = this.part.id; mesh.renderOrder = 2;
    mesh.userData.isDecal = true;
    if (this.extras.decalPos) mesh.position.set(...this.extras.decalPos);
    this.group.add(mesh);
    this.decal = { canvas, tex, mat, mesh, geo, len: this.extras.decalLen || geom(this.def, this.part.dims).L, ctx: canvas.getContext('2d'), key: '' };
  }
  drawDecal(ctxInfo = {}) {
    if (!this.decal) return;
    const a = this.part.appearance || {}; const { r, L } = geom(this.def, this.part.dims);
    const len = this.decal.len;
    const name = ctxInfo.name || '', id = ctxInfo.id || '';
    const key = JSON.stringify([a.markName, a.markId, a.stripe, a.stripeColor, a.insignia, a.heatDamage, name, id, r.toFixed(3), len.toFixed(3), this.part.id]);
    if (key === this.decal.key) return; this.decal.key = key;
    const { ctx, canvas, tex } = this.decal; const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    const circ = TAU * (this.def.model === 'cone' ? r * 0.8 : r);
    ctx.setTransform(W / circ, 0, 0, H / len, 0, 0); // draw in metres
    const any = a.markName || a.markId || a.stripe || a.insignia !== 'none' || a.heatDamage;
    if (a.stripe) { ctx.fillStyle = a.stripeColor || '#c8342f'; ctx.fillRect(0, len * 0.08, circ, len * 0.07); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(0, len * 0.16, circ, len * 0.012); }
    const drawAround = (fn) => { fn(0); fn(circ); };
    if (a.markName && name) {
      const sz = Math.min(0.55 * r * 1.0, len * 0.28);
      drawAround((x) => { ctx.save(); ctx.translate(x, len * 0.5); ctx.rotate(-Math.PI / 2); ctx.fillStyle = 'rgba(20,20,26,.92)'; ctx.font = `bold ${sz}px "DejaVu Sans", Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const m = ctx.measureText(name.toUpperCase()); const maxW = len * 0.86; const k = m.width > maxW ? maxW / m.width : 1; ctx.scale(k, 1); ctx.fillText(name.toUpperCase(), 0, 0); ctx.restore(); });
    }
    if (a.markId && id) {
      const sz = Math.min(0.28 * r, len * 0.12);
      drawAround((x) => { ctx.save(); ctx.translate(x + sz * 1.6, len * 0.5); ctx.rotate(-Math.PI / 2); ctx.fillStyle = 'rgba(190,35,35,.95)'; ctx.font = `bold ${sz}px "DejaVu Sans Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const m = ctx.measureText(id); const maxW = len * 0.8; const k = m.width > maxW ? maxW / m.width : 1; ctx.scale(k, 1); ctx.fillText(id, 0, 0); ctx.restore(); });
    }
    if (a.insignia && a.insignia !== 'none' && insignias[a.insignia]) {
      const img = this.lib && this.lib.image(insignias[a.insignia]);
      if (img) { const s = Math.min(circ * 0.2, len * 0.6); ctx.drawImage(img, circ * 0.25 - s / 2, len * 0.62 - s / 2, s, s); ctx.drawImage(img, circ * 0.75 - s / 2, len * 0.62 - s / 2, s, s); }
    }
    if (a.heatDamage) { // soot / scorch streaks, deterministic per part
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      let seed = 0; for (const ch of this.part.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(20,14,10,.78)'); g.addColorStop(0.5, 'rgba(30,20,14,.35)'); g.addColorStop(1, 'rgba(15,10,8,.85)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 160; i++) { const x = rnd() * W, w = 2 + rnd() * 10, y0 = rnd() * H * 0.6, y1 = y0 + rnd() * H * 0.5; ctx.fillStyle = `rgba(${rnd() < 0.2 ? '120,60,20' : '10,8,6'},${0.15 + rnd() * 0.3})`; ctx.fillRect(x, y0, w, y1 - y0); }
    }
    this.decal.mesh.visible = !!any; tex.needsUpdate = true;
  }
  // -------------------------------------------------------------- appearance
  applyAppearance(ctxInfo) {
    const a = this.part.appearance || {}; const fin = finishes[a.finish] || finishes.default;
    for (const e of this.entries) {
      const m = e.mat; let texKey = e.texKey; let tinted = e.role === 'main';
      if (tinted && fin.map && fin.map !== 'none') texKey = fin.map;
      const noMap = (tinted && fin.map === 'none') || texKey === 'none';
      const t = noMap ? null : this.lib && this.lib.get(texKey);
      if (m.map !== t) { m.map = t; m.bumpMap = t && e.role !== 'rubber' ? t : null; m.needsUpdate = true; }
      m.bumpScale = 0.7;
      m.color.set(tinted ? (a.color || '#ffffff') : (e.role === 'rubber' ? '#222222' : e.role === 'dark' ? '#d0d0d0' : '#ffffff'));
      const rd = ROLE_DEFAULT[e.role] || ROLE_DEFAULT.main;
      m.metalness = (tinted && a.metalness != null) ? a.metalness : rd.metalness;
      m.roughness = (tinted && a.roughness != null) ? a.roughness : rd.roughness;
      if (a.heatDamage && tinted) m.color.multiplyScalar(0.75);
    }
    if (this.decal) this.drawDecal(ctxInfo || this.ctxInfo || {});
    if (ctxInfo) this.ctxInfo = ctxInfo;
    this.refreshEmissive();
  }
  setHighlight(kind) { if (this.highlight !== kind) { this.highlight = kind; this.refreshEmissive(); } }
  setHeat(h) { if (Math.abs(h - this.heat) > 0.01) { this.heat = h; this.refreshEmissive(); } }
  refreshEmissive() {
    const col = { select: [0.1, 0.35, 1.0, 0.45], hover: [0.2, 0.45, 0.8, 0.22], snap: [0.1, 1.0, 0.3, 0.5], invalid: [1, 0.15, 0.1, 0.5], host: [0.1, 0.9, 0.3, 0.3] }[this.highlight];
    for (const e of this.entries) {
      const m = e.mat;
      if (col) { m.emissive.setRGB(col[0], col[1], col[2]); m.emissiveIntensity = col[3]; }
      else if (this.heat > 0.05) { m.emissive.setRGB(1, 0.35 + 0.2 * this.heat, 0.08); m.emissiveIntensity = Math.min(1.2, this.heat * 1.2); }
      else { m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 0; }
    }
  }
  // -------------------------------------------------------------- landing leg deploy animation
  setLegDeploy(f) { for (const p of this.legs) p.rotation.z = -0.614 * (1 - f); }
  /** Lazily create the parachute canopy mesh (unit hemisphere scaled by canopy radius). */
  ensureCanopy() {
    if (this.extras.canopy) return this.extras.canopy;
    const g = new THREE.SphereGeometry(1, 32, 14, 0, TAU, 0, Math.PI / 2); g.scale(1, 0.62, 1);
    const e = this.mat('main', 'parachute', { double: true }); e.mat.roughness = 0.9; e.mat.metalness = 0; e.mat.map = this.lib.get('parachute');
    const mesh = new THREE.Mesh(g, e.mat); mesh.castShadow = true; mesh.visible = false; mesh.frustumCulled = false;
    this.entries.push(Object.assign(e, { mesh })); // disposed with entries
    const pos = new Float32Array(6 * 3 * 2); const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xdddddd })); lines.visible = false; lines.frustumCulled = false;
    this.extras.canopy = mesh; this.extras.lines = lines; return mesh;
  }
  dispose() {
    this.clear();
    if (this.extras.lines) { this.extras.lines.geometry.dispose(); this.extras.lines.material.dispose(); }
    if (this.extras.canopy) { this.extras.canopy.geometry.dispose(); }
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

/** Small helper: markers (node spheres) for the editor. */
export function makeNodeMarker() {
  const g = new THREE.SphereGeometry(0.07, 12, 8);
  const m = new THREE.MeshBasicMaterial({ color: 0x33dd66, transparent: true, opacity: 0.85, depthTest: false });
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 10; return mesh;
}
