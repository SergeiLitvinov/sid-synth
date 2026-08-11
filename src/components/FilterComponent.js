import { lowpass, highpass, bandpass } from '../filter/index.js';
import { AudioComponent } from './AudioComponent.js';
import { Knob } from './Knob.js';

function createFilter(type, ctx, freq, Q) {
  switch(type) {
    case 'lowpass': return lowpass(ctx, freq, Q);
    case 'highpass': return highpass(ctx, freq, Q);
    case 'bandpass': return bandpass(ctx, freq, Q);
    default: return lowpass(ctx, freq, Q);
  }
}

export class FilterComponent extends AudioComponent {
  constructor(ctx) {
    super(ctx, 'filter', 'FILTER');
    this.filterType = 'lowpass';
    this.frequency = 2000;
    this.Q = 1;
    this.inputGain = ctx.createGain();
    this.outputGain = ctx.createGain();
    this.filterNode = createFilter(this.filterType, ctx, this.frequency, this.Q);
    this.inputGain.connect(this.filterNode);
    this.filterNode.connect(this.outputGain);
    this.node = this.outputGain;
    this.freqKnob = null;
    this.qKnob = null;
    this.element = this.createElement();
  }

  createElement() {
    const el = super.createElement();
    const body = el.querySelector('.component-body');

    const row1 = document.createElement('div');
    row1.className = 'param-row';
    const sel = document.createElement('select');
    ['lowpass', 'highpass', 'bandpass'].forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.toUpperCase();
      sel.appendChild(opt);
    });
    sel.value = this.filterType;
    sel.onchange = () => { this.filterType = sel.value; this.update(); };
    row1.appendChild(sel);
    body.appendChild(row1);

    this.freqKnob = new Knob({
      min: 20,
      max: 20000,
      value: this.frequency,
      label: 'FRQ',
      unit: 'Hz',
      onChange: (val) => { this.frequency = val; this.update(); }
    });
    body.appendChild(this.freqKnob.element);

    this.qKnob = new Knob({
      min: 0.1,
      max: 20,
      value: this.Q,
      step: 0.1,
      label: 'Q',
      onChange: (val) => { this.Q = val; this.update(); }
    });
    body.appendChild(this.qKnob.element);

    const inp = document.createElement('div');
    inp.className = 'conn-point conn-input';
    inp.dataset.type = 'input';
    inp.dataset.id = 'filter';
    el.appendChild(inp);

    const out = document.createElement('div');
    out.className = 'conn-point conn-output';
    out.dataset.type = 'output';
    out.dataset.id = 'filter';
    el.appendChild(out);

    return el;
  }

  update() {
    const oldNode = this.filterNode;
    this.filterNode = createFilter(this.filterType, this.ctx, this.frequency, this.Q);
    this.inputGain.disconnect();
    this.inputGain.connect(this.filterNode);
    this.filterNode.connect(this.outputGain);
    if (oldNode) oldNode.disconnect();
  }

  getModParam() {
    return this.filterNode ? this.filterNode.frequency : null;
  }

  dispose() {
    if (this.filterNode) {
      this.filterNode.disconnect();
      this.inputGain.disconnect();
      this.outputGain.disconnect();
      this.isConnected = false;
    }
  }
}
