import { Design } from '../js/design.js';
import { PhysicsWorld, DT } from '../js/physics.js';
import { TEMPLATES } from '../js/templates.js';
import * as THREE from 'three';
const terrain = { heightAt: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0) };
function run(name, seconds, stageAt = {}) {
  const d = TEMPLATES[name](); console.log('==', name, JSON.stringify(d.validate().map(v => v.level + ':' + v.msg)));
  console.log('stats', d.stats(), 'stages', d.stageCount());
  const w = new PhysicsWorld(terrain); const b = w.buildVehicle(d);
  b.pos.y = -b.lowest + 0.0; b.held = false; w.inputs.sas = true; w.inputs.throttle = 1; w.autoStage = true;
  w.activateStage(); let maxAlt = 0, lastLog = -1;
  for (let t = 0; t < seconds; t += DT) {
    w.step(DT);
    if (w.active) { maxAlt = Math.max(maxAlt, w.active.pos.y); }
    const sec = Math.floor(t);
    if (sec % 10 === 0 && sec !== lastLog) { lastLog = sec; const tm = w.telemetry(); console.log(`t=${sec} alt=${tm.altitude.toFixed(0)} v=${tm.speed.toFixed(0)} fuel=${tm.liquid.toFixed(0)} thr=${(tm.thrust/1000).toFixed(0)}kN stage=${tm.stage} bodies=${w.bodies.length} q=${tm.q.toFixed(0)} tilt=${(Math.acos(new THREE.Vector3(0,1,0).applyQuaternion(w.active.q).y)*57.3).toFixed(1)}`); }
    for (const e of w.events.splice(0)) if (e.t !== 'bodyRemoved') console.log('  event', t.toFixed(1), e.t, e.msg || (e.fired || []).join(','));
    if (w.autoStage === false && stageAt[Math.floor(t * 10) / 10]) w.activateStage();
  }
  console.log('max alt', maxAlt.toFixed(0));
}
const which = process.argv[2] || 'Lark-1 (single stage)';
const stageTimes = {}; w_auto: 0;
run(which, +process.argv[3] || 80);
