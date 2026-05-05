import { create as createFilter } from '../filter/index.js';
import { AudioComponent } from './AudioComponent.js';
import { Knob } from './Knob.js';

export class FilterComponent extends AudioComponent {
  constructor(ctx) {
    super(ctx, 'filter', 'FILTER');
    this.filterType = 'lowpass';
    this.frequency = 2000;
    this.Q = 1;
    this.freqKnob = null;
    this.qKnob = null;
    this.node = createFilter(this.filterType, ctx, this.frequency, this.Q);
    this.element = this.createElement();
  }

  createElement() {
    const el = super.createElement();
    const body = el.querySelector('.component-body');

    // Type select
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

    // Frequency knob
    this.freqKnob = new Knob({
      min: 20,
      max: 20000,
      value: this.frequency,
      label: 'FRQ',
      unit: 'Hz',
      onChange: (val) => { this.frequency = val; this.update(); }
    });
    body.appendChild(this.freqKnob.element);

    // Q knob
    this.qKnob = new Knob({
      min: 0.1,
      max: 20,
      value: this.Q,
      step: 0.1,
      label: 'Q',
      onChange: (val) => { this.Q = val; this.update(); }
    });
    body.appendChild(this.qKnob.element);

    // Input dot
    const inp = document.createElement('div');
    inp.className = 'conn-point conn-input';
    inp.dataset.type = 'input';
    inp.dataset.id = 'filter';
    el.appendChild(inp);

    // Output dot
    const out = document.createElement('div');
    out.className = 'conn-point conn-output';
    out.dataset.type = 'output';
    out.dataset.id = 'filter';
    el.appendChild(out);

    return el;
  }

  update() {
    if (this.node) {
      this.node.type = this.filterType;
      this.node.frequency.value = this.frequency;
      this.node.Q.value = this.Q;
    }
  }

  connect(dest) {
    if (this.node && dest.node) {
      this.node.connect(dest.node);
      this.isConnected = true;
    }
  }

  dispose() {
    if (this.node) {
      this.node.disconnect();
      this.isConnected = false;
    }
  }
}
