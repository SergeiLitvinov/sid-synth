import { Lfo } from '../modulator/index.js';
import { AudioComponent } from './AudioComponent.js';

export class LfoComponent extends AudioComponent {
  constructor(ctx) {
    super(ctx, 'lfo', 'LFO');
    this.rate = 1;
    this.depth = 50;
    this.waveType = 'sine';
    this.lfo = new Lfo(ctx, { type: this.waveType, rate: this.rate, depth: this.depth });
    this.node = this.lfo.gain;
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

    // Rate
    const row2 = document.createElement('div');
    row2.className = 'param-row';
    const lbl1 = document.createElement('span');
    lbl1.className = 'param-label';
    lbl1.textContent = 'RATE';
    row2.appendChild(lbl1);
    const inp1 = document.createElement('input');
    inp1.type = 'number';
    inp1.value = this.rate;
    inp1.step = '0.1';
    inp1.style.width = '60px';
    inp1.onchange = () => { this.rate = +inp1.value; this.lfo.setRate(this.rate); };
    row2.appendChild(inp1);
    body.appendChild(row2);

    // Depth
    const row3 = document.createElement('div');
    row3.className = 'param-row';
    const lbl2 = document.createElement('span');
    lbl2.className = 'param-label';
    lbl2.textContent = 'DEP';
    row3.appendChild(lbl2);
    const inp2 = document.createElement('input');
    inp2.type = 'number';
    inp2.value = this.depth;
    inp2.step = '1';
    inp2.style.width = '60px';
    inp2.onchange = () => { this.depth = +inp2.value; this.lfo.setDepth(this.depth); };
    row3.appendChild(inp2);
    body.appendChild(row3);

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
