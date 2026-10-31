// Persistence: designs in localStorage + JSON file export/import; sandbox settings.
import { SCHEMA } from './design.js';
const KEY_LIST = 'rw.designs.v1', KEY_AUTO = 'rw.autosave.v1', KEY_SET = 'rw.settings.v1';

function read(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { console.warn('storage write failed', e); return false; } }

export const Store = {
  list() { const m = read(KEY_LIST, {}); return Object.entries(m).map(([name, v]) => ({ name, saved: v.saved, parts: v.design.parts.length })).sort((a, b) => b.saved - a.saved); },
  save(name, json) { const m = read(KEY_LIST, {}); m[name] = { saved: Date.now(), design: json }; return write(KEY_LIST, m); },
  load(name) { const m = read(KEY_LIST, {}); return m[name] ? m[name].design : null; },
  remove(name) { const m = read(KEY_LIST, {}); delete m[name]; write(KEY_LIST, m); },
  autosave(json) { write(KEY_AUTO, json); },
  loadAuto() { return read(KEY_AUTO, null); },
  settings() { return read(KEY_SET, null); },
  saveSettings(s) { write(KEY_SET, s); },
};

export function exportDesign(json) {
  const blob = new Blob([JSON.stringify(json, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); const safe = (json.name || 'rocket').replace(/[^\w\-]+/g, '_');
  a.href = URL.createObjectURL(blob); a.download = safe + '.rocket.json'; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function readDesignFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onerror = () => rej(new Error('Could not read file'));
    r.onload = () => { try { const j = JSON.parse(r.result); if (j.schema !== SCHEMA) throw new Error('Not a Rocket Workshop design file'); res(j); } catch (e) { rej(e); } };
    r.readAsText(file);
  });
}
