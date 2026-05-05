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
    const x = e.clientX - rack.getBoundingClientRect().left;
    const y = e.clientY - rack.getBoundingClientRect().top;
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
    comp.element.style.left = (x - 100) + 'px';
    comp.element.style.top = (y - 60) + 'px';
    makeDraggable(comp.element);
  }

  function makeDraggable(el) {
    let isDragging = false;
    let offsetX = 0, offsetY = 0;

    el.addEventListener('mousedown', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.closest('svg')) return;
      isDragging = true;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      el.style.zIndex = 1000;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const rackRect = rack.getBoundingClientRect();
      let x = e.clientX - rackRect.left - offsetX;
      let y = e.clientY - rackRect.top - offsetY;
      x = Math.max(0, Math.min(x, rackRect.width - el.offsetWidth));
      y = Math.max(0, Math.min(y, rackRect.height - el.offsetHeight));
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      drawConnections();
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        el.style.zIndex = '';
        isDragging = false;
      }
    });
  }

  function drawConnections() {
    const svgEl = document.getElementById('connectionsSvg');
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    
    // Draw active connection point
    document.querySelectorAll('.conn-point').forEach(pt => {
      if (pt.classList.contains('active')) {
        const rect = pt.getBoundingClientRect();
        const rackRect = rack.getBoundingClientRect();
        const x = rect.left - rackRect.left + rect.width/2;
        const y = rect.top - rackRect.top + rect.height/2;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', 4);
        circle.setAttribute('fill', '#4af74a');
        svgEl.appendChild(circle);
      }
    });
  }

  // Default connection: osc1 -> filter -> adsr -> effects -> master
  // (if components exist)
  function setupDefaultConnection() {
    if (components.osc1 && components.filter && components.adsr && components.effects) {
      components.osc1.connect(components.filter);
      components.filter.connectInput(components.osc1);
      components.adsr.connectInput(components.filter);
      components.effects.connectInput(components.adsr);
      components.effects.connect({ node: masterGain });
    }
  }

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

  // Create default components for testing
  createComponent('oscillator', 'osc1', 50, 50);
  createComponent('filter', 'filter', 270, 50);
  createComponent('adsr', 'adsr', 490, 50);
  createComponent('effects', 'effects', 50, 220);
  setupDefaultConnection();
})();
