import { Adsr } from '../envelope/adshr.js';
import { AudioComponent } from './AudioComponent.js';

export class AdsrComponent extends AudioComponent {
  constructor(ctx) {
    super(ctx, 'adsr', 'ADSR');
    this.attack = 0.05;
    this.decay = 0.2;
    this.sustain = 0.6;
    this.release = 0.25;
    this.adsr = new Adsr(ctx, { attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release });
    this.node = this.adsr.gain;
    this.element = this.createElement();
  }

  createElement() {
    const el = super.createElement();
    const body = el.querySelector('.component-body');

    const params = [
      { label: 'A', val: this.attack, key: 'attack', step: 0.01 },
      { label: 'D', val: this.decay, key: 'decay', step: 0.01 },
      { label: 'S', val: this.sustain, key: 'sustain', step: 0.01 },
      { label: 'R', val: this.release, key: 'release', step: 0.01 }
    ];

    params.forEach(p => {
      const row = document.createElement('div');
      row.className = 'param-row';
      const lbl = document.createElement('span');
      lbl.className = 'param-label';
      lbl.textContent = p.label;
      row.appendChild(lbl);
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.value = p.val;
      inp.step = p.step;
      inp.style.width = '55px';
      inp.onchange = () => { this[p.key] = +inp.value; this.adsr.setParams({ [p.key]: this[p.key] }); };
      row.appendChild(inp);
      body.appendChild(row);
    });

    // Input dot
    const inp = document.createElement('div');
    inp.className = 'conn-point conn-input';
    inp.dataset.type = 'input';
    inp.dataset.id = 'adsr';
    el.appendChild(inp);

    // Output dot
    const out = document.createElement('div');
    out.className = 'conn-point conn-output';
    out.dataset.type = 'output';
    out.dataset.id = 'adsr';
    el.appendChild(out);

    return el;
  }

  triggerAttack() { this.adsr.triggerAttack(); }
  triggerRelease() { this.adsr.triggerRelease(); }

  connect(dest) {
    if (this.adsr && dest.node) {
      this.adsr.connect(dest.node);
      this.isConnected = true;
    }
  }

  dispose() {
    if (this.adsr) {
      this.adsr.dispose();
      this.isConnected = false;
    }
  }
}
