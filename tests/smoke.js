import {
  OscillatorComponent,
  FilterComponent,
  AdsrComponent,
  EffectsComponent,
  LfoComponent,
  MixerComponent,
  SplitterComponent,
  SequencerComponent,
} from '../src/components/index.js';
import { PatternSequencer } from '../src/sequencer/pattern.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');

const passed = [];
const failed = [];

function check(name, fn) {
  try {
    const ok = fn();
    if (ok === false) throw new Error('assertion returned false');
    passed.push(name);
    const li = document.createElement('li');
    li.textContent = `PASS  ${name}`;
    results.appendChild(li);
  } catch (err) {
    failed.push(name);
    const li = document.createElement('li');
    li.className = 'fail';
    li.textContent = `FAIL  ${name}: ${err.message}`;
    results.appendChild(li);
  }
}

const ctx = new (window.AudioContext || window.webkitAudioContext)();

check('AudioContext available', () => !!ctx);

const osc = new OscillatorComponent(ctx, 1);
check('OscillatorComponent constructs + has input/output ports', () => {
  return (
    osc.element.dataset.type === 'oscillator' &&
    !!osc.element.querySelector('.conn-input') &&
    !!osc.element.querySelector('.conn-output')
  );
});

const filter = new FilterComponent(ctx);
check('FilterComponent constructs + has input/output ports', () => {
  return (
    filter.element.dataset.type === 'filter' &&
    !!filter.element.querySelector('.conn-input') &&
    !!filter.element.querySelector('.conn-output')
  );
});

const lfo = new LfoComponent(ctx);
check('LFO component starts its LFO', () => !!lfo.lfo);

check('oscillator exposes frequency param for modulation', () => {
  const p = osc.getModParam();
  return p && typeof p.value === 'number';
});

check('filter exposes cutoff param for modulation', () => {
  const p = filter.getModParam();
  return p && typeof p.value === 'number';
});

check('oscillator audio node connects into filter input', () => {
  osc.node.connect(filter.inputGain);
  return true;
});

check('LFO output connects into oscillator frequency param', () => {
  lfo.outputGain.connect(osc.getModParam());
  return true;
});

const comps = [new AdsrComponent(ctx), new EffectsComponent(ctx), new MixerComponent(ctx), new SplitterComponent(ctx), new SequencerComponent(ctx)];
check('remaining components construct', () => comps.every((c) => !!c.element.dataset.type));

const fakeCtx = { currentTime: 0 };
const seq = new PatternSequencer(fakeCtx, { bpm: 120 });
seq.setPattern([null, 'C4', null, 'E4']);
const hits = [];
seq.onStep = (step, note, time, dur) => hits.push({ step, note, time, dur });
seq.isPlaying = true;
seq.nextTime = 0;
for (let i = 0; i < 40; i++) {
  seq._schedule();
  fakeCtx.currentTime += seq.stepDuration;
}
check('PatternSequencer schedules steps', () => {
  return (
    hits.length >= 32 &&
    !!hits.find((h) => h.step === 1 && h.note === 'C4') &&
    !!hits.find((h) => h.step === 3 && h.note === 'E4') &&
    hits.every((h) => h.time >= 0 && h.dur > 0)
  );
});

for (const c of [osc, filter, lfo, ...comps]) {
  if (c.dispose) {
    try { c.dispose(); } catch (e) { /* ignore during teardown */ }
  }
}
try { ctx.close(); } catch (e) { /* some browsers don't allow immediate close */ }

summary.textContent = `SUMMARY: ${passed.length} passed, ${failed.length} failed`;
if (failed.length > 0) {
  summary.style.color = '#ff4444';
  summary.textContent += ` — ${failed.join(', ')}`;
}
