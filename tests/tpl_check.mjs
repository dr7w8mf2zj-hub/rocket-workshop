import { TEMPLATES } from '../js/templates.js'; import { PARTS } from '../js/registry.js';
for (const n of Object.keys(TEMPLATES)) { const d = TEMPLATES[n](); const st = d.stats(); const sb = d.stability();
  console.log('==', n, 'parts', d.parts.size, 'dry', st.dry.toFixed(0), 'wet', st.wet.toFixed(0), 'thrust', (st.thrust0/1000).toFixed(0), 'TWR', st.twr.toFixed(2), 'stages', d.stageCount(), 'stab', sb && sb.marginFull.toFixed(2), sb && sb.marginEmpty.toFixed(2));
  console.log(d.validate().map(v => v.level + ': ' + v.msg).join('\n')); }
