import { createMockAudioContext } from './mockAudioContext.js';
import {
  OscillatorComponent,
  FilterComponent,
  AdsrComponent,
  EffectsComponent,
  LfoComponent,
  MixerComponent,
  SplitterComponent,
  SequencerComponent,
  Knob,
} from '../src/components/index.js';
import { Lfo } from '../src/modulator/index.js';
import { Adsr } from '../src/envelope/adshr.js';
import { PatternSequencer } from '../src/sequencer/pattern.js';
import { Delay, Reverb } from '../src/effects/index.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];

function check(name, fn) {
  try {
    if (fn() === false) throw new Error('assertion returned false');
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

check('OscillatorComponent creates header + input/output ports', () => {
  const ctx = createMockAudioContext();
  const osc = new OscillatorComponent(ctx, 1);
  const ok =
    osc.element.dataset.type === 'oscillator' &&
    !!osc.element.querySelector('.component-header') &&
    !!osc.element.querySelector('.conn-input') &&
    !!osc.element.querySelector('.conn-output');
  osc.dispose();
  return ok;
});

check('all component types construct without throwing', () => {
  const ctx = createMockAudioContext();
  const comps = [
    new OscillatorComponent(ctx, 1),
    new FilterComponent(ctx),
    new AdsrComponent(ctx),
    new EffectsComponent(ctx),
    new LfoComponent(ctx),
    new MixerComponent(ctx),
    new SplitterComponent(ctx),
    new SequencerComponent(ctx),
  ];
  return comps.every((c) => !!c.element.dataset.type);
});

check('LFO component starts its LFO on construction', () => {
  const ctx = createMockAudioContext();
  const lfo = new LfoComponent(ctx);
  return !!lfo.lfo && lfo.lfo.osc._started === true;
});

check('oscillator exposes its frequency AudioParam', () => {
  const ctx = createMockAudioContext();
  const osc = new OscillatorComponent(ctx, 1);
  const ok = osc.getModParam() === osc.node.frequency;
  osc.dispose();
  return ok;
});

check('filter exposes its cutoff AudioParam', () => {
  const ctx = createMockAudioContext();
  const filter = new FilterComponent(ctx);
  const ok = filter.getModParam() === filter.filterNode.frequency;
  filter.dispose();
  return ok;
});

check('LFO gain connects into an AudioParam (modulation)', () => {
  const ctx = createMockAudioContext();
  const lfo = new LfoComponent(ctx);
  const osc = new OscillatorComponent(ctx, 1);
  const param = osc.getModParam();
  lfo.outputGain.connect(param);
  const ok = param._connections.has(lfo.outputGain);
  lfo.dispose();
  osc.dispose();
  return ok;
});

check('Knob clamps values to min/max and fires onChange', () => {
  let calls = 0;
  const knob = new Knob({ min: 0, max: 100, value: 50, onChange: () => calls++ });
  knob.setValue(150);
  if (knob.value !== 100) return false;
  knob.setValue(-5);
  return knob.value === 0 && calls === 2;
});

check('Lfo sets rate/depth/type on its nodes', () => {
  const ctx = createMockAudioContext();
  const lfo = new Lfo(ctx, { type: 'sine', rate: 1, depth: 50 });
  lfo.setRate(5);
  lfo.setDepth(20);
  lfo.setType('square');
  return lfo.osc.frequency.value === 5 && lfo.gain.gain.value === 20 && lfo.osc.type === 'square';
});

check('Adsr ramps gain on attack/release', () => {
  const ctx = createMockAudioContext();
  const adsr = new Adsr(ctx, { attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.25 });
  adsr.triggerAttack();
  if (adsr.gain.gain.value !== 0.6) return false;
  adsr.triggerRelease();
  return adsr.gain.gain.value === 0;
});

check('Delay and Reverb wire input->dry/wet->output', () => {
  const ctx = createMockAudioContext();
  const delay = new Delay(ctx);
  const dOk =
    delay.input._connections.has(delay.dry) && delay.input._connections.has(delay.delay);
  const reverb = new Reverb(ctx);
  const rOk =
    reverb.input._connections.has(reverb.convolver) &&
    reverb.convolver.buffer.numberOfChannels === 2;
  return dOk && rOk;
});

check('PatternSequencer schedules steps ahead of currentTime', () => {
  const ctx = createMockAudioContext();
  ctx.currentTime = 1.0;
  const seq = new PatternSequencer(ctx, { bpm: 120, steps: 16 });
  seq.setPattern([null, 'C4', null, null, 'E4']);
  const hits = [];
  seq.onStep = (step, note, time, dur) => hits.push({ step, note, time, dur });
  seq.isPlaying = true;
  seq.nextTime = ctx.currentTime;
  for (let i = 0; i < 64; i++) {
    seq._schedule();
    ctx.currentTime += seq.stepDuration;
  }
  return (
    hits.length >= 60 &&
    hits[0].step === 0 &&
    hits[0].note == null &&
    !!hits.find((h) => h.step === 1 && h.note === 'C4') &&
    hits.every((h) => h.time >= 1.0 && h.dur > 0)
  );
});

summary.textContent = `SUMMARY: ${passed.length} passed, ${failed.length} failed`;
if (failed.length > 0) {
  summary.style.color = '#ff4444';
  summary.textContent += ` — ${failed.join(', ')}`;
}
