// World rendering: terrain rings, launch pad, sky dome, stars, clouds, sun lighting with altitude-dependent atmosphere.
import * as THREE from 'three';
import { heightAt, PAD_RADIUS } from './terrain.js';

const SKY_VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }`;
const SKY_FRAG = `
varying vec3 vDir; uniform float uAtm; uniform vec3 uSun; uniform float uSunUp;
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 zen = mix(vec3(0.0,0.0,0.004), vec3(0.10,0.28,0.62), uAtm);
  vec3 hor = mix(vec3(0.0,0.0,0.006), vec3(0.62,0.78,0.95), uAtm);
  float t = pow(clamp(h,0.0,1.0), 0.45);
  vec3 col = mix(hor, zen, t);
  // thin atmosphere limb glow when high
  float limb = exp(-abs(h)*18.0) * (1.0-uAtm) * 0.35 * smoothstep(0.0,0.4,uAtm*3.0+0.2) ;
  col += vec3(0.25,0.45,0.9) * limb * step(0.001, uAtm);
  float sd = max(dot(d, normalize(uSun)), 0.0);
  col += vec3(1.0,0.85,0.55) * pow(sd, 400.0) * 3.0;
  col += vec3(1.0,0.7,0.4) * pow(sd, 6.0) * 0.28 * uAtm;
  // below horizon: ground haze colour
  if (h < 0.0) col = mix(hor, vec3(0.20,0.24,0.20) * (0.2 + 0.8 * uAtm), clamp(-h*6.0,0.0,1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export class World {
  constructor(scene, lib, renderer) {
    this.scene = scene; this.lib = lib; this.renderer = renderer; this.disposables = [];
    this.root = new THREE.Group(); scene.add(this.root);
    this.sunDir = new THREE.Vector3(0.45, 0.78, 0.3).normalize();
    this.buildLights(); this.buildSky(); this.buildTerrain(); this.buildPad(); this.buildClouds();
    this.atm = 1; this.clampsOpen = 0;
  }
  track(o) { this.disposables.push(o); return o; }
  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4030, 1.0); this.root.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 3.0); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); const c = this.sun.shadow.camera; c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 1; c.far = 400;
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.05;
    this.root.add(this.sun); this.root.add(this.sun.target);
    this.engineLight = new THREE.PointLight(0xff9a40, 0, 120, 1.6); this.root.add(this.engineLight);
  }
  buildSky() {
    const geo = this.track(new THREE.SphereGeometry(5e5, 32, 16));
    this.skyMat = this.track(new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, uniforms: { uAtm: { value: 1 }, uSun: { value: this.sunDir }, uSunUp: { value: 1 } } }));
    this.sky = new THREE.Mesh(geo, this.skyMat); this.sky.renderOrder = -10; this.sky.frustumCulled = false; this.root.add(this.sky);
    // stars
    const N = 2600; const pos = new Float32Array(N * 3), col = new Float32Array(N * 3); let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < N; i++) { const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u); pos.set([r * Math.cos(a) * 4e5, u * 4e5, r * Math.sin(a) * 4e5], i * 3); const b = 0.45 + rnd() * 0.55; const tint = rnd(); col.set([b * (0.85 + 0.15 * tint), b * 0.95, b * (1.0 - 0.1 * tint)], i * 3); }
    const g = this.track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starMat = this.track(new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, depthTest: true, fog: false }));
    this.stars = new THREE.Points(g, this.starMat); this.stars.renderOrder = -9; this.stars.frustumCulled = false; this.root.add(this.stars);
  }
  buildTerrain() {
    const grass = this.lib.get('terrain_grass'), rock = this.lib.get('terrain_rock');
    const mk = (size, seg, rep, yoff, tex) => {
      const g = this.track(new THREE.PlaneGeometry(size, size, seg, seg)); g.rotateX(-Math.PI / 2);
      const p = g.attributes.position; const col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i); const h = heightAt(x, z); p.setY(i, h + yoff);
        const slope = Math.abs(heightAt(x + 8, z) - h) + Math.abs(heightAt(x, z + 8) - h); const r = Math.hypot(x, z);
        const hh = Math.min(1, Math.max(0, h / 900)); const rk = Math.min(1, slope / 9 + hh * 0.9);
        const g1 = [0.55, 0.78, 0.45], r1 = [0.68, 0.62, 0.56], sn = [0.95, 0.96, 0.98];
        const snow = Math.max(0, (h - 1300) / 500);
        for (let c = 0; c < 3; c++) col[i * 3 + c] = (g1[c] * (1 - rk) + r1[c] * rk) * (1 - snow) + sn[c] * snow;
        const pad = Math.max(0, 1 - Math.max(0, r - 60) / 60); for (let c = 0; c < 3; c++) col[i * 3 + c] = col[i * 3 + c] * (1 - pad * 0.5) + 0.62 * pad * 0.5;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
      let map = null; if (grass) { map = grass.clone(); map.needsUpdate = true; map.repeat.set(rep, rep); this.track(map); }
      const m = this.track(new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 1, metalness: 0 }));
      const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.frustumCulled = false; this.root.add(mesh); return mesh;
    };
    this.terrain = [mk(2400, 200, 300, 0, grass), mk(28000, 200, 700, -2.5, grass), mk(400000, 160, 900, -40, grass)];
  }
  buildPad() {
    const pad = new THREE.Group(); this.root.add(pad); this.pad = pad;
    const concrete = this.lib.get('launchpad_concrete'); let cm = null; if (concrete) { cm = concrete.clone(); cm.needsUpdate = true; cm.repeat.set(10, 10); this.track(cm); }
    const cmat = this.track(new THREE.MeshStandardMaterial({ map: cm, color: 0xbbbbbb, roughness: 0.95, metalness: 0 }));
    const slab = new THREE.Mesh(this.track(new THREE.BoxGeometry(60, 0.5, 60)), cmat); slab.position.y = -0.25 + 0.02; slab.receiveShadow = true; slab.castShadow = false; pad.add(slab);
    const mount = new THREE.Mesh(this.track(new THREE.CylinderGeometry(7, 8, 0.4, 32)), this.track(new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.6, metalness: 0.7 }))); mount.position.y = 0.16; mount.receiveShadow = true; pad.add(mount);
    const trench = new THREE.Mesh(this.track(new THREE.BoxGeometry(5, 0.05, 40)), this.track(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 }))); trench.position.set(0, 0.05, 0); pad.add(trench);
    // service tower
    const steel = this.track(new THREE.MeshStandardMaterial({ color: 0xb04030, roughness: 0.55, metalness: 0.6 }));
    const tower = new THREE.Group(); tower.position.set(-13, 0, 0); pad.add(tower);
    const H = 70; const beam = this.track(new THREE.BoxGeometry(0.5, H, 0.5));
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) { const b = new THREE.Mesh(beam, steel); b.position.set(x, H / 2, z); b.castShadow = true; tower.add(b); }
    const hb = this.track(new THREE.BoxGeometry(3.7, 0.25, 0.25)), vb = this.track(new THREE.BoxGeometry(0.25, 0.25, 3.7));
    for (let y = 2; y < H; y += 5) { for (const z of [-1.6, 1.6]) { const b = new THREE.Mesh(hb, steel); b.position.set(0, y, z); tower.add(b); } for (const x of [-1.6, 1.6]) { const b = new THREE.Mesh(vb, steel); b.position.set(x, y, 0); tower.add(b); } }
    const diag = this.track(new THREE.BoxGeometry(0.15, 5.4, 0.15));
    for (let y = 0; y < H - 5; y += 5) { for (const s of [-1.6, 1.6]) { const d1 = new THREE.Mesh(diag, steel); d1.position.set(s, y + 2.5, 0); d1.rotation.z = 0; d1.rotation.x = 0.66; tower.add(d1); } }
    this.arms = []; const armGeo = this.track(new THREE.BoxGeometry(11, 0.6, 1.2)); const armMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.5, metalness: 0.5 }));
    for (const y of [8, 17, 26]) { const piv = new THREE.Group(); piv.position.set(1.7, y, 0); const a = new THREE.Mesh(armGeo, armMat); a.position.x = 5.5; a.castShadow = true; piv.add(a); tower.add(piv); this.arms.push(piv); }
    const mast = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.05, 0.12, 14, 8)), steel); mast.position.set(0, H + 7, 0); tower.add(mast);
    // clamps
    this.clamps = []; const clampGeo = this.track(new THREE.BoxGeometry(0.8, 1.2, 0.8)), clampMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5, metalness: 0.4 }));
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const piv = new THREE.Group(); piv.position.set(Math.cos(a) * 1.6, 0.5, Math.sin(a) * 1.6); const c = new THREE.Mesh(clampGeo, clampMat); c.castShadow = true; piv.add(c); piv.userData.a = a; pad.add(piv); this.clamps.push(piv); }
    // lamps + tanks
    const tankMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.5 }));
    for (const [x, z] of [[28, -22], [28, 22]]) { const t = new THREE.Mesh(this.track(new THREE.SphereGeometry(4.5, 24, 16)), tankMat); t.position.set(x, 4.8, z); t.castShadow = true; pad.add(t); const l = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.4, 0.5, 3, 8)), steel); l.position.set(x, 1.5, z); pad.add(l); }
    const lampMat = this.track(new THREE.MeshBasicMaterial({ color: 0xfff4c0 })); const lampG = this.track(new THREE.SphereGeometry(0.35, 8, 6));
    for (const [x, z] of [[-24, -24], [24, -24], [24, 24], [-24, 24]]) { const pole = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.15, 0.2, 14, 6)), steel); pole.position.set(x, 7, z); pad.add(pole); const lamp = new THREE.Mesh(lampG, lampMat); lamp.position.set(x, 14.2, z); pad.add(lamp); }
    // painted ring + number
    const cv = document.createElement('canvas'); cv.width = cv.height = 512; const cx = cv.getContext('2d'); cx.fillStyle = 'rgba(0,0,0,0)'; cx.clearRect(0, 0, 512, 512); cx.strokeStyle = '#e8c030'; cx.lineWidth = 14; cx.beginPath(); cx.arc(256, 256, 236, 0, 7); cx.stroke(); cx.fillStyle = '#e8e8e8'; cx.font = 'bold 120px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('LC-1', 256, 256);
    const ct = this.track(new THREE.CanvasTexture(cv)); ct.colorSpace = THREE.SRGBColorSpace;
    const ring = new THREE.Mesh(this.track(new THREE.PlaneGeometry(26, 26)), this.track(new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; pad.add(ring);
  }
  buildClouds() {
    const tex = this.lib.get('cloud_puff'); this.clouds = []; const g = new THREE.Group(); this.root.add(g); this.cloudGroup = g;
    const mat = this.track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85, fog: true, color: 0xffffff }));
    this.cloudMat = mat; let seed = 99; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let c = 0; c < 38; c++) { const cx = (rnd() - 0.5) * 36000, cz = (rnd() - 0.5) * 36000, cy = 1600 + rnd() * 2200; const n = 6 + Math.floor(rnd() * 8);
      for (let i = 0; i < n; i++) { const s = new THREE.Sprite(mat); const sz = 700 + rnd() * 1100; s.scale.set(sz * 1.6, sz * 0.8, 1); s.position.set(cx + (rnd() - 0.5) * 1800, cy + (rnd() - 0.5) * 140, cz + (rnd() - 0.5) * 1800); g.add(s); } }
  }
  /** Per-frame update. alt = camera altitude; atmosphere = sandbox density multiplier; followPos for shadow camera */
  update(camPos, alt, atmosphereSetting, scaleHeight, focus) {
    const dens = atmosphereSetting <= 0 ? 0 : Math.exp(-Math.max(0, alt) / (scaleHeight * 1.0));
    const atm = Math.min(1, dens * Math.min(1, atmosphereSetting * 1.4)); this.atm = atm;
    this.sky.position.copy(camPos); this.stars.position.copy(camPos);
    this.skyMat.uniforms.uAtm.value = atm;
    this.starMat.opacity = Math.min(1, Math.max(0, 1.15 - atm * 4.5));
    const scene = this.scene; const horizon = new THREE.Color().setRGB(0.62 * atm, 0.78 * atm, 0.95 * atm);
    if (!scene.fog) scene.fog = new THREE.FogExp2(0xaaccee, 0.0001);
    scene.fog.color.copy(horizon); scene.fog.density = 0.000075 * atm * (alt < 8000 ? 1 : Math.max(0, 1 - (alt - 8000) / 22000));
    this.hemi.intensity = 0.12 + 0.95 * atm; this.hemi.color.setRGB(0.55 + 0.3 * atm, 0.7 + 0.2 * atm, 0.9 + 0.1 * atm);
    this.sun.intensity = 3.2; this.sun.color.setRGB(1, 0.95 - 0.05 * (1 - atm), 0.85 + 0.1 * (1 - atm));
    this.cloudMat.opacity = 0.85 * Math.max(0, Math.min(1, 1 - (alt - 7000) / 6000));
    this.cloudGroup.visible = this.cloudMat.opacity > 0.01;
    // shadow follows focus
    const f = focus || camPos; this.sun.target.position.copy(f); this.sun.position.copy(f).addScaledVector(this.sunDir, 200);
    // terrain rings: keep the far ring following horizontally is not possible (heights baked) so just keep as is
  }
  setClamps(open) { // 0 closed .. 1 open
    for (const c of this.clamps) { c.rotation.set(0, 0, 0); c.position.set(Math.cos(c.userData.a) * (1.6 + open * 3), 0.5, Math.sin(c.userData.a) * (1.6 + open * 3)); }
    this.arms.forEach((a, i) => { a.rotation.y = open * 1.2 * (i % 2 ? -1 : 1) * 0.0 + open * 0.9; });
  }
  dispose() {
    for (const o of this.disposables) o.dispose?.();
    this.scene.remove(this.root); this.disposables = [];
  }
}
