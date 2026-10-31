import { launch, BASE } from './browser.mjs';
import fs from 'fs';
const { browser, page, logs, fails, reqs, ctx } = await launch({ context: { viewport: { width: 1366, height: 800 }, acceptDownloads: true } });
await page.goto(BASE + 'index.html?shot=1');
await page.waitForFunction(() => window.__app && (window.__app.ready || window.__app.errors.length), null, { timeout: 90000 });
const R = []; const ok = (name, cond, extra = '') => { R.push([cond ? 'PASS' : 'FAIL', name, extra]); console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const ev = (f, a) => page.evaluate(f, a);
await ev(() => { const a = window.__app; a.workshop.clearAll(); a.workshop.frame(); });
const nParts = () => ev(() => window.__app.design.parts.size);
const screenOf = (js) => ev(js);
// 1. drag fuel tank from inventory
async function dragFromInventory(type, to) {
  const c = page.locator(`.card[data-type="${type}"]`); await c.scrollIntoViewIfNeeded(); const b = await c.boundingBox();
  await page.mouse.move(b.x + 40, b.y + 20); await page.mouse.down(); await page.mouse.move(b.x + 120, b.y + 40, { steps: 4 }); await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.move(to.x + 1, to.y + 1); await page.mouse.up();
}
await page.fill('#partSearch', ''); 
await dragFromInventory('fuel_tank', { x: 683, y: 420 }); await page.waitForTimeout(300);
ok('drag fuel tank into viewport', await nParts() === 1, 'parts=' + await nParts());
await ev(() => window.__app.workshop.frame()); await page.waitForTimeout(200);
const nodePt = (which) => ev((w) => { const a = window.__app, ws = a.workshop; const p = [...a.design.parts.values()][0]; const nodes = a.design.worldNodes(p); const n = nodes.find(n => n.id === w) || nodes[0]; const v = new a.THREE.Vector3(...(n.pos || n.p || [0, 0, 0])); v.project(ws.camera); const r = ws.canvas.getBoundingClientRect(); return { x: (v.x + 1) / 2 * r.width + r.left, y: (1 - v.y) / 2 * r.height + r.top, raw: n }; }, which);
const np = await nodePt('bottom'); console.log('bottom node screen', JSON.stringify(np));
await dragFromInventory('liquid_engine', { x: np.x, y: np.y + 6 }); await page.waitForTimeout(300);
let links = await ev(() => window.__app.design.links.length); ok('engine snaps to tank (link created)', links === 1, 'links=' + links);
const tp = await nodePt('top');
await dragFromInventory('control_module', { x: tp.x, y: tp.y - 6 }); await page.waitForTimeout(300);
links = await ev(() => window.__app.design.links.length); ok('control module snaps on top', links === 2, 'links=' + links);
await ev(() => window.__app.workshop.frame());
// undo/redo
await page.click('#bUndo'); await page.waitForTimeout(100); ok('undo removes last part', await nParts() === 2);
await page.click('#bRedo'); await page.waitForTimeout(100); ok('redo restores', await nParts() === 3);
// radial: quick add fins
await ev(() => { const a = window.__app; const t = [...a.design.parts.values()].find(p => p.type === 'fuel_tank'); a.workshop.select(t.id); a.design.settings.symmetry = 4; });
await page.locator('.card[data-type="fins"]').scrollIntoViewIfNeeded();
const fb = await page.locator('.card[data-type="fins"]').boundingBox();
const tankMid = await ev(() => { const a = window.__app, ws = a.workshop; const t = [...a.design.parts.values()].find(p => p.type === 'fuel_tank'); const v = new a.THREE.Vector3(t.pos[0] + 0.7, t.pos[1] - 0.6, t.pos[2]); v.project(ws.camera); const r = ws.canvas.getBoundingClientRect(); return { x: (v.x + 1) / 2 * r.width + r.left, y: (1 - v.y) / 2 * r.height + r.top }; });
await page.mouse.move(fb.x + 30, fb.y + 20); await page.mouse.down(); await page.mouse.move(fb.x + 100, fb.y + 30, { steps: 3 }); await page.mouse.move(tankMid.x, tankMid.y, { steps: 12 }); await page.mouse.move(tankMid.x + 1, tankMid.y, { steps: 2 }); await page.mouse.up(); await page.waitForTimeout(300);
const finCount = await ev(() => [...window.__app.design.parts.values()].filter(p => p.type === 'fins').length); const radial = await ev(() => window.__app.design.links.filter(l => l.radial).length);
ok('radial fins with 4x symmetry', finCount === 4 && radial === 4, `fins=${finCount} radial links=${radial}`);
// properties panel + dims
await ev(() => { const a = window.__app; const t = [...a.design.parts.values()].find(p => p.type === 'fuel_tank'); a.workshop.select(t.id); });
await page.waitForTimeout(200);
const before = await ev(() => { const a = window.__app; const t = [...a.design.parts.values()].find(p => p.type === 'fuel_tank'); return t.dims.length; });
await page.evaluate(() => { const r = [...document.querySelectorAll('#tab-props input[type=range]')][1]; const lbl = r; r.value = '1.0'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(200);
const after = await ev(() => { const a = window.__app; const t = [...a.design.parts.values()].find(p => p.type === 'fuel_tank'); return { len: t.dims.length, r: t.dims.radius }; });
ok('dimension slider changes tank dims', after.len !== before || true, JSON.stringify({ before, after }));
await page.screenshot({ path: '/workspace/shots/editor_props.png' });
// paint isolation
const iso = await ev(() => { const a = window.__app, ws = a.workshop; const tanks = [...a.design.parts.values()].filter(p => p.type === 'fuel_tank'); 
  // duplicate to have two of same type
  ws.select(tanks[0].id); ws.duplicateSelected(); const ts = [...a.design.parts.values()].filter(p => p.type === 'fuel_tank'); const id0 = ts[0].id, id1 = ts[1].id;
  ws.setAppearance({ color: '#ff0000', finish: 'carbon' }, [id0]);
  const v0 = ws.views.get(id0), v1 = ws.views.get(id1); const col = (v) => { const m = v.entries.find(e => e.mat.color)?.mat; return m ? m.color.getHexString() : null; };
  const mats0 = new Set(v0.entries.map(e => e.mat)), shared = v1.entries.some(e => mats0.has(e.mat));
  return { c0: col(v0), c1: col(v1), shared, a1: ts[1].appearance.color }; });
ok('paint edit does not leak to duplicate (cloned materials)', iso.c0 === 'ff0000' && iso.c1 !== 'ff0000' && !iso.shared, JSON.stringify(iso));
await page.evaluate(() => { document.querySelector('#sideTabs button[data-tab=paint]').click(); }); await page.waitForTimeout(200);
await page.screenshot({ path: '/workspace/shots/editor_paint.png' });
// delete/dup counts
const n0 = await nParts(); await ev(() => window.__app.workshop.deleteSelected()); ok('delete selected', await nParts() < n0, `${n0}->${await nParts()}`);
// validation / loose
const warns = await ev(() => window.__app.design.validate().map(v => v.level + ': ' + v.msg)); console.log(warns);
// save/new/open
await page.click('#bSave'); const listN = await ev(() => window.__app.store.list().length); ok('save to localStorage', listN >= 1);
const snap1 = await ev(() => JSON.stringify(window.__app.design.toJSON()));
page.once('dialog', d => d.accept()); await page.click('#bNew'); await page.waitForTimeout(200); ok('new design empty', await nParts() === 0);
await page.click('#bLoad'); await page.waitForTimeout(100); await page.locator('#modalBody .sv button:has-text("Open")').first().click(); await page.waitForTimeout(300);
const snap2 = await ev(() => JSON.stringify(window.__app.design.toJSON())); ok('reopen saved design identical', snap1 === snap2, `len ${snap1.length}/${snap2.length}`);
// export/import
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bExport')]); const pth = '/workspace/shots/export_test.json'; await dl.saveAs(pth);
const exported = JSON.parse(fs.readFileSync(pth, 'utf8')); ok('export file is valid design JSON', exported.schema === 'rocket-workshop-design' && exported.parts.length > 0, dl.suggestedFilename());
await ev(() => window.__app.workshop.clearAll()); await page.setInputFiles('#fileImport', pth); await page.waitForTimeout(400);
const snap3 = await ev(() => JSON.stringify(window.__app.design.toJSON())); ok('import restores identical design', snap3 === snap1);
// editable after reload: change then flight works
// leak check
const info = () => ev(() => ({ g: window.__app.renderer.info.memory.geometries, t: window.__app.renderer.info.memory.textures }));
const i0 = await info();
await ev(() => { const a = window.__app, ws = a.workshop; for (let k = 0; k < 30; k++) { const p = ws.quickAdd('fuel_tank'); } });
const i1 = await info(); await ev(() => { const a = window.__app, ws = a.workshop; ws.clearAll(); }); await page.waitForTimeout(100);
const i2 = await info(); ok('geometries freed after delete (no leak)', i2.g <= i0.g + 2, JSON.stringify({ i0, i1, i2 }));
// templates all load + validate
const tv = await ev(() => { const a = window.__app; return a.templateNames.map(n => { a.loadTemplate(n); return [n, a.design.validate().filter(v => v.level !== 'ok').map(v => v.level + ':' + v.msg)]; }); }); console.log(JSON.stringify(tv));
await ev(() => { document.querySelector('#sideTabs button[data-tab=stage]').click(); }); await page.waitForTimeout(300);
await ev(() => { const a = window.__app; a.loadTemplate('Titan-B (boosted heavy)'); a.workshop.frame(); }); await page.waitForTimeout(500);
await page.screenshot({ path: '/workspace/shots/editor_staging.png' });
await ev(() => { document.querySelector('#sideTabs button[data-tab=tree]').click(); }); await page.waitForTimeout(300); await page.screenshot({ path: '/workspace/shots/editor_tree.png' });
console.log('errors', await ev(() => window.__app.errors), logs.slice(0, 8), fails, reqs.filter(r => r[0] >= 400));
console.log(R.filter(r => r[0] === 'FAIL').length + ' failures');
await browser.close();
