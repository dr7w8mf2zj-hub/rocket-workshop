// Ready-made example designs (built through the same Design API as the editor; stored/loaded as JSON like any design).
import { Design } from './design.js';
import { PARTS, nodes } from './registry.js';

function stackUp(d, types, start = [0, 0, 0], opts = {}) {
  // types listed bottom -> top; each part links to the previous one (parent = lower part)
  const parts = []; let prev = null;
  for (const t of types) {
    const def = PARTS[t]; const p = d.addPart(t, { pos: [...start], dims: opts[t] });
    if (prev) { const pn = nodes(PARTS[prev.type], prev.dims).find(n => n.id === 'top'), cn = nodes(def, p.dims).find(n => n.id === 'bottom'); d.link(prev.id, p.id, { pn: pn.id, cn: cn.id }); }
    parts.push(p); prev = p;
  }
  d.layout(); return parts;
}
function radial(d, host, type, ang, y, dims) { const p = d.addPart(type, { dims }); d.link(host.id, p.id, { radial: { ang, y } }); d.layout(); return p; }
function sym(d, host, type, n, y, dims, off = 0) { const out = []; for (let i = 0; i < n; i++) out.push(radial(d, host, type, off + i * Math.PI * 2 / n, y, dims)); return out; }

export const TEMPLATES = {
  'Lark-1 (single stage)': () => {
    const d = new Design(); d.name = 'Lark-1'; d.idCode = 'LK-01';
    const [eng, t1, t2, pod, chute] = stackUp(d, ['liquid_engine', 'fuel_tank', 'fuel_tank', 'control_module', 'parachute'], [0, 0, 0], { parachute: { canopy: 12 } });
    sym(d, t1, 'fins', 4, -0.7, { span: 1.4, chord: 1.8 }, Math.PI / 4); sym(d, t1, 'landing_legs', 4, -0.8, { length: 2.5 }, 0);
    sym(d, t2, 'solar_panels', 2, 0.3, { length: 1.0, width: 0.6 }, 0); sym(d, t2, 'battery', 2, -0.2, undefined, Math.PI / 2);
    d.rootId = pod.id; d.autoStage();
    const cone = d.addPart('nose_cone'); 
    d.setRoot(pod.id); d.layout(); d.removePart(cone.id);
    pod.appearance.markName = true; pod.appearance.markId = true; t1.appearance.markName = true; t2.appearance.stripe = true; t2.appearance.stripeColor = '#c8342f';
    for (const p of d.all()) if (PARTS[p.type].model === 'fin') p.appearance.color = '#c8342f';
    d.autoStage(); return d;
  },
  'Atlas-II (two stage)': () => {
    const d = new Design(); d.name = 'Atlas II'; d.idCode = 'AT-02';
    const [e1, a, b, c, dec, e2, tk, pod, chute] = stackUp(d, ['liquid_engine', 'fuel_tank', 'fuel_tank', 'fuel_tank', 'decoupler', 'liquid_engine_vac', 'fuel_tank', 'control_module', 'parachute'], [0, 0, 0], { parachute: { canopy: 14 } });
    sym(d, a, 'fins', 4, -0.7, { span: 1.3, chord: 1.5 }, Math.PI / 4); sym(d, tk, 'rcs_thruster', 2, 0.6, undefined, 0);
    sym(d, tk, 'battery', 2, 0, undefined, Math.PI / 2); sym(d, pod, 'solar_panels', 2, 0, { length: 1.0, width: 0.6 }, Math.PI / 2);
    for (const p of [a, b, c]) p.appearance.markName = true;
    d.rootId = pod.id; d.autoStage(); return d;
  },
  'Titan-B (boosted heavy)': () => {
    const d = new Design(); d.name = 'Titan B'; d.idCode = 'TB-03';
    const [e1, t1, t2, dec, e2, t3, pod, chute] = stackUp(d, ['liquid_engine', 'fuel_tank', 'fuel_tank', 'decoupler', 'liquid_engine_vac', 'fuel_tank_small', 'control_module', 'parachute'], [0, 0, 0], { parachute: { canopy: 14 } });
    const srbs = sym(d, t1, 'srb', 2, -0.45, undefined, 0); for (const s of srbs) s.appearance.stripe = true;
    sym(d, t1, 'fins', 4, -0.7, { span: 1.5, chord: 2.0 }, Math.PI / 4); sym(d, t3, 'battery', 2, 0, undefined, 0); sym(d, t3, 'solar_panels', 2, 0, { length: 1.0, width: 0.6 }, Math.PI / 2);
    d.rootId = pod.id; d.autoStage(); return d;
  },
  'Pocket Hopper (tiny)': () => {
    const d = new Design(); d.name = 'Hopper'; d.idCode = 'HP-04';
    const [eng, tk, pod, chute] = stackUp(d, ['liquid_engine_vac', 'fuel_tank_small', 'control_module', 'parachute'], [0, 0, 0], { parachute: { canopy: 7 } });
    sym(d, tk, 'landing_legs', 4, -0.2, { length: 2.2 }, 0.4); sym(d, tk, 'fins', 3, -0.2, { span: 0.9, chord: 1.2 }, 0.9); sym(d, pod, 'battery', 2, 0, undefined, 0);
    // engine is a vacuum engine: weak at sea level, so add a short extension for demonstration of the nozzle part
    d.rootId = pod.id; d.autoStage(); return d;
  },
};
export const TEMPLATE_NAMES = Object.keys(TEMPLATES);
