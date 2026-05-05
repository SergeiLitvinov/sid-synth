import { AudioComponent } from './AudioComponent.js';
import { PatternSequencer } from '../sequencer/pattern.js';

export class SequencerComponent extends AudioComponent {
  constructor(ctx) {
    super(ctx, 'sequencer', 'SEQ');
    this.seq = new PatternSequencer(ctx);
    this.steps = 16;
    this.pattern = new Array(this.steps).fill(null);
    this.isPlaying = false;
    this.element = this.createElement();
  }

  createElement() {
    const el = super.createElement();
    const body = el.querySelector('.component-body');

    // BPM
    const row1 = document.createElement('div');
    row1.className = 'param-row';
    const lbl = document.createElement('span');
    lbl.className = 'param-label';
    lbl.textContent = 'BPM';
    row1.appendChild(lbl);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = 120;
    inp.style.width = '55px';
    inp.onchange = () => { this.seq.setBpm(+inp.value); };
    row1.appendChild(inp);
    body.appendChild(row1);

    // Play/Stop buttons
    const row2 = document.createElement('div');
    row2.className = 'param-row';
    const playBtn = document.createElement('button');
    playBtn.textContent = 'PLAY';
    playBtn.className = 'preset-btn';
    playBtn.style.padding = '4px 8px';
    playBtn.onclick = () => { this.seq.start(); this.isPlaying = true; };
    row2.appendChild(playBtn);
    const stopBtn = document.createElement('button');
    stopBtn.textContent = 'STOP';
    stopBtn.className = 'preset-btn btn-red';
    stopBtn.style.padding = '4px 8px';
    stopBtn.onclick = () => { this.seq.stop(); this.isPlaying = false; };
    row2.appendChild(stopBtn);
    body.appendChild(row2);

    // Step grid
    const grid = document.createElement('div');
    grid.className = 'seq-grid';
    grid.style.marginTop = '6px';
    for (let i = 0; i < this.steps; i++) {
      const step = document.createElement('div');
      step.className = 'seq-step';
      step.dataset.step = i;
      step.textContent = i + 1;
      step.onclick = () => {
        step.classList.toggle('active');
        if (step.classList.contains('active')) {
          const n = prompt('Note (C,D,E,F,G,A,B or with #):', 'C');
          if (n) { this.pattern[i] = n.toUpperCase(); step.textContent = n.charAt(0).toUpperCase(); }
        } else { this.pattern[i] = null; step.textContent = i + 1; }
        this.seq.setPattern(this.pattern);
      };
      grid.appendChild(step);
    }
    body.appendChild(grid);

    // Input
    const inp = document.createElement('div');
    inp.className = 'conn-point conn-input';
    inp.dataset.type = 'input';
    inp.dataset.id = 'sequencer';
    el.appendChild(inp);

    // Output
    const out = document.createElement('div');
    out.className = 'conn-point conn-output';
    out.dataset.type = 'output';
    out.dataset.id = 'sequencer';
    el.appendChild(out);

    return el;
  }

  connect(dest) {
    if (this.seq && dest.node) {
      this.seq.onStep = (step, note) => {
        if (note && dest.playNote) dest.playNote(note);
      };
      this.isConnected = true;
    }
  }

  dispose() {
    if (this.seq) this.seq.dispose();
  }
}
