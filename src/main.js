import { OscillatorComponent } from './components/OscillatorComponent.js';
import { FilterComponent } from './components/FilterComponent.js';
import { AdsrComponent } from './components/AdsrComponent.js';
import { LfoComponent } from './components/LfoComponent.js';
import { EffectsComponent } from './components/EffectsComponent.js';
import { MixerComponent } from './components/MixerComponent.js';
import { SplitterComponent } from './components/SplitterComponent.js';
import { SequencerComponent } from './components/SequencerComponent.js';

console.log('SID Synth Modular loaded');

const NOTES = { 'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13, 'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00, 'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88 };

(async () => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.7;
  masterGain.connect(ctx.destination);

  // Visualization setup
  const canvas = document.getElementById('oscilloscope');
  const cvs = canvas.getContext('2d');
  canvas.width = window.innerWidth > 800 ? 750 : window.innerWidth - 40;
  canvas.height = 180;

  const specCanvas = document.getElementById('spectroscope');
  const specCvs = specCanvas.getContext('2d');
  specCanvas.width = canvas.width;
  specCanvas.height = 120;

  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth > 800 ? 750 : window.innerWidth - 40;
    specCanvas.width = canvas.width;
  });

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  masterGain.connect(analyser);

  const analyserFreq = ctx.createAnalyser();
  analyserFreq.fftSize = 2048;
  masterGain.connect(analyserFreq);

  const rack = document.getElementById('rack');
  const svgEl = document.getElementById('connectionsSvg');
  const components = {};
  let componentId = 0;

  // Tool items drag start
  document.querySelectorAll('.tool-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('type', item.dataset.type);
      e.dataTransfer.setData('id', item.dataset.id || '');
    });
    item.draggable = true;
  });

  // Rack drop zone
  rack.addEventListener('dragover', e => {
    e.preventDefault();
    rack.style.borderColor = '#4af74a';
  });

  rack.addEventListener('dragleave', () => {
    rack.style.borderColor = '#1a2a1a';
  });

  rack.addEventListener('drop', e => {
    e.preventDefault();
    rack.style.borderColor = '#1a2a1a';
    const type = e.dataTransfer.getData('type');
    const id = e.dataTransfer.getData('id');
    const rect = rack.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    createComponent(type, id, x, y);
  });

  function createComponent(type, id, x, y) {
    let comp;
    const newId = id || `${type}_${++componentId}`;
    
    switch(type) {
      case 'oscillator':
        comp = new OscillatorComponent(ctx, id ? parseInt(id.replace('osc', '')) : 1);
        break;
      case 'filter':
        comp = new FilterComponent(ctx);
        break;
      case 'adsr':
        comp = new AdsrComponent(ctx);
        break;
      case 'effects':
        comp = new EffectsComponent(ctx);
        break;
      case 'lfo':
        comp = new LfoComponent(ctx);
        break;
      case 'mixer':
        comp = new MixerComponent(ctx);
        break;
      case 'splitter':
        comp = new SplitterComponent(ctx);
        break;
      case 'sequencer':
        comp = new SequencerComponent(ctx);
        break;
      default:
        return;
    }
    
    components[newId] = comp;
    rack.appendChild(comp.element);
    comp.element.style.left = Math.max(0, x - 100) + 'px';
    comp.element.style.top = Math.max(0, y - 30) + 'px';
    makeDraggable(comp.element);
    labelConnections();
  }

  function makeDraggable(el) {
    let isDragging = false;
    let startX = 0, startY = 0;

    el.addEventListener('mousedown', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.closest('svg')) return;
      isDragging = true;
      startX = e.clientX - el.offsetLeft;
      startY = e.clientY - el.offsetTop;
      el.style.zIndex = 1000;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const rackRect = rack.getBoundingClientRect();
      let x = e.clientX - rackRect.left - startX;
      let y = e.clientY - rackRect.top - startY;
      x = Math.max(0, Math.min(x, rackRect.width - el.offsetWidth));
      y = Math.max(0, Math.min(y, rackRect.height - el.offsetHeight));
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      labelConnections();
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        el.style.zIndex = '';
        isDragging = false;
      }
    });
  }

  function labelConnections() {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    
    Object.keys(components).forEach(fromId => {
      const fromComp = components[fromId];
      if (!fromComp || !fromComp.element) return;
      
      const fromOutput = fromComp.element.querySelector('[data-type="output"]');
      if (!fromOutput) return;
      
      Object.keys(components).forEach(toId => {
        if (toId === fromId) return;
        const toComp = components[toId];
        if (!toComp || !toComp.element) return;
        
        const toInput = toComp.element.querySelector('[data-type="input"]');
        if (!toInput) return;
        
        const r1 = fromOutput.getBoundingClientRect();
        const r2 = toInput.getBoundingClientRect();
        const rackRect = rack.getBoundingClientRect();
        
        const x1 = r1.left - rackRect.left + r1.width/2;
        const y1 = r1.top - rackRect.top + r1.height/2;
        const x2 = r2.left - rackRect.left + r2.width/2;
        const y2 = r2.top - rackRect.top + r2.height/2;
        
        // Draw smooth curve
        const cx = (x1 + x2) / 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#4af74a');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('opacity', '0.7');
        svgEl.appendChild(path);
        
        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', (x1 + x2) / 2);
        label.setAttribute('y', (y1 + y2) / 2 - 5);
        label.setAttribute('fill', '#4af74a');
        label.setAttribute('font-size', '8px');
        label.textContent = `${fromId} → ${toId}`;
        svgEl.appendChild(label);
      });
    });
  }

  // Create default components
  setTimeout(() => {
    createComponent('oscillator', 'osc1', 50, 50);
    createComponent('filter', 'filter', 270, 50);
    createComponent('adsr', 'adsr', 490, 50);
    createComponent('effects', 'effects', 50, 220);
    
    // Connect default chain
    if (components.osc1 && components.filter) {
      components.osc1.connect(components.filter);
      components.filter.connectInput(components.osc1);
    }
    if (components.filter && components.adsr) {
      components.adsr.connectInput(components.filter);
    }
    if (components.adsr && components.effects) {
      components.effects.connectInput(components.adsr);
    }
    if (components.effects) {
      components.effects.connect({ node: masterGain });
    }
    labelConnections();
  }, 100);

  // Keyboard
  const kb = document.getElementById('keyboard');
  Object.keys(NOTES).forEach(n => {
    const k = document.createElement('div');
    k.className = 'key' + (n.includes('#') ? ' sharp' : '');
    k.textContent = n;
    k.addEventListener('mousedown', () => {
      if (ctx.state === 'suspended') ctx.resume();
      playNote(n);
    });
    k.addEventListener('mouseup', () => stopAll());
    k.addEventListener('mouseleave', () => { if (!isPlaying) stopAll(); });
    kb.appendChild(k);
  });

  let isPlaying = false;

  function playNote(note) {
    if (ctx.state === 'suspended') ctx.resume();
    if (components.osc1) {
      components.osc1.frequency = NOTES[note] || 440;
      components.osc1.update();
    }
    if (components.adsr) components.adsr.triggerAttack();
    document.getElementById('noteDisplay').textContent = note;
    isPlaying = true;
  }

  function stopAll() {
    if (components.adsr) components.adsr.triggerRelease();
    document.getElementById('noteDisplay').textContent = '_';
    isPlaying = false;
  }

  document.getElementById('play').onclick = () => {
    if (ctx.state === 'suspended') ctx.resume();
    playNote('C');
  };

  // Visualization loop
  function draw() {
    requestAnimationFrame(draw);
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    const w = canvas.width, h = canvas.height;

    cvs.fillStyle = '#000000';
    cvs.fillRect(0, 0, w, h);

    cvs.strokeStyle = '#4af74a';
    cvs.lineWidth = 2;
    cvs.beginPath();
    const sliceW = w / data.length;
    for (let i = 0; i < data.length; i++) {
      const y = (data[i] / 128.0) * h / 2;
      if (i === 0) cvs.moveTo(0, y);
      else cvs.lineTo(i * sliceW, y);
    }
    cvs.stroke();

    const freqData = new Uint8Array(analyserFreq.frequencyBinCount);
    analyserFreq.getByteFrequencyData(freqData);
    const sw = specCanvas.width, sh = specCanvas.height;
    specCvs.fillStyle = '#000000';
    specCvs.fillRect(0, 0, sw, sh);
    const barWidth = (sw / freqData.length) * 2;
    let barX = 0;
    for (let i = 0; i < freqData.length; i++) {
      const barHeight = (freqData[i] / 255.0) * sh;
      specCvs.fillStyle = `hsl(${((i / freqData.length) * 120 + 80)}, 70%, 50%)`;
      specCvs.fillRect(barX, sh - barHeight, barWidth, barHeight);
      barX += barWidth + 1;
    }
  }
  draw();
})();
