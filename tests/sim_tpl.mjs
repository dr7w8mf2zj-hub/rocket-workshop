// headless physics run of a template with auto staging + landing guidance. usage: node tests/sim_tpl.mjs <idx|name> [seconds] [pitchProgram]
import { PhysicsWorld, DT } from '../js/physics.js'; import { TEMPLATES } from '../js/templates.js'; import * as THREE from 'three';
const terrain = { heightAt: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0) };
const names = Object.keys(TEMPLATES); const name = names.find(n => n.toLowerCase().includes((process.argv[2] || 'falcon 9 (dragon').toLowerCase())); const secs = +process.argv[3] || 400;
const d = TEMPLATES[name](); const w = new PhysicsWorld(terrain); const b = w.buildVehicle(d); w.autoRecover = !!d.settings.autoRecover; w.autoStage = !!d.settings.autoStage; w.reserve = d.settings.reserve || 0;
b.pos.y = -b.lowest; w.inputs.sas = true; w.inputs.throttle = 1; w.activateStage(); let lastLog = -1, apo = 0; const rec = () => w.bodies.find(x => x.recoverable);
console.log('==', name, 'mass', b.mass.toFixed(0));
const turn = process.argv[4] === 'turn'; if (process.argv[5]) w.settings.wind = +process.argv[5];
for (let t = 0; t < secs; t += DT) {
  if (turn) w.inputs.pitch = (t > 12 && t < 13.5) ? 0.35 : 0;
  w.step(DT); const a = w.active; apo = Math.max(apo, a ? a.pos.y : 0);
  if (Math.abs(t - Math.round(t / 10) * 10) < DT / 2 && Math.round(t) !== lastLog) { lastLog = Math.round(t); const tm = w.telemetry(); const bo = rec();
    console.log(`t=${lastLog} alt=${(tm.altitude/1000).toFixed(1)}km v=${tm.speed.toFixed(0)} fuel=${tm.liquid.toFixed(0)} thr=${(tm.thrust/1000).toFixed(0)}kN stage=${tm.stage} bodies=${w.bodies.length} tilt=${(Math.acos(Math.min(1,new THREE.Vector3(0,1,0).applyQuaternion(a.q).y))*57.3).toFixed(1)}` + (bo ? ` | booster alt=${bo.pos.y.toFixed(0)} vy=${bo.vel.y.toFixed(1)} vh=${Math.hypot(bo.vel.x,bo.vel.z).toFixed(1)} thr=${(bo.thrustNow/1000).toFixed(0)}kN fuel=${bo.fuelTotals().liquid.toFixed(0)} burn=${bo.apBurn} land=${bo.autoland} clr=${bo.clearance.toFixed(0)}` : ''));
  }
  for (const e of w.events.splice(0)) if (e.t !== 'bodyRemoved') console.log('  event', t.toFixed(1), e.t, e.msg || (e.fired || []).join(','), e.reason || '');
}
const bo = rec(); console.log('max alt', apo.toFixed(0)); if (bo) console.log('booster final', 'y', bo.pos.y.toFixed(2), 'vy', bo.vel.y.toFixed(2), 'parts', bo.parts.length, 'tilt', (Math.acos(new THREE.Vector3(0,1,0).applyQuaternion(bo.q).y)*57.3).toFixed(1), 'landed', bo.landed, 'x,z', bo.pos.x.toFixed(1), bo.pos.z.toFixed(1));
