// Application entry: boots renderer, textures, workshop, flight scene and UI; switches between editor and flight.
import * as THREE from 'three';
import { TextureLibrary } from './textures.js';
import { Design, History } from './design.js';
import { Workshop, renderThumbnails } from './construction.js';
import { Flight, CAMERA_MODES } from './flight.js';
import { FlightControls } from './controls.js';
import { EditorUI, FlightUI, el, toast, modal, closeModal, helpBody } from './ui.js';
import { Store, Progress, exportDesign, readDesignFile } from './storage.js';
import { TEMPLATES, TEMPLATE_NAMES } from './templates.js';
import { defaultSettings } from './physics.js';
import { engineStats } from './registry.js';
import { initAdminBridge } from './adminbridge.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
if (params.has('touch') || matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

const QUALITY = { low: { pr: 1, shadows: false }, medium: { pr: 1.5, shadows: true }, high: { pr: 2, shadows: true } };

const app = {
  isUnlocked: () => Progress.unlocked(), Progress,
  THREE, mode: 'loading', store: Store, templateNames: TEMPLATE_NAMES, engineStats, errors: [],
  settings: Object.assign({ ...defaultSettings(), quality: matchMedia('(pointer: coarse)').matches ? 'medium' : 'high' }, Store.settings() || {}),
};
window.__app = app;
window.addEventListener('error', (e) => app.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => app.errors.push('promise: ' + (e.reason && e.reason.message || e.reason)));

async function boot() {
  const canvas = $('#gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.renderer = renderer;
  const coarse = matchMedia('(pointer: coarse)').matches; const lod = app.settings.quality === 'low' || (coarse && app.settings.quality !== 'high') || params.has('lod');
  const lib = new TextureLibrary(renderer, { lod }); app.lib = lib; app.texLod = lod;
  await lib.loadAll((p, n) => { $('#ldBar').style.width = (p * 100) + '%'; $('#ldText').textContent = 'Loading textures… ' + n; });
  if (lib.failed.length) { app.errors.push('texture load failures: ' + lib.failed.join(', ')); }
  $('#ldText').textContent = 'Building workshop…'; await new Promise(r => setTimeout(r, 20));

  const design = new Design(); const history = new History(design); app.design = design; app.history = history;
  const saved = Store.loadAuto(); let loaded = false;
  if (saved) { try { design.fromJSON(saved); loaded = true; } catch (e) { console.warn('autosave invalid', e); } }
  if (!loaded) design.fromJSON(TEMPLATES[TEMPLATE_NAMES[0]]().toJSON());
  history.init();
  const ws = new Workshop(renderer, canvas, design, history, lib); app.workshop = ws; ws.syncViews(); ws.frame();
  ws.rig.az = 0.75; ws.rig.el = 0.22;
  const thumbs = renderThumbnails(renderer, lib, 96); app.thumbs = thumbs;
  const ui = new EditorUI(app); app.editorUI = ui; ui.setThumbs(thumbs);
  app.flightUI = new FlightUI(app);

  // ---------------------------------------------------------------- app actions
  let saveTimer = null; app.onDesignChanged = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => Store.autosave(design.toJSON()), 400); };
  app.loadTemplate = (name) => { ws.loadDesign(TEMPLATES[name]().toJSON()); toast('Loaded example: ' + name); };
  app.saveCurrent = () => { const name = design.name || 'Untitled Rocket'; if (Store.save(name, design.toJSON())) toast('Saved “' + name + '” in this browser'); else toast('Could not save (storage full or blocked)', true); };
  app.exportCurrent = () => { exportDesign(design.toJSON()); toast('Design exported as JSON file'); };
  app.importFile = async (f) => { try { const j = await readDesignFile(f); ws.loadDesign(j); toast('Imported “' + (j.name || f.name) + '”'); } catch (e) { toast('Import failed: ' + e.message, true); } };
  app.loadSaved = (name) => { const j = Store.load(name); if (j) { ws.loadDesign(j); toast('Opened “' + name + '”'); } };
  app.openSettings = () => openSettings();
  app.applyQuality = () => { const q = QUALITY[app.settings.quality] || QUALITY.medium; const pr = Math.min(window.devicePixelRatio || 1, q.pr); renderer.setPixelRatio(pr); app.resize(); if (app.flight) app.flight.world.sun.castShadow = q.shadows; ws._env.floor.receiveShadow = q.shadows; };
  app.resize = () => { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); ws.resize(w, h); app.flight?.resize(w, h); };

  // ---------------------------------------------------------------- flight
  const ensureFlight = () => {
    if (app.flight) return app.flight;
    const f = new Flight(renderer, lib, canvas); app.flight = f; f.resize(window.innerWidth, window.innerHeight);
    app.controls = new FlightControls(f, $('#flight'), { onCamera: () => f.cycleCamera(), onPause: () => togglePause(), onHelp: () => modal('Help & controls', helpBody()) });
    f.rig.enabled = false; app.applyQuality(); return f;
  };
  const togglePause = () => { const f = app.flight; if (!f || !f.phys) return; if (f.state === 'prelaunch' || f.state === 'countdown') return; f.pause(!f.paused); $('#fPause').textContent = f.paused ? '▶' : '❚❚'; };
  app.launch = () => {
    const issues = design.validate(); const errs = issues.filter(i => i.level === 'error');
    if (errs.length) { toast(errs[0].msg, true); $('#warnings').classList.add('open'); return; }
    const f = ensureFlight(); const copy = new Design().fromJSON(design.toJSON());
    app.flightDesign = copy; app.mode = 'flight'; ws.enabled = false; ws.rig.enabled = false; f.rig.enabled = true;
    $('#editor').classList.add('hidden'); $('#flight').classList.remove('hidden'); $('#fPause').textContent = '❚❚';
    app.applyQuality(); const body = f.loadVehicle(copy, { ...app.settings }); if (!body) { toast('Could not build vehicle', true); app.backToEditor(); return; }
    app.controls.setActive(true); app.controls.axis = { pitch: 0, yaw: 0, roll: 0 };
    f.world.sun.castShadow = (QUALITY[app.settings.quality] || QUALITY.medium).shadows;
    f.msg('Vehicle on the pad. Press Space or Start countdown.');
  };
  app.resetFlight = () => { const f = app.flight; if (!f) return; const cam = f.camMode; f.loadVehicle(new Design().fromJSON(app.flightDesign.toJSON()), { ...app.settings }); f.setCamera(cam === 'cockpit' ? 'chase' : cam); $('#fPause').textContent = '❚❚'; };
  app.backToEditor = () => {
    const f = app.flight; if (f) { f.clearVehicle(); f.rig.enabled = false; } app.controls?.setActive(false); app.mode = 'editor'; ws.enabled = true; ws.rig.enabled = true;
    $('#flight').classList.add('hidden'); $('#editor').classList.remove('hidden'); app.resize();
  };
  $('#fBack').onclick = () => app.backToEditor(); $('#fReset').onclick = () => app.resetFlight(); $('#fPause').onclick = () => togglePause(); $('#fCam').onclick = () => app.flight.cycleCamera(); $('#fHelp').onclick = () => modal('Help & controls', helpBody());

  function openSettings() {
    const s = app.settings; const body = el('div'); const rows = [];
    const slider = (key, label, min, max, step, unit = '') => { const out = el('span', { class: 'val', text: (+s[key]).toFixed(step < 1 ? 2 : 0) + unit }); const r = el('input', { type: 'range', min, max, step, value: s[key] }); r.oninput = () => { s[key] = +r.value; out.textContent = (+r.value).toFixed(step < 1 ? 2 : 0) + unit; Store.saveSettings(s); }; r.dataset.key = key; return el('div', { class: 'row' }, el('label', { text: label, style: 'width:130px' }), r, out); };
    const presets = { Earth: { g0: 9.81, atmosphere: 1, scaleHeight: 7500, wind: 0 }, Moon: { g0: 1.62, atmosphere: 0, scaleHeight: 7500, wind: 0 }, Mars: { g0: 3.71, atmosphere: 0.015, scaleHeight: 11000, wind: 0 }, 'Heavy world': { g0: 20, atmosphere: 2, scaleHeight: 6000, wind: 0 }, 'No atmosphere': { g0: 9.81, atmosphere: 0, scaleHeight: 7500, wind: 0 } };
    const render = () => { body.replaceChildren(el('div', { class: 'sec', text: 'Sandbox presets' }), el('div', { class: 'btnrow' }, ...Object.entries(presets).map(([n, p]) => el('button', { text: n, onclick: () => { Object.assign(s, p); Store.saveSettings(s); render(); } }))),
      el('div', { class: 'sec', text: 'Physics' }), slider('g0', 'Surface gravity (m/s²)', 0, 25, 0.1), slider('atmosphere', 'Atmosphere density ×', 0, 3, 0.05), slider('scaleHeight', 'Scale height (m)', 2000, 20000, 250), slider('wind', 'Wind (m/s)', 0, 40, 1), slider('timeScale', 'Time scale ×', 0.25, 3, 0.25),
      el('div', { class: 'sec', text: 'Graphics' }), el('div', { class: 'row' }, el('label', { text: 'Quality', style: 'width:130px' }), el('select', { onchange: (e) => { s.quality = e.target.value; Store.saveSettings(s); app.applyQuality(); } }, ...Object.keys(QUALITY).map(k => el('option', { value: k, text: k, selected: s.quality === k })))),
      el('p', { class: 'hint', text: 'Settings apply to the next launch / reset. They are stored in this browser.' })); };
    render(); modal('Sandbox settings', body);
  }

  // ---------------------------------------------------------------- progression (advanced parts unlock at 3 km)
  let progT = 0; const trackProgress = () => {
    const f = app.flight; if (!f || !f.phys || f.state !== 'flying' || !f.phys.active) return; if (performance.now() - progT < 500) return; progT = performance.now();
    const alt = f.phys.active.pos.y; const was = Progress.unlocked();
    Progress.update((p) => { if (alt > p.maxAlt) p.maxAlt = alt; });
    if (!was && Progress.unlocked()) { toast('🔓 Unlocked advanced parts: stainless tanks, engine clusters, grid fins, flaps, capsule, fairing…'); app.editorUI?.renderList(); }
  };
  // ---------------------------------------------------------------- loop
  let last = performance.now();
  const loop = (now) => {
    requestAnimationFrame(loop); const dt = Math.min(0.1, (now - last) / 1000); last = now; app.fpsTick && app.fpsTick();
    try {
      if (app.mode === 'flight' && app.flight) {
        app.controls.update(dt); const t0 = performance.now(); app.flight.update(dt, window.innerWidth, window.innerHeight); app.flight.render(); app.flightUI.update(dt); app.flight.perf.frameMs = performance.now() - t0; trackProgress();
      } else if (app.mode === 'editor') ws.render();
    } catch (e) { if (!app.loopError) { app.loopError = e; console.error('loop error', e); app.errors.push('loop: ' + e.message + '\n' + e.stack); } }
  };
  window.addEventListener('resize', app.resize); window.addEventListener('orientationchange', () => setTimeout(app.resize, 200));
  document.addEventListener('visibilitychange', () => { if (document.hidden && app.mode === 'flight' && app.flight?.state === 'flying' && !app.flight.paused) togglePause(); });
  // block browser pinch/scroll gestures on the game surface
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  app.admin = initAdminBridge(app);
  app.applyQuality(); app.mode = 'editor'; ws.enabled = true; app.resize();
  $('#loading').remove(); requestAnimationFrame(loop);
  if (params.has('autolaunch')) app.launch();
  app.ready = true;
}
boot().catch((e) => { console.error(e); app.errors.push('boot: ' + e.message + '\n' + e.stack); const t = document.getElementById('ldText'); if (t) t.textContent = 'Failed to start: ' + e.message; });
