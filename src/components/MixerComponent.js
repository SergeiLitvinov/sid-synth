import { AudioComponent } from './AudioComponent.js';
import { Knob } from './Knob.js';

export class MixerComponent extends AudioComponent {
  constructor(ctx) {
    super(ctx, 'mixer', 'MIXER');
    this.gains = [ctx.createGain(), ctx.createGain(), ctx.createGain(), ctx.createGain()];
    this.gains.forEach(g => g.gain.value = 0.5);
    this.output = ctx.createGain();
    this.gains.forEach(g => g.connect(this.output));
    this.node = this.output;
    this.knobs = [];
    this.element = this.createElement();
  }

  createElement() {
    const el = super.createElement();
    const body = el.querySelector('.component-body');

    for (let i = 0; i < 4; i++) {
      const row = document.createElement('div');
      row.className = 'param-row';
      const lbl = document.createElement('span');
      lbl.className = 'param-label';
      lbl.textContent = `CH${i+1}`;
      row.appendChild(lbl);
      const knob = new Knob({
        min: 0,
        max: 1,
        value: 0.5,
        step: 0.01,
        label: `CH${i+1}`,
        onChange: (val) => { this.gains[i].gain.value = val; }
      });
      this.knobs.push(knob);
      row.appendChild(knob.element);
      body.appendChild(row);
    }

    // Inputs
    for (let i = 0; i < 4; i++) {
      const inp = document.createElement('div');
      inp.className = 'conn-point conn-input';
      inp.dataset.type = 'input';
      inp.dataset.id = `mixer-ch${i+1}`;
      inp.style.top = (30 + i * 25) + 'px';
      el.appendChild(inp);
    }

    // Output
    const out = document.createElement('div');
    out.className = 'conn-point conn-output';
    out.dataset.type = 'output';
    out.dataset.id = 'mixer';
    el.appendChild(out);

    return el;
  }

  connectInput(index, source) {
    if (this.gains[index] && source.node) {
      source.node.connect(this.gains[index]);
    }
  }

  connect(dest) {
    if (this.output && dest.node) {
      this.output.connect(dest.node);
    }
  }

  dispose() {
    this.gains.forEach(g => g.disconnect());
    this.output.disconnect();
  }
}
