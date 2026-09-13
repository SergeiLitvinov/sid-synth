import { createRackController } from '../src/rack/rackController.js';
import { createMockAudioContext } from './mockAudioContext.js';
import { captureParams } from '../src/services/componentParams.js';
let passed = 0, failed = 0;
function check(name, fn) {
  const li = document.createElement('li');
  try { if (!fn()) throw new Error('assertion returned false'); passed++; li.textContent = 'PASS ' + name; }
  catch (e) { failed++; li.className = 'fail'; li.textContent = 'FAIL ' + name + ': ' + e.message; }
  document.getElementById('results').appendChild(li);
}
const ctx = createMockAudioContext();
const rack = createRackController({ ctx, masterGain: ctx.destination });
const snapshot = { components: [{ id: 'osc', type: 'oscillator', x: 20, y: 30, params: { wave: 'sine', freq: 4186 } }], connections: [{ from: 'osc', to: 'master' }] };
rack.createComponent('filter', '', 150, 100);
check('rack preparation leaves live components and routes untouched', () => {
  const before = Object.keys(rack.components).join();
  const stage = rack.prepareRack(snapshot);
  const ok = Object.keys(rack.components).join() === before && rack.router.connections.length === 0;
  stage.dispose(); return ok;
});
check('prepared rack adopts exact pitch and wires the master route', () => {
  const stage = rack.prepareRack(snapshot); stage.commit();
  const keys = Object.keys(rack.components), comp = rack.components[keys[0]];
  return keys.length === 1 && comp.type === 'oscillator' && captureParams(comp).freq === 4186
    && rack.router.connections.length === 1 && comp.outputGain._connections.size === 1;
});
check('deleting an adopted master route disconnects the actual audio target', () => {
  const comp = Object.values(rack.components)[0];
  rack.router.deleteConnection(0);
  return comp.outputGain._connections.size === 0 && rack.router.connections.length === 0;
});
check('failed rack constructor releases partial nodes and preserves live rack', () => {
  const before = Object.keys(rack.components).join();
  const original = ctx.createGain; let count = 0; const nodes = [];
  ctx.createGain = (...args) => {
    if (++count === 3) throw new Error('allocation failed');
    const node = original(...args); const disconnect = node.disconnect.bind(node);
    node.disconnect = (...a) => { node.cleaned = true; disconnect(...a); }; nodes.push(node); return node;
  };
  let rejected = false;
  try { rack.prepareRack(snapshot); } catch (_) { rejected = true; }
  finally { ctx.createGain = original; }
  return rejected && Object.keys(rack.components).join() === before && nodes.every(n => n.cleaned);
});
check('LFO waveform is restored in both model and audio oscillator', () => {
  const stage = rack.prepareRack({ components: [{ id:'lfo',type:'lfo',x:0,y:0,params:{wave:'triangle'} }], connections:[] }); stage.commit();
  const comp = Object.values(rack.components)[0];
  return captureParams(comp).wave === 'triangle' && comp.lfo.osc.type === 'triangle';
});
rack.clearRack();
document.getElementById('summary').textContent = `${passed} passed, ${failed} failed`;
