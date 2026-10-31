// DOM user interface: workshop panels (inventory, properties, paint, hierarchy, staging, validation) and flight HUD.
import { PARTS, CATEGORIES, finishes, surfacePresets, insignias, colorSchemes, partMass, fuelCapacity, solidCapacity } from './registry.js';

export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const $ = (s, r = document) => r.querySelector(s);
const fmt = (x, d = 0) => Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
export const fmtMass = (kg) => kg >= 10000 ? fmt(kg / 1000, 1) + ' t' : fmt(kg, 0) + ' kg';
const fmtDist = (m) => Math.abs(m) >= 100000 ? fmt(m / 1000, 1) + ' km' : Math.abs(m) >= 10000 ? fmt(m / 1000, 2) + ' km' : fmt(m, 0) + ' m';

export function toast(msg, bad = false) { const t = $('#toast'); const d = el('div', { class: bad ? 'bad' : '', text: msg }); t.append(d); setTimeout(() => d.remove(), 3300); }
export function modal(title, body, onClose) {
  const m = $('#modal'); $('#modalTitle').textContent = title; const b = $('#modalBody'); b.replaceChildren(...(Array.isArray(body) ? body : [body])); m.classList.remove('hidden');
  const close = () => { m.classList.add('hidden'); onClose && onClose(); }; $('#modalClose').onclick = close; m.onclick = (e) => { if (e.target === m) close(); }; return close;
}
export const closeModal = () => $('#modal').classList.add('hidden');

export function helpBody() {
  const k = (...a) => a.map(x => el('kbd', { text: x })).flatMap((x, i) => i ? [' + ', x] : [x]);
  const row = (keys, d) => el('tr', {}, el('td', {}, ...keys), el('td', { text: d }));
  return [el('h3', { text: 'Workshop' }), el('table', {},
    row([el('kbd', { text: 'Drag' })], 'from the Parts list into the viewport; drop near a green node to snap (it highlights).'), row(k('Click'), 'select a part; drag a selected part to move it (it re-snaps when dropped near nodes).'),
    row(k('Right-drag / Shift-drag'), 'pan; left-drag on empty space orbits; wheel zooms (touch: 1 finger orbit, 2 fingers pan/zoom).'),
    row(k('Del'), 'delete'), row(k('Ctrl', 'D'), 'duplicate'), row(k('Ctrl', 'Z'), 'undo'), row(k('Ctrl', 'Y'), 'redo'), row(k('F'), 'frame rocket'), row(k('N'), 'toggle attachment nodes')),
  el('h3', { text: 'Flight' }), el('table', {},
    row(k('W', 'S'), 'pitch'), row(k('A', 'D'), 'yaw'), row(k('Q', 'E'), 'roll'), row(k('Shift'), 'throttle up (also ↑)'), row(k('Ctrl'), 'throttle down (also ↓)'), row(k('Z'), 'full throttle'), row(k('X'), 'cut throttle'),
    row(k('Space'), 'launch countdown, then next stage'), row(k('P'), 'deploy parachutes'), row(k('T'), 'SAS attitude hold'), row(k('R'), 'RCS'), row(k('M'), 'engines on/off'), row(k('G'), 'landing legs'), row(k('C'), 'camera: chase / cockpit / free'), row(k('Esc'), 'pause')),
  el('p', { class: 'hint', text: 'Pitch/yaw/roll are relative to the camera in chase and free views (W = nose away from you). On phones use the joystick (pitch/yaw), ⟲ ⟳ (roll), the throttle slider and the STAGE button.' })];
}

// =====================================================================================================================
export class EditorUI {
  constructor(app) {
    this.app = app; this.ws = app.workshop; this.design = app.design; this.thumbs = app.thumbs || {}; this.cat = 'all'; this.query = ''; this.busy = false; this.tab = 'props'; this.dirty = true;
    this.buildInventory(); this.bindTop(); this.bindToolbar(); this.bindTabs();
    this.ws.on('select', () => { this.refresh(); }); this.ws.on('change', () => { if (!this.busy) this.refresh(); else this.refreshLight(); });
    this.ws.on('status', (m) => { $('#statusMsg').textContent = m; }); this.refresh();
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $('#' + b.dataset.close).classList.remove('open'));
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const t = $('#' + b.dataset.open); const was = t.classList.contains('open'); ['inventory', 'side', 'warnings'].forEach(i => $('#' + i).classList.remove('open')); if (!was) t.classList.add('open'); });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }
  onKey(e) {
    if (this.app.mode !== 'editor' || e.target.closest('input,select,textarea') || !$('#modal').classList.contains('hidden')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Backspace') { this.ws.deleteSelected(e.shiftKey); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'z') { e.shiftKey ? this.redo() : this.undo(); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'y') { this.redo(); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'd') { this.ws.duplicateSelected(); e.preventDefault(); }
    else if (!ctrl && e.key.toLowerCase() === 'f') this.ws.frame(); else if (!ctrl && e.key.toLowerCase() === 'n') this.ws.toggleNodes();
  }
  undo() { if (this.app.history.undo()) this.afterHistory(); } redo() { if (this.app.history.redo()) this.afterHistory(); }
  afterHistory() { if (this.ws.selected && !this.design.get(this.ws.selected)) this.ws.selected = null; this.ws.syncViews(); this.ws.refreshHighlights(); this.ws.emit('select', this.ws.selected); this.ws.emit('change'); }

  // ------------------------------------------------------------ inventory
  buildInventory() {
    const tabs = $('#catTabs'); tabs.replaceChildren(el('button', { class: 'on', 'data-c': 'all', text: 'All' }), ...CATEGORIES.map(c => el('button', { 'data-c': c.id, title: c.name, text: c.icon + ' ' + c.name.split(' ')[0] })));
    tabs.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; this.cat = b.dataset.c; tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); this.renderList(); };
    $('#partSearch').oninput = (e) => { this.query = e.target.value.trim().toLowerCase(); this.renderList(); };
    this.renderList();
  }
  setThumbs(t) { this.thumbs = t; this.renderList(); }
  renderList() {
    const list = $('#partList'); const kids = [];
    for (const cat of CATEGORIES) {
      if (this.cat !== 'all' && this.cat !== cat.id) continue;
      const parts = Object.values(PARTS).filter(p => p.category === cat.id && (!this.query || (p.name + ' ' + p.desc + ' ' + p.id).toLowerCase().includes(this.query)));
      if (!parts.length) continue; kids.push(el('div', { class: 'catHead', text: cat.icon + ' ' + cat.name }));
      for (const p of parts) kids.push(this.card(p));
    }
    if (!kids.length) kids.push(el('div', { class: 'hint', text: 'No parts match.' })); list.replaceChildren(...kids);
  }
  card(def) {
    const c = el('div', { class: 'card', 'data-type': def.id, title: def.desc }, el('img', { src: this.thumbs[def.id] || '', alt: '' }), el('div', {}, el('div', { class: 'nm', text: def.name }), el('div', { class: 'ds', text: def.desc.length > 60 ? def.desc.slice(0, 58) + '…' : def.desc })));
    let st = null;
    c.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; st = { x: e.clientX, y: e.clientY, t: e.pointerType, started: false }; });
    c.addEventListener('pointermove', (e) => {
      if (!st || st.started) return; const dx = e.clientX - st.x, dy = e.clientY - st.y; const m = Math.hypot(dx, dy);
      const go = st.t === 'mouse' ? m > 5 : (m > 14 && Math.abs(dy) > Math.abs(dx) * 1.2 && e.clientY < c.getBoundingClientRect().top - 6 || m > 40);
      if (go && this.app.mode === 'editor') { st.started = true; this.closeDrawers(); this.ws.startInventoryDrag(def.id, e); }
    });
    c.addEventListener('pointerup', () => { if (st && !st.started && this.app.mode === 'editor') { this.ws.quickAdd(def.id); if (st.t !== 'mouse') this.closeDrawers(); } st = null; });
    c.addEventListener('pointercancel', () => { st = null; });
    return c;
  }
  closeDrawers() { ['inventory', 'side', 'warnings'].forEach(i => $('#' + i).classList.remove('open')); }

  // ------------------------------------------------------------ top bar & toolbar
  bindTop() {
    const a = this.app; const nm = $('#rocketName'), id = $('#rocketId');
    nm.onchange = () => { this.design.name = nm.value || 'Untitled Rocket'; a.history.commit(); this.ws.syncViews(); this.refresh(); }; id.onchange = () => { this.design.idCode = id.value || 'RW-001'; a.history.commit(); this.ws.syncViews(); this.refresh(); };
    $('#bUndo').onclick = () => this.undo(); $('#bRedo').onclick = () => this.redo();
    const sel = $('#selTemplate'); a.templateNames.forEach(n => sel.append(el('option', { value: n, text: n })));
    sel.onchange = () => { if (sel.value) a.loadTemplate(sel.value); sel.value = ''; };
    $('#bNew').onclick = () => { if (!this.design.parts.size || confirm('Discard the current design and start a new empty one?')) { this.ws.clearAll(); this.design.name = 'Untitled Rocket'; this.ws.frame(); toast('New design'); } };
    $('#bSave').onclick = () => { a.saveCurrent(); }; $('#bLoad').onclick = () => this.openSaves();
    $('#bExport').onclick = () => a.exportCurrent(); $('#bImport').onclick = () => $('#fileImport').click();
    $('#fileImport').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) a.importFile(f); };
    $('#bSettings').onclick = () => a.openSettings(); $('#bHelp').onclick = () => modal('Help & controls', helpBody()); $('#bLaunch').onclick = () => a.launch();
  }
  openSaves() {
    const list = this.app.store.list(); const body = el('div');
    const render = () => { const l = this.app.store.list(); body.replaceChildren(...(l.length ? l.map(s => el('div', { class: 'sv' }, el('span', {}, s.name, ' ', el('small', { text: `${s.parts} parts · ${new Date(s.saved).toLocaleString()}` })), el('button', { text: 'Open', onclick: () => { this.app.loadSaved(s.name); closeModal(); } }), el('button', { text: '✕', title: 'Delete', onclick: () => { if (confirm('Delete "' + s.name + '"?')) { this.app.store.remove(s.name); render(); } } }))) : [el('div', { class: 'hint', text: 'No saved designs yet. Use Save to store the current rocket in this browser, or Export to download a file.' })])); };
    render(); modal('Saved designs', body);
  }
  bindToolbar() {
    const ws = this.ws;
    $('#toolbar').onclick = (e) => { const b = e.target.closest('button[data-act]'); if (!b) return; ({ rotX: () => ws.rotateSelected('x', 90), rotY: () => ws.rotateSelected('y', 90), rotZ: () => ws.rotateSelected('z', 90), dup: () => ws.duplicateSelected(), del: () => ws.deleteSelected(), detach: () => ws.detachSelected(), attach: () => ws.attachSelected(), nodes: () => { const on = ws.toggleNodes(); b.classList.toggle('on', on); }, frame: () => ws.frame() })[b.dataset.act](); };
    $('[data-act=nodes]').classList.add('on'); const sym = $('#selSym'); sym.onchange = () => { this.design.settings.symmetry = +sym.value; ws.status('Symmetry ×' + sym.value + ' for radial parts'); };
  }
  bindTabs() { $('#sideTabs').onclick = (e) => { const b = e.target.closest('button[data-tab]'); if (!b) return; this.tab = b.dataset.tab; this.showTab(); this.refresh(); }; }
  showTab() { document.querySelectorAll('#sideTabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab)); for (const t of ['props', 'paint', 'tree', 'stage']) $('#tab-' + t).classList.toggle('hidden', t !== this.tab); }

  // ------------------------------------------------------------ refresh
  refreshLight() { this.renderStats(); }
  refresh() {
    const d = this.design; const nm = $('#rocketName'), id = $('#rocketId'); if (document.activeElement !== nm) nm.value = d.name; if (document.activeElement !== id) id.value = d.idCode;
    $('#selSym').value = String(d.settings.symmetry || 1); $('#bUndo').disabled = !this.app.history.canUndo; $('#bRedo').disabled = !this.app.history.canRedo;
    this.showTab(); this.renderStats(); this.renderWarnings();
    if (this.tab === 'props') this.renderProps(); else if (this.tab === 'paint') this.renderPaint(); else if (this.tab === 'tree') this.renderTree(); else this.renderStaging();
    this.app.onDesignChanged?.();
  }
  renderStats() {
    const d = this.design; const s = d.stats(); const st = d.stability(); const sb = $('#statsbar');
    let stab = '–'; let cls = '';
    if (st && st.cop) { const m = st.marginFull, me = st.marginEmpty; stab = `${m.toFixed(1)} / ${me.toFixed(1)} cal`; cls = m < 0 ? 'bad' : me < 0 ? 'wn' : 'ok'; } else if (d.parts.size) { stab = 'no fins'; cls = 'wn'; }
    sb.replaceChildren(el('span', { html: `Parts <b>${s.parts}</b>` }), el('span', { html: `Dry <b>${fmtMass(s.dry)}</b>` }), el('span', { html: `Fuel <b>${fmtMass(s.fuel)}</b>` }), el('span', { html: `Wet <b>${fmtMass(s.wet)}</b>` }),
      el('span', { html: `TWR <b class="${s.twr < 1 && s.thrustAll > 0 ? 'bad' : ''}">${s.twr.toFixed(2)}</b>` }), el('span', { html: `Thrust <b>${fmt(s.thrust0 / 1000, 0)} kN</b>` }), el('span', { html: `Stability <b class="${cls}">${stab}</b>` }));
  }
  renderWarnings() {
    const w = $('#warnings'); const items = this.design.validate(); const icons = { error: '⛔', warn: '⚠️', ok: '✅', info: 'ℹ️' };
    w.replaceChildren(...items.map(it => el('div', { class: 'w ' + it.level, onclick: () => { if (it.ids?.length) this.ws.select(it.ids[0]); } }, el('i', { text: icons[it.level] }), el('span', { text: it.msg }))));
    const bad = items.filter(i => i.level === 'error' || i.level === 'warn').length; const btn = $('[data-open=warnings]'); if (btn) btn.textContent = bad ? `⚠ ${bad}` : '✅';
    this.validation = items;
  }
  sel() { return this.ws.selected ? this.design.get(this.ws.selected) : null; }

  // ------------------------------------------------------------ properties
  renderProps() {
    const body = $('#tab-props'); const p = this.sel();
    if (!p) { body.replaceChildren(el('div', { class: 'hint', text: 'Select a part in the viewport (or the hierarchy) to edit it. Drag parts from the list on the left. Radial parts (fins, boosters, legs) snap to the sides of tanks and bodies.' }), el('div', { class: 'sec', text: 'Rocket' }), this.kv('Parts', this.design.parts.size), this.kv('Main assembly root', this.design.rootId ? PARTS[this.design.get(this.design.rootId).type].name : '–')); return; }
    const def = PARTS[p.type]; const ws = this.ws; const kids = [];
    kids.push(el('div', { class: 'sec', text: def.name }), el('div', { class: 'hint', text: def.desc }));
    kids.push(el('div', { class: 'row' }, el('label', { text: 'Label' }), el('input', { type: 'text', value: p.label || '', placeholder: def.name, onchange: (e) => { p.label = e.target.value; this.app.history.commit(); this.refresh(); } })));
    // dimensions
    if (def.params.length) kids.push(el('div', { class: 'sec', text: 'Dimensions' }));
    for (const pr of def.params) {
      const v = p.dims[pr.key]; const out = el('span', { class: 'val', text: (+v).toFixed(2) });
      const r = el('input', { type: 'range', min: pr.min, max: pr.max, step: pr.step, value: v });
      r.addEventListener('input', () => { this.busy = true; out.textContent = (+r.value).toFixed(2); ws.setDim(pr.key, +r.value, false); });
      r.addEventListener('change', () => { ws.setDim(pr.key, +r.value, true); this.busy = false; this.refresh(); });
      kids.push(el('div', { class: 'row' }, el('label', { text: pr.label }), r, out));
    }
    // transform
    kids.push(el('div', { class: 'sec', text: 'Transform' }));
    const q = new this.app.THREE.Quaternion(...p.quat); const eu = new this.app.THREE.Euler().setFromQuaternion(q, 'YXZ');
    const num = (val, step, fn) => el('input', { type: 'number', step, value: (+val).toFixed(2), onchange: (e) => fn(parseFloat(e.target.value)) });
    kids.push(el('div', { class: 'row' }, el('label', { text: 'Position' }), ...[0, 1, 2].map(i => num(p.pos[i], 0.1, (v) => ws.setPosition(i, v)))));
    kids.push(el('div', { class: 'row' }, el('label', { text: 'Rotation °' }), ...[eu.x, eu.y, eu.z].map((v, i) => num(v * 180 / Math.PI, 5, (val) => ws.setEuler(i, val)))));
    kids.push(el('div', { class: 'hint', text: 'Editing position/rotation detaches the part from its parent (use Attach to snap it back).' }));
    const lk = this.design.parentLink(p.id); kids.push(this.kv('Attached', lk ? PARTS[this.design.get(lk.parent).type].name + (lk.radial ? ' (radial)' : '') : (p.id === this.design.rootId ? 'root' : 'no')));
    kids.push(el('div', { class: 'btnrow' }, el('button', { text: '⟳ Rot X', onclick: () => ws.rotateSelected('x', 90) }), el('button', { text: '⟳ Rot Y', onclick: () => ws.rotateSelected('y', 45) }), el('button', { text: '⟳ Rot Z', onclick: () => ws.rotateSelected('z', 90) }),
      el('button', { text: 'Duplicate', onclick: () => ws.duplicateSelected() }), el('button', { text: 'Delete', onclick: () => ws.deleteSelected() }), el('button', { text: 'Detach', onclick: () => ws.detachSelected() }), el('button', { text: 'Attach', onclick: () => ws.attachSelected() }),
      el('button', { text: 'Set as flight root', title: 'The part that defines the vehicle: everything connected to it flies', onclick: () => { this.design.setRoot(p.id); this.app.history.commit(); this.refresh(); } })));
    // config
    const cfg = []; const mk = (key, label, min, max, step, unit = '%', scale = 100, def0 = 1) => { const v = p.config[key] ?? def0; const out = el('span', { class: 'val', text: Math.round(v * scale) + unit }); const r = el('input', { type: 'range', min, max, step, value: v });
      r.addEventListener('input', () => { this.busy = true; out.textContent = Math.round(r.value * scale) + unit; ws.setConfig({ [key]: +r.value }, false); }); r.addEventListener('change', () => { ws.setConfig({ [key]: +r.value }, true); this.busy = false; this.refresh(); }); cfg.push(el('div', { class: 'row' }, el('label', { text: label }), r, out)); };
    if (def.fuel || def.solid || (def.engine && !def.engine.liquid)) mk('fill', def.fuel ? 'Fuel fill' : 'Propellant', 0, 1, 0.01);
    if (def.engine) { mk('thrustLimit', 'Thrust limit', 0.1, 1, 0.01); cfg.push(el('div', { class: 'row' }, el('label', { text: 'Gimbal' }), el('input', { type: 'checkbox', checked: p.config.gimbal !== false, onchange: (e) => ws.setConfig({ gimbal: e.target.checked }) }))); }
    if (def.radialSep) cfg.push(el('div', { class: 'row' }, el('label', { text: 'Separates' }), el('input', { type: 'checkbox', checked: !!p.config.sep, onchange: (e) => ws.setConfig({ sep: e.target.checked }) }), el('span', { class: 'hint', text: 'booster drops away at its stage' })));
    if (cfg.length) kids.push(el('div', { class: 'sec', text: 'Engine / fuel configuration' }), ...cfg);
    // info
    kids.push(el('div', { class: 'sec', text: 'Specs' }), this.kv('Dry mass', fmtMass(partMass(def, p.dims))));
    const f = fuelCapacity(def, p.dims) + solidCapacity(def, p.dims); if (f) kids.push(this.kv('Propellant capacity', fmtMass(f)));
    if (def.engine) { const es = this.app.engineStats(def, p.dims); kids.push(this.kv('Thrust (vac)', fmt(es.thrust / 1000, 0) + ' kN'), this.kv('Isp (SL / vac)', `${es.ispSL.toFixed(0)} / ${es.ispVac.toFixed(0)} s`), this.kv('Burn rate', (es.thrust / (es.ispSL * 9.80665)).toFixed(1) + ' kg/s')); }
    kids.push(this.kv('Stage', p.stage >= 0 ? 'ignite/deploy at ' + (p.stage + 1) : '–'));
    body.replaceChildren(...kids);
  }
  kv(k, v) { return el('div', { class: 'kv' }, el('span', { text: k }), el('b', { text: String(v) })); }

  // ------------------------------------------------------------ paint
  renderPaint() {
    const body = $('#tab-paint'); const p = this.sel(); const ws = this.ws; const kids = []; const d = this.design;
    kids.push(el('div', { class: 'sec', text: 'Rocket identity' }),
      el('div', { class: 'row' }, el('label', { text: 'Name' }), el('input', { type: 'text', value: d.name, onchange: (e) => { d.name = e.target.value; this.app.history.commit(); ws.syncViews(); this.refresh(); } })),
      el('div', { class: 'row' }, el('label', { text: 'ID' }), el('input', { type: 'text', value: d.idCode, onchange: (e) => { d.idCode = e.target.value; this.app.history.commit(); ws.syncViews(); this.refresh(); } })));
    kids.push(el('div', { class: 'sec', text: 'Colour schemes (whole rocket)' }), el('div', { class: 'btnrow' }, ...Object.keys(colorSchemes).map(n => el('button', { text: n, onclick: () => ws.applyScheme(n) }))));
    kids.push(el('div', { class: 'row' }, el('label', { text: 'Heat damage (all)' }), el('input', { type: 'checkbox', checked: [...d.parts.values()].some(x => x.appearance.heatDamage), onchange: (e) => ws.setHeatDamageAll(e.target.checked) })));
    if (!p) { kids.push(el('div', { class: 'hint', text: 'Select a part to paint it individually. Every part has its own cloned material, so changes never leak to other parts.' })); body.replaceChildren(...kids); return; }
    const a = p.appearance; const def = PARTS[p.type]; const scope = el('select', {}, el('option', { value: 'one', text: 'Selected part only' }), el('option', { value: 'type', text: 'All parts of this type' }), el('option', { value: 'all', text: 'All parts' }));
    const ids = () => scope.value === 'one' ? null : d.all().filter(x => scope.value === 'all' || x.type === p.type).map(x => x.id);
    const set = (patch, commit = true) => ws.setAppearance(patch, ids(), commit);
    kids.push(el('div', { class: 'sec', text: 'Paint: ' + def.name }), el('div', { class: 'row' }, el('label', { text: 'Apply to' }), scope));
    const col = el('input', { type: 'color', value: a.color }); col.addEventListener('input', () => { this.busy = true; set({ color: col.value }, false); }); col.addEventListener('change', () => { set({ color: col.value }); this.busy = false; this.refresh(); });
    kids.push(el('div', { class: 'row' }, el('label', { text: 'Paint colour' }), col));
    kids.push(el('div', { class: 'row' }, el('label', { text: 'Surface' }), el('select', { onchange: (e) => { const s = surfacePresets[e.target.value]; if (s) set({ metalness: s.metalness, roughness: s.roughness }); else set({ metalness: null, roughness: null }); } }, el('option', { value: '', text: 'Default (part)' }), ...Object.entries(surfacePresets).map(([k, v]) => el('option', { value: k, text: v.name })))));
    const sl = (key, label) => { const v = a[key] ?? 0.5; const out = el('span', { class: 'val', text: (+v).toFixed(2) }); const r = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: v }); r.addEventListener('input', () => { this.busy = true; out.textContent = (+r.value).toFixed(2); set({ [key]: +r.value }, false); }); r.addEventListener('change', () => { set({ [key]: +r.value }); this.busy = false; this.refresh(); }); return el('div', { class: 'row' }, el('label', { text: label }), r, out); };
    kids.push(sl('metalness', 'Metalness'), sl('roughness', 'Roughness'));
    kids.push(el('div', { class: 'row' }, el('label', { text: 'Finish' }), el('select', { onchange: (e) => set({ finish: e.target.value }) }, ...Object.entries(finishes).map(([k, v]) => el('option', { value: k, text: v.name, selected: a.finish === k })))));
    if (def.decal) {
      const chk = (key, label) => el('div', { class: 'row' }, el('label', { text: label }), el('input', { type: 'checkbox', checked: !!a[key], onchange: (e) => set({ [key]: e.target.checked }) }));
      kids.push(el('div', { class: 'sec', text: 'Markings' }), chk('markName', 'Rocket name'), chk('markId', 'Rocket ID'), chk('stripe', 'Stripe band'));
      const sc = el('input', { type: 'color', value: a.stripeColor || '#c8342f' }); sc.addEventListener('change', () => set({ stripeColor: sc.value })); kids.push(el('div', { class: 'row' }, el('label', { text: 'Stripe colour' }), sc));
      kids.push(el('div', { class: 'row' }, el('label', { text: 'Flag / insignia' }), el('select', { onchange: (e) => set({ insignia: e.target.value }) }, ...Object.keys(insignias).map(k => el('option', { value: k, text: k, selected: a.insignia === k })))));
    }
    kids.push(el('div', { class: 'row' }, el('label', { text: 'Heat damage' }), el('input', { type: 'checkbox', checked: !!a.heatDamage, onchange: (e) => set({ heatDamage: e.target.checked }) })));
    body.replaceChildren(...kids);
  }

  // ------------------------------------------------------------ hierarchy
  renderTree() {
    const body = $('#tab-tree'); const d = this.design; const main = new Set(d.vehicle().ids); const kids = []; const tree = el('div', { class: 'tree' });
    const roots = d.all().filter(p => !d.parentLink(p.id)); roots.sort((a, b) => (b.id === d.rootId) - (a.id === d.rootId) || (main.has(b.id) - main.has(a.id)));
    const add = (id, depth) => {
      const p = d.get(id); const def = PARTS[p.type]; const lk = d.parentLink(id);
      const row = el('div', { class: 'n' + (this.ws.selected === id ? ' sel' : ''), style: `padding-left:${4 + depth * 14}px`, onclick: () => this.ws.select(id) },
        el('span', { class: main.has(id) ? '' : 'dim', text: (depth ? (lk?.radial ? '⤷ ' : '└ ') : '') + (p.label || def.name) }), id === d.vehicle().root ? el('span', { class: 'main', text: '★' }) : null,
        el('span', { class: 'tag', text: p.stage >= 0 ? 'S' + (p.stage + 1) : '' }), main.has(id) ? null : el('span', { class: 'tag', text: 'loose' }));
      tree.append(row); for (const c of d.childrenOf(id)) add(c, depth + 1);
    };
    for (const r of roots) add(r.id, 0);
    if (!roots.length) tree.append(el('div', { class: 'hint', text: 'Empty. Add parts from the inventory.' }));
    kids.push(el('div', { class: 'hint', text: '★ = flight root. "loose" parts are not connected to the flying assembly. Click to select.' }), tree); body.replaceChildren(...kids);
  }

  // ------------------------------------------------------------ staging
  renderStaging() {
    const body = $('#tab-stage'); const d = this.design; const items = d.stageItems(); const n = Math.max(d.stageCount(), 0) + 1; const kids = [];
    kids.push(el('div', { class: 'hint', text: 'Stage 1 fires first (Space in flight). Assign each engine, decoupler, separator booster and parachute to a stage.' }));
    kids.push(el('div', { class: 'btnrow' }, el('button', { text: 'Auto-assign stages', onclick: () => { d.autoStage(); this.app.history.commit(); this.ws.syncViews(); this.ws.emit('change'); toast('Stages assigned automatically'); } }),
      el('label', { class: 'row' }, el('input', { type: 'checkbox', checked: !!d.settings.autoStage, onchange: (e) => { d.settings.autoStage = e.target.checked; this.app.history.commit(); } }), ' Auto-stage in flight (when burning engines flame out)')));
    const groups = []; for (let i = -1; i < n; i++) groups.push({ i, items: items.filter(it => it.stage === i) });
    for (const g of groups) {
      if (g.i === -1 && !g.items.length) continue; if (g.i >= 0 && g.i === n - 1 && !g.items.length && g.i > 0) { /* spare empty stage still shown */ }
      const box = el('div', { class: 'stg' }, el('h4', {}, el('span', { text: g.i < 0 ? 'Unstaged' : 'Stage ' + (g.i + 1) + (g.i === 0 ? ' (launch)' : '') }), el('span', { class: 'dim', text: g.items.length + ' action(s)' })));
      for (const it of g.items) {
        const p = d.get(it.id); const def = PARTS[p.type]; const verb = { ignite: '🔥 Ignite', separate: '✂ Separate', deploy: '🪂 Deploy' }[it.action];
        const s = el('select', { onchange: (e) => { d.setItemStage(it.id, it.action, +e.target.value); this.app.history.commit(); this.ws.emit('change'); } }, el('option', { value: -1, text: 'None', selected: g.i === -1 }), ...Array.from({ length: n + 1 }, (_, k) => el('option', { value: k, text: 'Stage ' + (k + 1), selected: k === g.i })));
        box.append(el('div', { class: 'it' }, el('span', { text: `${verb} ${p.label || def.name}`, style: 'cursor:pointer', onclick: () => this.ws.select(it.id) }), s));
      }
      if (!g.items.length) box.append(el('div', { class: 'it hint', text: 'empty' })); kids.push(box);
    }
    body.replaceChildren(...kids);
  }
}

// =====================================================================================================================
export class FlightUI {
  constructor(app) { this.app = app; this.t = 0; this.stageKey = ''; this.lastMsgKey = ''; }
  hudRow(k, v, x = false) { return `<div class="r${x ? ' x' : ''}"><span>${k}</span><b>${v}</b></div>`; }
  update(dt) {
    const f = this.app.flight; const phys = f.phys; if (!phys) return; this.t += dt; if (this.t < 0.066) return; this.t = 0;
    const tel = phys.telemetry(); if (!tel) return; const root = $('#flight');
    root.classList.toggle('cockpit', f.camMode === 'cockpit'); $('#camName').textContent = f.camMode;
    const cd = $('#countdown'); cd.textContent = f.state === 'countdown' ? (f.count > 0.05 ? Math.ceil(f.count) : 'T-0') : '';
    // messages
    const key = f.messages.map(m => m.t).join(','); if (key !== this.lastMsgKey) { this.lastMsgKey = key; }
    const now = performance.now(); const box = $('#messages'); const vis = f.messages.filter(m => now - m.t < 5000); box.replaceChildren(...vis.map(m => el('div', { class: m.kind, text: m.text })));
    $('#pausedBanner').classList.toggle('hidden', !f.paused);
    // pitch / heading
    const b = phys.active; const up = new f.camera.position.constructor(0, 1, 0).applyQuaternion(b.q); const pitch = Math.asin(Math.max(-1, Math.min(1, up.y))) * 180 / Math.PI; const hdg = ((Math.atan2(up.x, -up.z) * 180 / Math.PI) + 360) % 360;
    const fuelF = (tel.liquidCap + tel.solidCap) > 0 ? (tel.liquid + tel.solid) / (tel.liquidCap + tel.solidCap) : 0;
    const engs = tel.engines.map(e => `<i class="${e.thrust > 1 ? 'on' : e.burnedOut || (e.starved && e.ignited) ? 'dead' : e.ignited && !e.on ? 'off' : 'rdy'}" title="${e.name}">${e.name.split(' ')[0].slice(0, 7)} ${e.thrust > 1 ? Math.round(e.thrust / 1000) + 'kN' : e.burnedOut ? 'burnt out' : e.starved && e.ignited ? 'no fuel' : e.ignited ? (e.on ? 'idle' : 'off') : 'ready'}</i>`).join('');
    $('#hud').innerHTML = `<div class="big">${fmtDist(tel.altitude)}</div>` + this.hudRow('Radar alt', fmtDist(tel.radar)) + this.hudRow('Speed', fmt(tel.speed, 1) + ' m/s') + this.hudRow('Vertical', fmt(tel.vspeed, 1) + ' m/s') + this.hudRow('Horizontal', fmt(tel.hspeed, 1) + ' m/s', true) +
      this.hudRow('Accel', fmt(tel.accelG, 2) + ' g') + this.hudRow('Mass', fmtMass(tel.mass)) + this.hudRow('Thrust', fmt(tel.thrust / 1000, 0) + ' kN') + this.hudRow('TWR', fmt(tel.twrNow, 2) + ' / ' + fmt(tel.twr, 2)) +
      this.hudRow('Fuel', fmt(fuelF * 100, 0) + '% · ' + fmtMass(tel.liquid + tel.solid)) + `<div class="gauge"><div style="width:${fuelF * 100}%"></div></div>` + (tel.ecCap > 0 ? this.hudRow('Electric', fmt(tel.ec, 0) + '/' + fmt(tel.ecCap, 0), true) + `<div class="gauge ec x"><div style="width:${tel.ec / tel.ecCap * 100}%"></div></div>` : '') +
      this.hudRow('Pitch / Hdg', fmt(pitch, 0) + '° / ' + fmt(hdg, 0) + '°') + this.hudRow('Dyn. pressure', fmt(tel.q / 1000, 1) + ' kPa', true) + this.hudRow('Gravity', fmt(tel.g, 2) + ' m/s²', true) + this.hudRow('Stage', Math.min(tel.stage + 1, tel.stageCount) + ' / ' + tel.stageCount) +
      this.hudRow('Flags', `${tel.sas ? 'SAS ' : ''}${tel.rcs ? 'RCS ' : ''}${tel.landed ? 'LANDED ' : ''}${tel.hasControl ? '' : 'NO CONTROL'}`.trim() || '–') + `<div class="eng">${engs}</div>` + (tel.bodies > 1 ? this.hudRow('Objects', tel.bodies) : '') + (tel.heat > 0.15 ? this.hudRow('Heating', Math.round(tel.heat * 100) + '%') : '');
    $('#thrFill').style.height = (tel.throttle * 100) + '%'; $('#thrTxt').textContent = Math.round(tel.throttle * 100) + '%';
    $('#cockpitInfo').innerHTML = [['ALT', fmtDist(tel.altitude)], ['SPEED', fmt(tel.speed, 0) + ' m/s'], ['V-SPD', fmt(tel.vspeed, 0)], ['G', fmt(tel.accelG, 1)], ['FUEL', fmt(fuelF * 100, 0) + '%'], ['TWR', fmt(tel.twrNow, 2)], ['THR', Math.round(tel.throttle * 100) + '%']].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
    // stage sequence
    const sum = phys.stageSummary || []; const sk = JSON.stringify([tel.stage, sum.length, sum.map(s => s.items.join('|'))]); if (sk !== this.stageKey) { this.stageKey = sk;
      $('#stageSeq').innerHTML = '<b>Stage sequence</b>' + (sum.length ? sum.map(s => `<div class="s ${s.index < tel.stage ? 'done' : s.index === tel.stage ? 'next' : ''}">${s.index === tel.stage ? '▶ ' : ''}Stage ${s.index + 1}<div>${s.items.join('<br>') || '—'}</div></div>`).join('') : '<div class="hint">No stages defined</div>'); }
    // prelaunch panel
    const pl = $('#prelaunch'); const showPre = f.state === 'prelaunch' || f.state === 'countdown';
    pl.classList.toggle('hidden', !showPre);
    if (showPre) { const html = `<b>${f.design.name}</b> on the launch pad<br><span class="hint">Mass ${fmtMass(tel.mass)} · Fuel ${fmtMass(tel.liquid + tel.solid)} · TWR ${fmt(tel.twr, 2)} · ${tel.parts} parts · ${tel.stageCount} stage(s)</span>` + (f.state === 'prelaunch' ? `<button class="primary big" id="goLaunch">🚀 Start countdown</button>` : `<button class="big" id="goAbort">Abort countdown</button>`);
      if (pl.dataset.k !== html) { pl.dataset.k = html; pl.innerHTML = html; $('#goLaunch') && ($('#goLaunch').onclick = () => f.startCountdown()); $('#goAbort') && ($('#goAbort').onclick = () => f.abortCountdown()); } }
  }
}
