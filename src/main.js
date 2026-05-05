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

  // Create components
  const osc1 = new OscillatorComponent(ctx, 1);
  components.osc1 = osc1;
  rack.appendChild(osc1.element);

  const osc2 = new OscillatorComponent(ctx, 2);
  components.osc2 = osc2;
  rack.appendChild(osc2.element);

  const osc3 = new OscillatorComponent(ctx, 3);
  components.osc3 = osc3;
  rack.appendChild(osc3.element);

  const filter = new FilterComponent(ctx);
  components.filter = filter;
  rack.appendChild(filter.element);

  const adsr = new AdsrComponent(ctx);
  components.adsr = adsr;
  rack.appendChild(adsr.element);

  const lfo = new LfoComponent(ctx);
  components.lfo = lfo;
  rack.appendChild(lfo.element);

  const effects = new EffectsComponent(ctx);
  components.effects = effects;
  rack.appendChild(effects.element);

  // Default connection: osc1 -> filter -> adsr -> effects -> master
  osc1.connect(filter);
  filter.connect(adsr);
  adsr.connect(effects);
  effects.connect({ node: masterGain });

  // Connection UI
  let connectionMode = false;
  let connectionFrom = null;

  document.querySelectorAll('.conn-point').forEach(pt => {
    pt.onclick = () => {
      if (!connectionMode) {
        connectionMode = true;
        connectionFrom = pt;
        pt.classList.add('active');
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
  });

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
