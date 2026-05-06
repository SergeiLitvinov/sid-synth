import { AudioComponent } from './AudioComponent.js';
import { Knob } from './Knob.js';

export class MixerComponent extends AudioComponent {
  constructor(ctx) {
    super(ctx, 'mixer', 'MIXER');
    this.channelGains = [ctx.createGain(), ctx.createGain(), ctx.createGain(), ctx.createGain()];
    this.channelGains.forEach(g => g.gain.value = 0.5);
    this.outputGain = ctx.createGain();
    this.channelGains.forEach(g => g.connect(this.outputGain));
    this.node = this.outputGain;
    this.knobs = [];
    // Each channel has its own inputGain
    this.inputGains = [
      ctx.createGain(),
      ctx.createGain(),
      ctx.createGain(),
      ctx.createGain()
    ];
    this.inputGains.forEach((g, i) => g.connect(this.channelGains[i]));
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
        onChange: (val) => { this.channelGains[i].gain.value = val; }
      });
      this.knobs.push(knob);
      row.appendChild(knob.element);
      body.appendChild(row);
    }

    // Inputs - 4 separate inputs
    for (let i = 0; i < 4; i++) {
      const inp = document.createElement('div');
      inp.className = 'conn-point conn-input';
      inp.dataset.type = 'input';
      inp.dataset.id = `mixer-ch${i}`;
      inp.dataset.channel = i;
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

  dispose() {
    this.channelGains.forEach(g => g.disconnect());
    this.outputGain.disconnect();
    this.inputGains.forEach(g => g.disconnect());
  }
}
