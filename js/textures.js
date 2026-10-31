// Texture loading module: loads the real PNG files from `assets/rocket parts textures/` (and environment textures)
// and keeps a log of every request so tests can verify there are no 404s.
import * as THREE from 'three';

export const PART_TEX_DIR = 'assets/rocket parts textures/';
export const ENV_TEX_DIR = 'assets/environment/';
export const PART_TEXTURES = ['nose_cone', 'rocket_body', 'rocket_body_panels', 'fuel_tank', 'liquid_engine', 'engine_nozzle', 'solid_rocket_booster', 'rocket_fins',
  'structural_connector', 'decoupler', 'landing_legs', 'heat_shield', 'parachute', 'battery', 'control_module', 'rcs_thruster', 'solar_panels', 'docking_port',
  'adapter', 'carbon_fibre', 'insulation_foil', 'hazard_stripes', 'insignia_star', 'insignia_chevron', 'insignia_patch', 'insignia_checker'];
export const ENV_TEXTURES = ['terrain_grass', 'terrain_rock', 'launchpad_concrete', 'smoke_puff', 'flame_glow', 'cloud_puff'];

export class TextureLibrary {
  constructor(renderer) {
    this.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    this.cache = new Map(); this.log = []; this.failed = [];
    this.loader = new THREE.TextureLoader();
  }
  async load(name, dir = PART_TEX_DIR) {
    const url = encodeURI(dir + name + '.png');
    try {
      const tex = await this.loader.loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = this.anisotropy;
      tex.name = name;
      this.cache.set(name, tex); this.log.push({ name, url, ok: true, w: tex.image.width, h: tex.image.height });
      return tex;
    } catch (e) {
      this.failed.push(url); this.log.push({ name, url, ok: false });
      console.warn('texture failed', url);
      return null;
    }
  }
  async loadAll(onProgress) {
    const jobs = [...PART_TEXTURES.map(n => [n, PART_TEX_DIR]), ...ENV_TEXTURES.map(n => [n, ENV_TEX_DIR])];
    let done = 0;
    await Promise.all(jobs.map(async ([n, d]) => { await this.load(n, d); done++; onProgress && onProgress(done / jobs.length, n); }));
    return this;
  }
  get(name) { return this.cache.get(name) || null; }
  /** Image element for 2D-canvas decal use. */
  image(name) { const t = this.cache.get(name); return t ? t.image : null; }
  dispose() { for (const t of this.cache.values()) t.dispose(); this.cache.clear(); }
}
