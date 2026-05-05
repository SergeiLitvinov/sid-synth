import { Delay } from '../effects/index.js';
import { Reverb } from '../effects/index.js';
import { AudioComponent } from './AudioComponent.js';

export class EffectsComponent extends AudioComponent {
  constructor(ctx) {
    super(ctx, 'effects', 'EFFECTS');
    this.delayOn = false;
    this.reverbOn = false;
    this.delayTime = 0.3;
    this.delayFeedback = 0.4;
    this.reverbDuration = 2.0;
    this.reverbDecay = 0.5;
    this.delay = null;
    this.reverb = null;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);
    this.node = this.output;
    this.element = this.createElement();
  }

  createElement() {
    const el = super.createElement();
    const body = el.querySelector('.component-body');

    // Delay
    const row1 = document.createElement('div');
    row1.className = 'param-row';
    const chk1 = document.createElement('input');
    chk1.type = 'checkbox';
    chk1.onchange = () => { this.delayOn = chk1.checked; this.update(); };
    row1.appendChild(chk1);
    const lbl1 = document.createElement('span');
    lbl1.textContent = 'DELAY';
    lbl1.className = 'param-label';
    row1.appendChild(lbl1);
    body.appendChild(row1);

    this.delayKnob = new Knob({
      min: 0.1,
      max: 2.0,
      value: this.delayTime,
      step: 0.1,
      label: 'TIME',
      unit: 's',
      onChange: (val) => { this.delayTime = val; this.update(); }
    });
    body.appendChild(this.delayKnob.element);

    // Reverb
    const row2 = document.createElement('div');
    row2.className = 'param-row';
    const chk2 = document.createElement('input');
    chk2.type = 'checkbox';
    chk2.onchange = () => { this.reverbOn = chk2.checked; this.update(); };
    row2.appendChild(chk2);
    const lbl2 = document.createElement('span');
    lbl2.textContent = 'REVERB';
    lbl2.className = 'param-label';
    row2.appendChild(lbl2);
    body.appendChild(row2);

    this.reverbKnob = new Knob({
      min: 0.1,
      max: 5.0,
      value: this.reverbDuration,
      step: 0.1,
      label: 'SIZE',
      unit: 's',
      onChange: (val) => { this.reverbDuration = val; this.update(); }
    });
    body.appendChild(this.reverbKnob.element);

    // Input
    const inp = document.createElement('div');
    inp.className = 'conn-point conn-input';
    inp.dataset.type = 'input';
    inp.dataset.id = 'effects';
    el.appendChild(inp);

    // Output
    const out = document.createElement('div');
    out.className = 'conn-point conn-output';
    out.dataset.type = 'output';
    out.dataset.id = 'effects';
    el.appendChild(out);

    return el;
  }

  update() {
    // Clean up old effects
    if (this.delay) { this.delay.disconnect(); this.delay = null; }
    if (this.reverb) { this.reverb.disconnect(); this.reverb = null; }
    
    // Rebuild chain
    this.input.disconnect();
    let last = this.input;
    
    if (this.delayOn) {
      this.delay = new Delay(this.ctx, { time: this.delayTime, feedback: this.delayFeedback });
      last.connect(this.delay.input);
      last = this.delay;
    }
    
    if (this.reverbOn) {
      this.reverb = new Reverb(this.ctx, { duration: this.reverbDuration, decay: this.reverbDecay });
      last.connect(this.reverb.input);
      last = this.reverb;
    }
    
    last.connect(this.output);
  }

  connect(dest) {
    if (this.output && dest.node) {
      this.output.connect(dest.node);
      this.isConnected = true;
    }
  }

  dispose() {
    if (this.delay) this.delay.disconnect();
    if (this.reverb) this.reverb.disconnect();
    this.isConnected = false;
  }
}
