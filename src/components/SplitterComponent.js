import { AudioComponent } from './AudioComponent.js';

export class SplitterComponent extends AudioComponent {
  constructor(ctx) {
    super(ctx, 'splitter', 'SPLITTER');
    this.splitter = ctx.createChannelSplitter(2);
    this.node = this.splitter;
    this.element = this.createElement();
  }

  createElement() {
    const el = super.createElement();
    const body = el.querySelector('.component-body');
    body.textContent = '1 IN -> 2 OUT';

    // Input
    const inp = document.createElement('div');
    inp.className = 'conn-point conn-input';
    inp.dataset.type = 'input';
    inp.dataset.id = 'splitter-in';
    el.appendChild(inp);

    // Outputs
    for (let i = 0; i < 2; i++) {
      const out = document.createElement('div');
      out.className = 'conn-point conn-output';
      out.dataset.type = 'output';
      out.dataset.id = `splitter-out${i}`;
      out.style.top = (30 + i * 25) + 'px';
      el.appendChild(out);
    }

    return el;
  }

  connect(dest) {
    if (this.splitter && dest.node) {
      this.splitter.connect(dest.node, 0, 0);
    }
  }

  connectOutput(index, dest) {
    if (this.splitter && dest.node) {
      this.splitter.connect(dest.node, index, 0);
    }
  }

  dispose() {
    this.splitter.disconnect();
  }
}
