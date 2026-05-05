import { Lfo } from '../modulator/index.js';
import { AudioComponent } from './AudioComponent.js';
import { Knob } from './Knob.js';

export class LfoComponent extends AudioComponent {
  constructor(ctx) {
    super(ctx, 'lfo', 'LFO');
    this.rate = 1;
    this.depth = 50;
    this.waveType = 'sine';
    this.lfo = new Lfo(ctx, { type: this.waveType, rate: this.rate, depth: this.depth });
    this.node = this.lfo.gain;
    this.rateKnob = null;
    this.depthKnob = null;
    this.element = this.createElement();
  }

  createElement() {
    const el = super.createElement();
    const body = el.querySelector('.component-body');

    // Type select
    const row1 = document.createElement('div');
    row1.className = 'param-row';
    const sel = document.createElement('select');
    ['sine', 'square', 'sawtooth', 'triangle'].forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.toUpperCase();
      sel.appendChild(opt);
    });
    sel.value = this.waveType;
    sel.onchange = () => { this.waveType = sel.value; this.lfo.setType(this.waveType); };
    row1.appendChild(sel);
    body.appendChild(row1);

    // Rate knob
    this.rateKnob = new Knob({
      min: 0.1,
      max: 20,
      value: this.rate,
      step: 0.1,
      label: 'RATE',
      unit: 'Hz',
      onChange: (val) => { this.rate = val; this.lfo.setRate(val); }
    });
    body.appendChild(this.rateKnob.element);

    // Depth knob
    this.depthKnob = new Knob({
      min: 1,
      max: 100,
      value: this.depth,
      step: 1,
      label: 'DEP',
      onChange: (val) => { this.depth = val; this.lfo.setDepth(val); }
    });
    body.appendChild(this.depthKnob.element);

    // Output
    const out = document.createElement('div');
    out.className = 'conn-point conn-output';
    out.dataset.type = 'output';
    out.dataset.id = 'lfo';
    el.appendChild(out);

    return el;
  }

  connect(dest) {
    if (this.lfo && dest.node) {
      this.lfo.connect(dest.node);
      this.isConnected = true;
    }
  }

  dispose() {
    if (this.lfo) { this.lfo.dispose(); this.isConnected = false; }
  }
}
