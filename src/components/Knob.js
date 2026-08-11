export class Knob {
  constructor(opts = {}) {
    this.min = opts.min || 0;
    this.max = opts.max || 100;
    this.value = opts.value || 50;
    this.step = opts.step || 1;
    this.label = opts.label || '';
    this.unit = opts.unit || '';
    this.onChange = opts.onChange || (() => {});
    this.size = opts.size || 40;
    this.element = this.createElement();
  }

  createElement() {
    const container = document.createElement('div');
    container.className = 'knob-container';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'knob-svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('width', this.size);
    svg.setAttribute('height', this.size);

    // Background circle
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bg.setAttribute('cx', 50);
    bg.setAttribute('cy', 50);
    bg.setAttribute('r', 45);
    bg.setAttribute('fill', '#050805');
    bg.setAttribute('stroke', '#2a3a2a');
    bg.setAttribute('stroke-width', 2);
    svg.appendChild(bg);

    // Scale marks
    for (let i = 0; i <= 10; i++) {
      const angle = (i / 10) * 270 - 135;
      const rad = angle * Math.PI / 180;
      const x1 = 50 + 38 * Math.cos(rad);
      const y1 = 50 + 38 * Math.sin(rad);
      const x2 = 50 + 42 * Math.cos(rad);
      const y2 = 50 + 42 * Math.sin(rad);
      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      mark.setAttribute('x1', x1);
      mark.setAttribute('y1', y1);
      mark.setAttribute('x2', x2);
      mark.setAttribute('y2', y2);
      mark.setAttribute('stroke', i % 5 === 0 ? '#4af74a' : '#2a3a2a');
      mark.setAttribute('stroke-width', i % 5 === 0 ? 2 : 1);
      svg.appendChild(mark);
    }

    // Indicator
    this.indicator = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.indicator.setAttribute('x1', 50);
    this.indicator.setAttribute('y1', 50);
    this.indicator.setAttribute('x2', 50);
    this.indicator.setAttribute('y2', 15);
    this.indicator.setAttribute('stroke', '#4af74a');
    this.indicator.setAttribute('stroke-width', 2);
    this.indicator.setAttribute('transform-origin', '50 50');
    svg.appendChild(this.indicator);

    this.updateVisual();
    container.appendChild(svg);

    const label = document.createElement('div');
    label.className = 'knob-label';
    label.textContent = this.label;
    container.appendChild(label);

    this.valueDisplay = document.createElement('div');
    this.valueDisplay.className = 'knob-value';
    this.updateValueDisplay();
    container.appendChild(this.valueDisplay);

    // Interaction (pointer capture — auto-cleaned when element is removed)
    let isDragging = false;
    let startY = 0;
    let startValue = 0;
    const self = this;

    svg.addEventListener('pointerdown', (e) => {
      isDragging = true;
      startY = e.clientY;
      startValue = self.value;
      try { svg.setPointerCapture(e.pointerId); } catch(_) {}
      e.preventDefault();
    });

    svg.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const delta = (startY - e.clientY) * 0.5;
      self.setValue(startValue + delta);
    });

    svg.addEventListener('pointerup', () => { isDragging = false; });

    return container;
  }

  setValue(val) {
    this.value = Math.max(this.min, Math.min(this.max, val));
    this.updateVisual();
    this.updateValueDisplay();
    this.onChange(this.value);
  }

  updateVisual() {
    const angle = ((this.value - this.min) / (this.max - this.min)) * 270 - 135;
    this.indicator.setAttribute('transform', `rotate(${angle} 50 50)`);
  }

  updateValueDisplay() {
    this.valueDisplay.textContent = Math.round(this.value * 10) / 10 + this.unit;
  }

  getValue() { return this.value; }
}
