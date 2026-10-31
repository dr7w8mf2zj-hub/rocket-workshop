// Deterministic terrain height function shared by physics (collision) and rendering.
const hash = (x, y) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y); const xf = sm(x - xi), yf = sm(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf; }
function fbm(x, y, oct = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
export const PAD_RADIUS = 110;
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const t = Math.min(1, Math.max(0, (r - PAD_RADIUS) / 700)); const k = sm(t);
  const base = (fbm(x / 900 + 11.3, z / 900 + 4.7, 5) - 0.45) * 120;
  const far = Math.max(0, (r - 2500) / 9000); const mount = Math.pow(fbm(x / 6000 + 3.1, z / 6000 + 8.8, 4), 2.2) * 2600 * Math.min(1, far * far * 4);
  return k * (base + mount) + (1 - k) * 0;
}
const e = 1.5;
export function normalAt(x, z, out) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx / (2 * e), nz = -hz / (2 * e); const l = Math.sqrt(nx * nx + 1 + nz * nz); return out.set(nx / l, 1 / l, nz / l);
}
export const terrain = { heightAt, normalAt };
