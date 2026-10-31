// Procedural image-based lighting: a small gradient sky + sun blob rendered once into a PMREM environment map.
// Gives metals (stainless steel, grid fins, nozzles) something to reflect, which is the biggest single lighting upgrade.
import * as THREE from 'three';
let cached = null;
export function getEnvironment(renderer) {
  if (cached) return cached;
  const sc = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; void main(){ float h = vP.y; vec3 sky = mix(vec3(0.80,0.88,1.0), vec3(0.22,0.42,0.86), pow(clamp(h,0.0,1.0),0.55)); vec3 gnd = mix(vec3(0.42,0.38,0.34), vec3(0.12,0.11,0.10), clamp(-h*1.6,0.0,1.0));
      vec3 c = h > 0.0 ? sky : gnd; c = mix(c, vec3(0.95,0.93,0.9), exp(-abs(h)*14.0)*0.55);
      vec3 sunD = normalize(vec3(0.5,0.8,0.35)); float s = max(dot(vP, sunD), 0.0); c += vec3(1.0,0.92,0.78) * (pow(s, 220.0) * 14.0 + pow(s, 14.0) * 0.5);
      gl_FragColor = vec4(c, 1.0); }` });
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
  const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(sc, 0.02); pm.dispose(); sc.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  cached = rt.texture; return cached;
}
