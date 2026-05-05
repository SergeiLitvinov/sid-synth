export class AudioComponent {
  constructor(ctx, type, label) {
    this.ctx = ctx;
    this.type = type;
    this.label = label;
    this.inputs = {};
    this.outputs = {};
    this.node = null;
    this.element = null;
    this.isConnected = false;
  }

  createElement() {
    const el = document.createElement('div');
    el.className = 'component';
    el.dataset.type = this.type;
    
    const header = document.createElement('div');
    header.className = 'component-header';
    header.textContent = this.label;
    
    const body = document.createElement('div');
    body.className = 'component-body';
    
    el.appendChild(header);
    el.appendChild(body);
    
    this.element = el;
    return el;
  }

  connect(dest) {
    if (this.node && dest.node) {
      this.node.connect(dest.node);
      this.isConnected = true;
    }
  }

  disconnect() {
    if (this.node) {
      this.node.disconnect();
      this.isConnected = false;
    }
  }

  dispose() {
    this.disconnect();
    if (this.node && this.node.stop) {
      try { this.node.stop(); } catch(e) {}
    }
  }
}
