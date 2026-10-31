// Exhaust particles, smoke, explosions, flame meshes, engine light, camera shake.
import * as THREE from 'three';

const PVERT = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor; varying float vAlpha; varying vec3 vColor; uniform float uScale;
void main(){ vAlpha = aAlpha; vColor = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 900.0); }`;
const PFRAG = `
uniform sampler2D uMap; varying float vAlpha; varying vec3 vColor; uniform float uFogDensity; uniform vec3 uFogColor;
void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha); if (gl_FragColor.a < 0.004) discard; }`;

export class ParticlePool {
  constructor(scene, map, max, additive) {
    this.max = max; this.i = 0; this.count = 0;
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.age = new Float32Array(max).fill(1e9); this.life = new Float32Array(max).fill(1); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max); this.drag = new Float32Array(max); this.buoy = new Float32Array(max);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g; this.mat = new THREE.ShaderMaterial({ vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uMap: { value: map }, uScale: { value: 600 } } });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 6 : 5; scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag = 0, buoy = 0) {
    const i = this.i; this.i = (this.i + 1) % this.max; const p = i * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z; this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.col[p] = r; this.col[p + 1] = g; this.col[p + 2] = b; this.a0[i] = a; this.drag[i] = drag; this.buoy[i] = buoy; this.size[i] = s0; this.alpha[i] = a;
  }
  update(dt, viewHeight, fov) {
    this.mat.uniforms.uScale.value = viewHeight / (2 * Math.tan(fov * Math.PI / 360));
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      this.age[i] += dt; const t = Math.min(1, this.age[i] / this.life[i]); const p = i * 3; live++;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[p] *= k; this.vel[p + 1] = this.vel[p + 1] * k + this.buoy[i] * dt; this.vel[p + 2] *= k;
      this.pos[p] += this.vel[p] * dt; this.pos[p + 1] += this.vel[p + 1] * dt; this.pos[p + 2] += this.vel[p + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t; this.alpha[i] = this.a0[i] * (1 - t) * (t < 0.08 ? t / 0.08 : 1);
    }
    this.live = live; const g = this.geo; g.attributes.position.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true; g.attributes.aColor.needsUpdate = true;
  }
  dispose() { this.points.parent?.remove(this.points); this.geo.dispose(); this.mat.dispose(); }
}

const FLAME_V = `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const FLAME_F = `varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform float uInt; uniform float uTime; uniform vec3 uCol;
void main(){ float l = 1.0 - vUv.y; float f = abs(dot(normalize(vN), normalize(vV))); float fall = pow(l, 1.4); float flick = 0.85 + 0.15 * sin(uTime * 55.0 + vUv.y * 18.0);
  float core = pow(l, 2.0) * f * f; vec3 c = mix(uCol, vec3(1.0,0.92,0.7), core); gl_FragColor = vec4(c * flick, fall * pow(f, 1.4) * uInt * 0.85); }`;

export function makeFlame() {
  // cone along -Y from origin (exit plane); geometry length 1, base radius 1 at top (y=0), tip at y=-1
  const g = new THREE.ConeGeometry(1, 1, 20, 1, true); g.translate(0, -0.5, 0);
  // uv.y: 1 at tip? ConeGeometry v=1 at apex(top). we flipped by translate; set our own
  const uv = g.attributes.uv; const pos = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setY(i, -pos.getY(i));
  g.rotateX(Math.PI); g.translate(0, 0, 0); // after rotate, apex points -Y? ConeGeometry apex is +Y; translate shifted down; rotate by PI -> apex -Y wait ensure orientation below
  g.rotateX(Math.PI); // revert double; build manually instead
  const geo = new THREE.ConeGeometry(1, 1, 20, 1, true); // apex at +Y, base at -Y (centered)
  geo.rotateX(Math.PI); // apex at -Y, base at +Y
  geo.translate(0, -0.5, 0); // base at y=0, apex at y=-1
  const p2 = geo.attributes.position, u2 = geo.attributes.uv; for (let i = 0; i < u2.count; i++) u2.setY(i, -p2.getY(i)); // 0 at base, 1 at tip
  g.dispose();
  const mat = new THREE.ShaderMaterial({ vertexShader: FLAME_V, fragmentShader: FLAME_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uInt: { value: 1 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(1.0, 0.55, 0.15) } } });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 7; return mesh;
}

export class Effects {
  constructor(scene, lib) {
    this.scene = scene; this.smoke = new ParticlePool(scene, lib.get('smoke_puff'), 3500, false); this.fire = new ParticlePool(scene, lib.get('flame_glow'), 2500, true);
    this.flashLight = new THREE.PointLight(0xffaa55, 0, 200, 1.5); scene.add(this.flashLight); this.flash = 0; this.shake = 0; this.time = 0;
    this.shakeVec = new THREE.Vector3(); this.rcsAcc = 0;
  }
  rnd(a = 1) { return (Math.random() - 0.5) * 2 * a; }
  explosion(pos, size) {
    const n = Math.min(70, 25 + size * 10);
    for (let i = 0; i < n; i++) { const v = (8 + Math.random() * 24) * Math.max(1, size * 0.6); this.fire.emit(pos.x, pos.y, pos.z, this.rnd(v), this.rnd(v) + 4, this.rnd(v), 0.5 + Math.random() * 0.8, size * 1.4, size * 4, 1, 0.6 + Math.random() * 0.3, 0.2, 1, 1.5); }
    for (let i = 0; i < n; i++) { const v = (4 + Math.random() * 14); this.smoke.emit(pos.x, pos.y, pos.z, this.rnd(v), this.rnd(v) + 5, this.rnd(v), 3 + Math.random() * 4, size * 1.5, size * 6, 0.18, 0.17, 0.16, 0.85, 0.6, 1.5); }
    this.flash = Math.min(1.5, 0.5 + size * 0.3); this.flashLight.position.copy(pos); this.shake += 0.6 * size;
  }
  sparks(pos) { for (let i = 0; i < 24; i++) this.fire.emit(pos.x, pos.y, pos.z, this.rnd(9), this.rnd(9), this.rnd(9), 0.4 + Math.random() * 0.3, 0.8, 0.2, 1, 0.8, 0.4, 1, 1); }
  /** Emit exhaust for one engine. exit: world pos, dir: world exhaust direction (unit, pointing away from nozzle), vel: body velocity */
  exhaust(exit, dir, bodyVel, thrustFrac, exitR, rho, press, groundH, dt) {
    const rate = Math.min(80, thrustFrac * (60 + exitR * 90)) * dt * 60 / 60;
    let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    const spread = 0.05 + 0.35 * (1 - press);
    for (let i = 0; i < n; i++) {
      const sp = 70 + Math.random() * 90; const t = Math.random();
      const px = exit.x + dir.x * t * 0.8 + this.rnd(exitR * 0.5), py = exit.y + dir.y * t * 0.8 + this.rnd(exitR * 0.5), pz = exit.z + dir.z * t * 0.8 + this.rnd(exitR * 0.5);
      this.fire.emit(px, py, pz, dir.x * sp + bodyVel.x * 0.9 + this.rnd(spread * sp), dir.y * sp + bodyVel.y * 0.9 + this.rnd(spread * sp), dir.z * sp + bodyVel.z * 0.9 + this.rnd(spread * sp), 0.25 + Math.random() * 0.25, exitR * 2.0 * (1 + 2 * (1 - press)), exitR * 5, 1, 0.5 + Math.random() * 0.3, 0.15, 0.55, 1.5);
    }
    // smoke trail (dense air only)
    if (rho > 0.02 && Math.random() < thrustFrac * Math.min(1, rho) * 0.9) {
      const sp = 20 + Math.random() * 30; this.smoke.emit(exit.x + dir.x * 3, exit.y + dir.y * 3, exit.z + dir.z * 3, dir.x * sp * 0.4 + bodyVel.x * 0.3 + this.rnd(2), dir.y * sp * 0.4 + bodyVel.y * 0.3 + this.rnd(2), dir.z * sp * 0.4 + bodyVel.z * 0.3 + this.rnd(2), 5 + Math.random() * 4, exitR * 3, exitR * 14 * (0.6 + rho * 0.5), 0.8, 0.8, 0.8, 0.5 * Math.min(1, rho * 1.5), 0.6, 0.5);
    }
    // ground blast: smoke + dust sheet when engine is near terrain
    const h = exit.y - groundH;
    if (h < 45 && thrustFrac > 0.05 && rho > 0.1) {
      const k = (1 - h / 45); const cnt = Math.floor(k * thrustFrac * 4 * (dt * 60)) + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < cnt; i++) { const a = Math.random() * Math.PI * 2; const sp = 14 + Math.random() * 26 * (0.5 + k); this.smoke.emit(exit.x + Math.cos(a) * 2, groundH + 1 + Math.random() * 2, exit.z + Math.sin(a) * 2, Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp, 4 + Math.random() * 5, 5 + exitR * 3, 24 + exitR * 20, 0.82, 0.8, 0.76, 0.85, 0.5, 0.8); }
    }
  }
  rcsPuff(pos, dir) { for (let i = 0; i < 3; i++) this.fire.emit(pos.x, pos.y, pos.z, dir.x * 12 + this.rnd(1.5), dir.y * 12 + this.rnd(1.5), dir.z * 12 + this.rnd(1.5), 0.25, 0.25, 0.05, 0.9, 0.95, 1, 0.8, 2); }
  update(dt, viewHeight, fov) {
    this.time += dt; this.smoke.update(dt, viewHeight, fov); this.fire.update(dt, viewHeight, fov);
    this.flash = Math.max(0, this.flash - dt * 2.2); this.flashLight.intensity = this.flash * 60000 * 0.01 * 100;
    this.shake *= Math.exp(-dt * 3.0);
  }
  dispose() { this.smoke.dispose(); this.fire.dispose(); this.scene.remove(this.flashLight); }
}
