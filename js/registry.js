// Component registry: links each part type to its 3D model builder, texture, material defaults,
// attachment points, physical properties (mass, thrust, fuel...) and editable parameters.
export const CATEGORIES = [
  { id: 'engines', name: 'Engines', icon: '🔥' },
  { id: 'fuel', name: 'Fuel Tanks', icon: '⛽' },
  { id: 'structural', name: 'Structural', icon: '🔩' },
  { id: 'aero', name: 'Aerodynamic', icon: '🪶' },
  { id: 'electronics', name: 'Electronics', icon: '🔋' },
  { id: 'landing', name: 'Landing & Recovery', icon: '🛬' },
];

const R = 0.625; // 1.25 m standard diameter
const rp = (def, min, max) => ({ key: 'radius', label: 'Radius (m)', def, min, max, step: 0.025, exp: 2 });
const lp = (def, min, max) => ({ key: 'length', label: 'Length (m)', def, min, max, step: 0.05, exp: 1 });
const sp = (def, min, max) => ({ key: 'scale', label: 'Scale', def, min, max, step: 0.05, exp: 2 });

// stack: 'both' | 'top' | 'bottom' | 'none'  -> where stack attachment nodes sit
// radial: true => may be surface-attached to cylindrical host parts
export const PARTS = {
  nose_cone: { name: 'Aero Nose Cone', category: 'aero', desc: 'Ogive nose cone. Lowest drag when pointing forward.', texture: 'nose_cone', model: 'cone',
    params: [rp(R, 0.15, 2.5), lp(1.4, 0.4, 4)], stack: 'bottom', host: false, mass: 110, cdFront: 0.12, cdBack: 1.0, decal: true, crash: 6, tileV: false },
  adapter: { name: 'Tapered Adapter', category: 'aero', desc: 'Tapers from the bottom radius to 60% at the top.', texture: 'adapter', model: 'adapter',
    params: [rp(R, 0.2, 2.5), lp(0.8, 0.3, 3)], stack: 'both', host: true, mass: 90, cdFront: 0.35, cdBack: 0.9, decal: true, crash: 7, tileV: false, topK: 0.6 },
  fins: { name: 'Stabiliser Fin', category: 'aero', desc: 'Radial fin: aerodynamic stability (centre of pressure aft of centre of mass).', texture: 'rocket_fins', model: 'fin',
    params: [{ key: 'span', label: 'Span (m)', def: 0.9, min: 0.2, max: 3, step: 0.05, exp: 1 }, { key: 'chord', label: 'Chord (m)', def: 1.1, min: 0.2, max: 3, step: 0.05, exp: 1 }],
    stack: 'none', radial: true, mass: 35, crash: 5, finArea: true, tileV: false },
  body: { name: 'Body Section', category: 'structural', desc: 'Painted hollow body tube.', texture: 'rocket_body', model: 'tube',
    params: [rp(R, 0.15, 2.5), lp(1.5, 0.3, 6)], stack: 'both', host: true, mass: 140, cdFront: 0.8, cdBack: 0.8, decal: true, crash: 7, tileV: true },
  body_panels: { name: 'Panelled Body', category: 'structural', desc: 'Body tube with access hatches and fasteners.', texture: 'rocket_body_panels', model: 'tube',
    params: [rp(R, 0.15, 2.5), lp(1.5, 0.3, 6)], stack: 'both', host: true, mass: 170, cdFront: 0.8, cdBack: 0.8, decal: true, crash: 7, tileV: true },
  structural_connector: { name: 'Structural Connector', category: 'structural', desc: 'Short truss ring for connecting stack sections.', texture: 'structural_connector', model: 'connector',
    params: [rp(R, 0.15, 2.5), lp(0.35, 0.15, 1.5)], stack: 'both', host: true, mass: 45, cdFront: 0.8, cdBack: 0.8, crash: 9, tileV: false },
  decoupler: { name: 'Stack Decoupler', category: 'structural', desc: 'Explosive separation ring. Staged: splits the stack and the far side becomes independent debris.', texture: 'decoupler', model: 'connector',
    params: [rp(R, 0.15, 2.5)], fixedLength: 0.3, stack: 'both', host: true, mass: 55, cdFront: 0.8, cdBack: 0.8, sep: true, ejection: 2.5, crash: 9, tileV: false },
  docking_port: { name: 'Docking Port', category: 'structural', desc: 'Docking ring with latches. Can be staged as an undocking separator (no docking mechanic).', texture: 'docking_port', model: 'dock',
    params: [rp(0.45, 0.2, 1.5)], fixedLength: 0.35, stack: 'both', host: false, mass: 60, cdFront: 0.8, cdBack: 0.8, sep: true, ejection: 0.8, crash: 7, tileV: false },
  fuel_tank: { name: 'Fuel Tank', category: 'fuel', desc: 'Liquid fuel + oxidiser tank, 1.25 m.', texture: 'fuel_tank', model: 'tank',
    params: [rp(R, 0.15, 2.5), lp(2.0, 0.4, 6)], stack: 'both', host: true, mass: 220, fuel: 1800, cdFront: 0.8, cdBack: 0.8, decal: true, crash: 6, tileV: true },
  fuel_tank_small: { name: 'Fuel Tank (Short)', category: 'fuel', desc: 'Half-length tank.', texture: 'fuel_tank', model: 'tank',
    params: [rp(R, 0.15, 2.5), lp(1.0, 0.4, 6)], stack: 'both', host: true, mass: 120, fuel: 900, cdFront: 0.8, cdBack: 0.8, decal: true, crash: 6, tileV: true },
  liquid_engine: { name: 'LV-200 Liquid Engine', category: 'engines', desc: '200 kN sea-level lifter, gimballed.', texture: 'liquid_engine', texture2: 'engine_nozzle', model: 'engine',
    params: [sp(1, 0.5, 2)], r0: R, l0: 1.6, stack: 'both', mass: 950, engine: { thrust: 200000, ispSL: 280, ispVac: 310, gimbal: 3.5, liquid: true },
    cdFront: 0.9, cdBack: 0.7, crash: 9, tileV: false, bellK: 0.82 },
  liquid_engine_vac: { name: 'LV-V Vacuum Engine', category: 'engines', desc: '70 kN, excellent vacuum efficiency, poor at sea level.', texture: 'liquid_engine', texture2: 'engine_nozzle', model: 'engine',
    params: [sp(1, 0.5, 2)], r0: R, l0: 1.3, stack: 'both', mass: 330, engine: { thrust: 70000, ispSL: 130, ispVac: 365, gimbal: 4.5, liquid: true },
    cdFront: 0.9, cdBack: 0.7, crash: 9, tileV: false, bellK: 1.25, vac: true },
  srb: { name: 'Solid Rocket Booster', category: 'engines', desc: 'Fixed-thrust solid motor. Cannot be throttled or shut down. Radial separator by default.', texture: 'solid_rocket_booster', texture2: 'engine_nozzle', model: 'srb',
    params: [rp(0.45, 0.2, 1.4), lp(3.0, 1, 8)], stack: 'both', host: false, radial: true, mass: 280, solid: 2600,
    engine: { thrust: 260000, ispSL: 205, ispVac: 235, gimbal: 0, liquid: false }, cdFront: 0.3, cdBack: 0.7, decal: true, crash: 8, tileV: true, radialSep: true },
  engine_nozzle: { name: 'Nozzle Extension', category: 'engines', desc: 'Bolt-on bell for the engine above: +5% thrust, +6% vacuum Isp.', texture: 'engine_nozzle', model: 'nozzle',
    params: [sp(1, 0.5, 2)], r0: 0.55, l0: 0.7, stack: 'top', mass: 70, nozzleBoost: { thrust: 1.05, ispVac: 1.06 }, cdFront: 0.9, cdBack: 0.7, crash: 5, tileV: false },
  control_module: { name: 'Flight Control Module', category: 'electronics', desc: 'Avionics + reaction wheels. Needs electricity to steer. Cockpit camera mount.', texture: 'control_module', model: 'pod',
    params: [rp(R, 0.2, 2.0), lp(1.3, 0.5, 3)], stack: 'both', host: true, mass: 550, control: { torque: 9000, ecUse: 0.08 }, ec: 60, cdFront: 0.35, cdBack: 0.9, decal: true, crash: 12, tileV: false, cockpit: true, topK: 0.55 },
  battery: { name: 'Battery Pack', category: 'electronics', desc: '500 units of electric charge. Wrapped in insulation foil.', texture: 'battery', model: 'tube',
    params: [rp(0.3, 0.1, 1), lp(0.5, 0.2, 2)], stack: 'both', host: false, radial: true, mass: 45, ec: 500, cdFront: 0.8, cdBack: 0.8, crash: 7, tileV: false },
  solar_panels: { name: 'Solar Panel', category: 'electronics', desc: 'Flat radial array: 1.6 EC/s in sunlight.', texture: 'solar_panels', model: 'solar',
    params: [{ key: 'length', label: 'Length (m)', def: 1.4, min: 0.4, max: 4, step: 0.05, exp: 1 }, { key: 'width', label: 'Width (m)', def: 0.9, min: 0.3, max: 3, step: 0.05, exp: 1 }],
    stack: 'none', radial: true, mass: 25, ecGen: 1.6, crash: 4, tileV: false },
  rcs_thruster: { name: 'RCS Thruster Block', category: 'electronics', desc: 'Monoprop thrusters: extra attitude torque while RCS is enabled.', texture: 'rcs_thruster', model: 'rcs',
    params: [sp(1, 0.6, 2)], r0: 0.12, l0: 0.25, stack: 'none', radial: true, mass: 22, rcs: { torque: 1600, mono: 25 }, crash: 5, tileV: false },
  landing_legs: { name: 'Landing Leg', category: 'landing', desc: 'Sprung leg: deploy/retract (G). Soaks up landing impacts.', texture: 'landing_legs', model: 'leg',
    params: [lp(1.4, 0.5, 4)], stack: 'none', radial: true, mass: 75, leg: true, crash: 16, tileV: false },
  heat_shield: { name: 'Heat Shield', category: 'landing', desc: 'Ablative tiles protect the vehicle during fast re-entry.', texture: 'heat_shield', model: 'shield',
    params: [rp(R, 0.2, 2.5)], fixedLength: 0.22, stack: 'both', host: false, mass: 150, shield: { ablator: 120 }, cdFront: 0.8, cdBack: 0.5, crash: 12, tileV: false },
  parachute: { name: 'Parachute', category: 'landing', desc: 'Deploy with P (or stage). Canopy size is editable. Tears off above ~20 kPa dynamic pressure.', texture: 'parachute', model: 'chute',
    params: [{ key: 'canopy', label: 'Canopy radius (m)', def: 6, min: 1.5, max: 14, step: 0.5, exp: 2 }], r0: 0.3, fixedLength: 0.4, stack: 'bottom', host: false, radial: true, mass: 55, chute: true, cdFront: 0.5, cdBack: 0.8, crash: 7, tileV: false },
};
for (const [id, d] of Object.entries(PARTS)) { d.id = id; d.stageable = !!(d.engine || d.sep || d.chute); }

export const finishes = {
  default: { name: 'Part texture', map: null },
  carbon: { name: 'Carbon fibre', map: 'carbon_fibre' },
  foil: { name: 'Insulation foil', map: 'insulation_foil' },
  hazard: { name: 'Hazard stripes', map: 'hazard_stripes' },
  plain: { name: 'Plain paint (no texture)', map: 'none' },
};
export const surfacePresets = {
  matte: { name: 'Matte', metalness: 0.05, roughness: 0.9 },
  satin: { name: 'Satin', metalness: 0.2, roughness: 0.55 },
  gloss: { name: 'Gloss', metalness: 0.1, roughness: 0.2 },
  metallic: { name: 'Metallic', metalness: 0.9, roughness: 0.3 },
  brushed: { name: 'Brushed', metalness: 0.85, roughness: 0.55 },
};
export const insignias = { none: null, star: 'insignia_star', chevron: 'insignia_chevron', patch: 'insignia_patch', checker: 'insignia_checker' };
export const colorSchemes = {
  'Classic White/Red': { primary: '#f2f2f2', secondary: '#c8342f', accent: '#ffffff' },
  'Agency Orange': { primary: '#ff9a3c', secondary: '#ffffff', accent: '#ffd9a8' },
  'Stealth Black': { primary: '#5a5d65', secondary: '#303236', accent: '#8a8f99' },
  'Arctic Blue': { primary: '#a7d3ff', secondary: '#2f6fd0', accent: '#ffffff' },
  'Olive Drab': { primary: '#98a26a', secondary: '#4d5a30', accent: '#d8d8c0' },
  'Retro Chequer': { primary: '#ffffff', secondary: '#303030', accent: '#e8c030' },
};

export const defaultAppearance = () => ({ color: '#ffffff', finish: 'default', metalness: null, roughness: null, markName: false, markId: false, stripe: false, stripeColor: '#c8342f', insignia: 'none', heatDamage: false });

export function defaultDims(def) { const o = {}; for (const p of def.params) o[p.key] = p.def; return o; }
export function fillDims(def, dims) { const o = defaultDims(def); if (dims) for (const k in dims) if (k in o && Number.isFinite(+dims[k])) o[k] = +dims[k]; return o; }

/** Radius/length in metres for a part definition and dims. */
export function geom(def, dims) {
  const d = fillDims(def, dims);
  let r, L;
  if ('radius' in d) r = d.radius; else if ('scale' in d) r = def.r0 * d.scale; else r = def.r0 || 0.2;
  if ('length' in d) L = d.length; else if (def.fixedLength) L = def.fixedLength; else if ('scale' in d) L = def.l0 * d.scale; else L = def.l0 || 0.3;
  return { r, L, d };
}
/** Scale factor applied to mass / fuel / thrust relative to default dimensions. */
export function massK(def, dims) {
  const d = fillDims(def, dims); let k = 1;
  for (const p of def.params) k *= Math.pow(d[p.key] / p.def, p.exp || 1);
  return k;
}
export function radiusAt(def, dims, y) { // y in [-L/2, L/2]
  const { r, L } = geom(def, dims);
  const t = Math.min(1, Math.max(0, (y + L / 2) / L));
  if (def.model === 'adapter') return r * (1 + (def.topK - 1) * t);
  if (def.model === 'pod') return t < 0.6 ? r : r * (1 - (1 - def.topK) * (t - 0.6) / 0.4);
  if (def.model === 'cone') return r * Math.pow(Math.max(0, 1 - Math.pow(t, 1.6)), 0.6);
  return r;
}
/** Attachment nodes in part-local space. */
export function nodes(def, dims) {
  const { r, L } = geom(def, dims);
  const out = [];
  const topR = r * (def.topK || 1);
  if (def.stack === 'both' || def.stack === 'top') out.push({ id: 'top', p: [0, L / 2, 0], d: [0, 1, 0], r: topR });
  if (def.stack === 'both' || def.stack === 'bottom') out.push({ id: 'bottom', p: [0, -L / 2, 0], d: [0, -1, 0], r });
  return out;
}
export const partMass = (def, dims) => def.mass * massK(def, dims);
export const fuelCapacity = (def, dims) => (def.fuel || 0) * massK(def, dims);
export const solidCapacity = (def, dims) => (def.solid || 0) * massK(def, dims);
export function engineStats(def, dims) {
  const e = def.engine; if (!e) return null; const k = massK(def, dims);
  return { thrust: e.thrust * k, ispSL: e.ispSL, ispVac: e.ispVac, gimbal: e.gimbal, liquid: e.liquid };
}
export const listParts = () => Object.values(PARTS);

/** Thrust application / exhaust geometry for engines (local space). */
export function engineGeom(def, dims) {
  const { r, L } = geom(def, dims);
  if (def.model === 'engine') return { pivotY: L / 2 - 0.38 * L, exitY: -L / 2, exitR: r * def.bellK * 0.85 };
  if (def.model === 'srb') return { pivotY: -L / 2 + r, exitY: -L / 2, exitR: r * 0.78 };
  return { pivotY: 0, exitY: -L / 2, exitR: r };
}
/** For radial parts: distance from the host surface point to the part's local origin along the outward axis. */
export function radialOffset(def, dims) { return def.stack === 'none' ? 0 : geom(def, dims).r; }
