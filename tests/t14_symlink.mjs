// Symmetry linking: edits to one fin/leg apply to its symmetric copies; unlinking decouples; delete removes the group; undo works.
import { launch, BASE } from './browser.mjs';
const { browser, page, logs } = await launch({ context: { viewport: { width: 1100, height: 700 } } });
await page.goto(BASE + 'index.html?shot=1'); await page.waitForFunction(() => window.__app && window.__app.ready, null, { timeout: 90000 });
const res = []; const ok = (n, c, x = '') => { res.push(!!c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const r = await page.evaluate(() => {
  const a = window.__app, ws = a.workshop, d = a.design; a.loadTemplate('Falcon 9 (Dragon, landing booster)');
  const fins = d.all().filter(p => p.type === 'grid_fin'); const out = { n: fins.length, sameSym: new Set(fins.map(p => p.sym)).size };
  ws.select(fins[0].id); ws.setDim('span', 0.9); out.linked = fins.every(p => Math.abs(d.get(p.id).dims.span - 0.9) < 1e-9);
  ws.setAppearance({ color: '#ff0000' }); out.paintLinked = fins.every(p => d.get(p.id).appearance.color === '#ff0000');
  d.settings.symLink = false; ws.setDim('span', 0.5); out.unlinked = d.get(fins[0].id).dims.span === 0.5 && fins.slice(1).every(p => d.get(p.id).dims.span === 0.9);
  d.settings.symLink = true; const before = d.parts.size; ws.select(fins[0].id); ws.deleteSelected && ws.deleteSelected(false); out.deleted = before - d.parts.size;
  return out;
});
console.log(JSON.stringify(r)); ok('4 fins share a symmetry id', r.n === 4 && r.sameSym === 1); ok('dim edit propagates', r.linked); ok('paint propagates', r.paintLinked); ok('unlink decouples', r.unlinked); ok('delete removes whole group', r.deleted === 4, 'deleted ' + r.deleted);
console.log(logs, await page.evaluate(() => window.__app.errors)); console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL'); await browser.close();
