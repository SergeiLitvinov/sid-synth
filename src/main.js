import { OscillatorComponent } from './components/index.js';
import { FilterComponent } from './components/index.js';
import { AdsrComponent } from './components/index.js';
import { LfoComponent } from './components/index.js';
import { EffectsComponent } from './components/index.js';
import { PatternSequencer } from './sequencer/pattern.js';

console.log('SID Synth Modular loaded');

const NOTES = { 'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13, 'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00, 'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88 };
const KEY_MAP = { 'a': 'C', 'w': 'C#', 's': 'D', 'e': 'D#', 'd': 'E', 'f': 'F', 't': 'F#', 'g': 'G', 'y': 'G#', 'h': 'A', 'u': 'A#', 'j': 'B' };
const NOTE_NAMES = Object.keys(NOTES);

(async () => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.7;
  masterGain.connect(ctx.destination);

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

  // Create components with initial positions
  const positions = [
    { id: 'osc1', x: 10, y: 10 },
    { id: 'osc2', x: 220, y: 10 },
    { id: 'osc3', x: 430, y: 10 },
    { id: 'filter', x: 10, y: 150 },
    { id: 'adsr', x: 220, y: 150 },
    { id: 'lfo', x: 430, y: 150 },
    { id: 'effects', x: 10, y: 290 }
  ];

  const compList = [
    { id: 'osc1', comp: new OscillatorComponent(ctx, 1) },
    { id: 'osc2', comp: new OscillatorComponent(ctx, 2) },
    { id: 'osc3', comp: new OscillatorComponent(ctx, 3) },
    { id: 'filter', comp: new FilterComponent(ctx) },
    { id: 'adsr', comp: new AdsrComponent(ctx) },
    { id: 'lfo', comp: new LfoComponent(ctx) },
    { id: 'effects', comp: new EffectsComponent(ctx) }
  ];

  compList.forEach(({ id, comp }) => {
    components[id] = comp;
    rack.appendChild(comp.element);
    const pos = positions.find(p => p.id === id);
    if (pos) {
      comp.element.style.left = pos.x + 'px';
      comp.element.style.top = pos.y + 'px';
    }
  });

  // Drag functionality
  let draggedComp = null;
  let offsetX = 0, offsetY = 0;

  document.querySelectorAll('.component').forEach(el => {
    el.onmousedown = (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'SVG') return;
      draggedComp = el;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      el.style.zIndex = 1000;
      e.preventDefault();
    };
  });

  document.onmousemove = (e) => {
    if (!draggedComp) return;
    const rackRect = rack.getBoundingClientRect();
    let x = e.clientX - rackRect.left - offsetX;
    let y = e.clientY - rackRect.top - offsetY;
    x = Math.max(0, Math.min(x, rackRect.width - draggedComp.offsetWidth));
    y = Math.max(0, Math.min(y, rackRect.height - draggedComp.offsetHeight));
    draggedComp.style.left = x + 'px';
    draggedComp.style.top = y + 'px';
    drawConnections();
  };

  document.onmouseup = () => {
    if (draggedComp) {
      draggedComp.style.zIndex = '';
      draggedComp = null;
    }
  };

  // Default connection: osc1 -> filter -> adsr -> effects -> master
  osc1.connect(filter);
  filter.connect(adsr);
  adsr.connect(effects);
  effects.connect({ node: masterGain });

  // Connection UI
  let connectionMode = false;
  let connectionFrom = null;
  const svgEl = document.getElementById('connectionsSvg');

  function drawConnections() {
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
    // Draw connections between components (simplified - just show output to input)
    const connectedPairs = [
      ['osc1', 'filter'],
      ['filter', 'adsr'],
      ['adsr', 'effects'],
      ['effects', 'master']
    ];
    connectedPairs.forEach(([fromId, toId]) => {
      const fromEl = document.querySelector(`[data-id="${fromId}"].conn-output`);
      const toEl = document.querySelector(`[data-id="${toId}"].conn-input`);
      if (fromEl && toEl) {
        const r1 = fromEl.getBoundingClientRect();
        const r2 = toEl.getBoundingClientRect();
        const rackRect = rack.getBoundingClientRect();
        const x1 = r1.left - rackRect.left + r1.width/2;
        const y1 = r1.top - rackRect.top + r1.height/2;
        const x2 = r2.left - rackRect.left + r2.width/2;
        const y2 = r2.top - rackRect.top + r2.height/2;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', '#4af74a');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('opacity', '0.7');
        svgEl.appendChild(line);
      }
    });
  }

  document.querySelectorAll('.conn-point').forEach(pt => {
    pt.onclick = () => {
      if (!connectionMode) {
        connectionMode = true;
        connectionFrom = pt;
        pt.classList.add('active');
        drawConnections();
      } else {
        if (connectionFrom && connectionFrom !== pt) {
          const fromId = connectionFrom.dataset.id;
          const toId = pt.dataset.id;
          if (fromId && toId && components[fromId] && components[toId]) {
            components[fromId].connect(components[toId]);
          }
        }
        connectionFrom?.classList.remove('active');
        connectionMode = false;
        connectionFrom = null;
        drawConnections();
      }
    };
  });

  // Keyboard and controls
  const kb = document.getElementById('keyboard');
  NOTE_NAMES.forEach(n => {
    const k = document.createElement('div');
    k.className = 'key' + (n.includes('#') ? ' sharp' : '');
    k.textContent = n;
    k.onmousedown = () => {
      if (ctx.state === 'suspended') ctx.resume();
      playNote(n);
    };
    k.onmouseup = () => stopAll();
    k.onmouseleave = () => { if (!isPlaying) stopAll(); };
    kb.appendChild(k);
  });

  let isPlaying = false;

  function playNote(note) {
    if (ctx.state === 'suspended') ctx.resume();
    osc1.frequency = NOTES[note] || 440;
    osc1.update();
    adsr.triggerAttack();
    document.getElementById('noteDisplay').textContent = note;
    isPlaying = true;
  }

  function stopAll() {
    adsr.triggerRelease();
    document.getElementById('noteDisplay').textContent = '_';
    isPlaying = false;
  }

  document.getElementById('play').onclick = () => { if (ctx.state === 'suspended') ctx.resume(); playNote('C'); };

  // Presets
  const PRESETS = {
    bass: { osc1: { on: true, wave: 'sawtooth', freq: 110 }, filter: { type: 'lowpass', freq: 800, q: 5 }, adsr: { a: 0.01, d: 0.2, s: 0.4, r: 0.1 } },
    lead: { osc1: { on: true, wave: 'square', freq: 440 }, filter: { type: 'lowpass', freq: 3000, q: 2 }, adsr: { a: 0.05, d: 0.1, s: 0.7, r: 0.2 } }
  };

  document.querySelectorAll('.preset-btn').forEach(b => {
    if (b.dataset.preset) {
      b.onclick = () => {
        const p = PRESETS[b.dataset.preset];
        if (!p) return;
        if (p.osc1) {
          osc1.isOn = p.osc1.on;
          osc1.waveform = p.osc1.wave;
          osc1.frequency = p.osc1.freq;
          osc1.update();
        }
        if (p.filter) {
          filter.filterType = p.filter.type;
          filter.frequency = p.filter.freq;
          filter.Q = p.filter.q;
          filter.update();
        }
        if (p.adsr) {
          adsr.attack = p.adsr.a;
          adsr.decay = p.adsr.d;
          adsr.sustain = p.adsr.s;
          adsr.release = p.adsr.r;
          adsr.adsr.setParams({ attack: p.adsr.a, decay: p.adsr.d, sustain: p.adsr.s, release: p.adsr.r });
        }
      };
    }
  });

  // Patch save/load
  document.getElementById('savePatch').onclick = () => {
    const patch = {
      components: {
        osc1: { isOn: osc1.isOn, waveform: osc1.waveform, frequency: osc1.frequency },
        osc2: { isOn: osc2.isOn, waveform: osc2.waveform, frequency: osc2.frequency },
        osc3: { isOn: osc3.isOn, waveform: osc3.waveform, frequency: osc3.frequency },
        filter: { filterType: filter.filterType, frequency: filter.frequency, Q: filter.Q },
        adsr: { attack: adsr.attack, decay: adsr.decay, sustain: adsr.sustain, release: adsr.release },
        lfo: { rate: lfo.rate, depth: lfo.depth, waveType: lfo.waveType },
        effects: { delayOn: effects.delayOn, reverbOn: effects.reverbOn, delayTime: effects.delayTime, reverbDuration: effects.reverbDuration }
      },
      connections: [
        { from: 'osc1', to: 'filter' },
        { from: 'filter', to: 'adsr' },
        { from: 'adsr', to: 'effects' },
        { from: 'effects', to: 'master' }
      ]
    };
    const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'patch.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('loadPatch').onclick = () => {
    document.getElementById('patchFile').click();
  };

  document.getElementById('patchFile').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const patch = JSON.parse(ev.target.result);
        // Restore components
        if (patch.components.osc1) {
          osc1.isOn = patch.components.osc1.isOn;
          osc1.waveform = patch.components.osc1.waveform;
          osc1.frequency = patch.components.osc1.frequency;
          osc1.update();
        }
        // ... similar for other components
      } catch(err) { console.error('Patch load error:', err); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Visualization
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
      const y = (data[i] / 128) * h / 2;
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
      const barHeight = (freqData[i] / 255) * sh;
      specCvs.fillStyle = `hsl(${(i / freqData.length) * 120 + 80}, 70%, 50%)`;
      specCvs.fillRect(barX, sh - barHeight, barWidth, barHeight);
      barX += barWidth + 1;
    }
  }
  draw();
})();
