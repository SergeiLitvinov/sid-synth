import { sine, square, triangle, noise } from '../oscillator/index.js';
import { AudioComponent } from './AudioComponent.js';
import { Knob } from './Knob.js';

function createOsc(type, ctx, freq) {
  switch(type) {
    case 'sine': return sine(ctx, freq);
    case 'square': return square(ctx, freq);
    case 'triangle': return triangle(ctx, freq);
    case 'noise': return noise(ctx);
    default: return square(ctx, freq);
  }
}

export class OscillatorComponent extends AudioComponent {
  constructor(ctx, id = 1) {
    super(ctx, 'oscillator', `OSC ${id}`);
    this.id = id;
    this.waveform = 'sawtooth';
    this.frequency = 440;
    this.isOn = id === 1;
    this.outputGain = ctx.createGain();
    this.node = null;
    this.freqKnob = null;
    this.element = this.createElement();
    this.update();
  }

  createElement() {
    const el = super.createElement();
    const body = el.querySelector('.component-body');

    const row1 = document.createElement('div');
    row1.className = 'param-row';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = this.isOn;
    chk.onchange = () => { this.isOn = chk.checked; this.update(); };
    row1.appendChild(chk);
    
    const sel = document.createElement('select');
    ['sawtooth', 'square', 'triangle', 'noise'].forEach(w => {
      const opt = document.createElement('option');
      opt.value = w;
      opt.textContent = w.toUpperCase();
      sel.appendChild(opt);
    });
    sel.value = this.waveform;
    sel.onchange = () => { this.waveform = sel.value; this.update(); };
    row1.appendChild(sel);
    body.appendChild(row1);

    this.freqKnob = new Knob({
      min: 20,
      max: 2000,
      value: this.frequency,
      step: 1,
      label: 'FRQ',
      unit: 'Hz',
      onChange: (val) => { this.frequency = val; this.update(); }
    });
    body.appendChild(this.freqKnob.element);

    const out = document.createElement('div');
    out.className = 'conn-point conn-output';
    out.dataset.type = 'output';
    out.dataset.id = `osc${this.id}`;
    el.appendChild(out);

    return el;
  }

  update() {
    if (!this.isOn) {
      if (this.node) {
        try { this.node.stop(); } catch(e) {}
        this.node.disconnect();
        this.node = null;
      }
      this.outputGain.gain.value = 0;
      return;
    }
    this.outputGain.gain.value = 1;
    const newOsc = createOsc(this.waveform, this.ctx, this.frequency);
    if (this.node) {
      try { this.node.stop(); } catch(e) {}
      this.node.disconnect();
    }
    this.node = newOsc;
    this.node.connect(this.outputGain);
    try { this.node.start(); } catch(e) {}
  }

  connect(dest) {
    if (this.outputGain && dest.node) {
      this.outputGain.connect(dest.node);
      this.isConnected = true;
    }
  }

  dispose() {
    if (this.node) {
      try { this.node.stop(); } catch(e) {}
      this.node.disconnect();
      this.node = null;
    }
    this.outputGain.disconnect();
    this.isConnected = false;
  }
}
