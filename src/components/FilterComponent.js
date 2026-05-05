import { create as createFilter } from '../filter/index.js';
import { AudioComponent } from './AudioComponent.js';

export class FilterComponent extends AudioComponent {
  constructor(ctx) {
    super(ctx, 'filter', 'FILTER');
    this.filterType = 'lowpass';
    this.frequency = 2000;
    this.Q = 1;
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

    // Frequency
    const row2 = document.createElement('div');
    row2.className = 'param-row';
    const lbl1 = document.createElement('span');
    lbl1.className = 'param-label';
    lbl1.textContent = 'FRQ';
    row2.appendChild(lbl1);
    const inp1 = document.createElement('input');
    inp1.type = 'number';
    inp1.value = this.frequency;
    inp1.style.width = '70px';
    inp1.onchange = () => { this.frequency = +inp1.value; this.update(); };
    row2.appendChild(inp1);
    body.appendChild(row2);

    // Q/Resonance
    const row3 = document.createElement('div');
    row3.className = 'param-row';
    const lbl2 = document.createElement('span');
    lbl2.className = 'param-label';
    lbl2.textContent = 'Q';
    row3.appendChild(lbl2);
    const inp2 = document.createElement('input');
    inp2.type = 'number';
    inp2.value = this.Q;
    inp2.step = '0.1';
    inp2.style.width = '50px';
    inp2.onchange = () => { this.Q = +inp2.value; this.update(); };
    row3.appendChild(inp2);
    body.appendChild(row3);

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
