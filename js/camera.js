// Orbit / pan / zoom camera rig used by the workshop and the flight "free" camera. Mouse + touch (pinch/two-finger pan) + wheel.
import * as THREE from 'three';

export class OrbitRig {
  constructor(camera, dom) {
    this.camera = camera; this.dom = dom;
    this.target = new THREE.Vector3(0, 3, 0); this.dist = 14; this.az = 0.6; this.el = 0.28;
    this.minDist = 1.5; this.maxDist = 400; this.enabled = true;
    this.pointers = new Map(); this.mode = null; this.last = null; this.moved = 0;
    this.shake = new THREE.Vector3();
    this.update();
  }
  update() {
    const ce = Math.cos(this.el), se = Math.sin(this.el);
    this.camera.position.set(this.target.x + this.dist * ce * Math.sin(this.az), this.target.y + this.dist * se, this.target.z + this.dist * ce * Math.cos(this.az));
    this.camera.lookAt(this.target);
  }
  orbit(dx, dy) { this.az -= dx * 0.006; this.el = Math.max(-1.45, Math.min(1.5, this.el + dy * 0.006)); }
  pan(dx, dy) {
    const k = this.dist * 0.0016; const m = this.camera.matrixWorld.elements;
    const right = new THREE.Vector3(m[0], m[1], m[2]), up = new THREE.Vector3(m[4], m[5], m[6]);
    this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
  }
  zoom(f) { this.dist = Math.max(this.minDist, Math.min(this.maxDist, this.dist * f)); }
  frame(box, pad = 1.6) {
    if (box.isEmpty()) return; const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    this.target.copy(c); const fov = this.camera.fov * Math.PI / 180; this.dist = Math.max(4, Math.max(s.y / 2 / Math.tan(fov / 2), s.x / 2 / Math.tan(fov / 2) / Math.max(this.camera.aspect, 0.5)) * pad + 3);
  }
  /** Attach pointer handling. `canOrbit(ev)` lets the owner claim the pointer (e.g. to drag a part). */
  attach(canOrbit = () => true) {
    const d = this.dom;
    d.style.touchAction = 'none';
    d.addEventListener('wheel', (e) => { if (!this.enabled) return; e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse' ? !(e.button === 1 || e.button === 2 || (e.button === 0 && canOrbit(e))) : false) return;
      if (e.pointerType !== 'mouse' && !canOrbit(e) && this.pointers.size === 0) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); d.setPointerCapture?.(e.pointerId);
      this.mode = e.pointerType === 'mouse' ? ((e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'orbit') : 'touch';
      this.moved = 0; this.last = { x: e.clientX, y: e.clientY };
    });
    d.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId); if (!p) return;
      if (this.mode === 'touch' && this.pointers.size >= 2) {
        const ids = [...this.pointers.keys()]; const a = this.pointers.get(ids[0]), b = this.pointers.get(ids[1]);
        const d0 = Math.hypot(a.x - b.x, a.y - b.y), cx0 = (a.x + b.x) / 2, cy0 = (a.y + b.y) / 2;
        p.x = e.clientX; p.y = e.clientY;
        const d1 = Math.hypot(a.x - b.x, a.y - b.y), cx1 = (a.x + b.x) / 2, cy1 = (a.y + b.y) / 2;
        if (d1 > 0 && d0 > 0) this.zoom(d0 / d1); this.pan(cx1 - cx0, cy1 - cy0); this.moved += 5; return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.mode === 'pan') this.pan(dx, dy); else this.orbit(dx, dy);
    });
    const up = (e) => { this.pointers.delete(e.pointerId); if (!this.pointers.size) this.mode = null; };
    d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
  }
}
