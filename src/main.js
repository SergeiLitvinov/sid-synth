import { OscillatorComponent } from './components/OscillatorComponent.js';
import { FilterComponent } from './components/FilterComponent.js';
import { AdsrComponent } from './components/AdsrComponent.js';
import { EffectsComponent } from './components/EffectsComponent.js';

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

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  masterGain.connect(analyser);

  const analyserFreq = ctx.createAnalyser();
  analyserFreq.fftSize = 2048;
  masterGain.connect(analyserFreq);

  const rack = document.getElementById('rack');
  const components = {};

  // Create components
  components.osc1 = new OscillatorComponent(ctx, 1);
  rack.appendChild(components.osc1.element);

  components.filter = new FilterComponent(ctx);
  rack.appendChild(components.filter.element);

  components.adsr = new AdsrComponent(ctx);
  rack.appendChild(components.adsr.element);

  components.effects = new EffectsComponent(ctx);
  rack.appendChild(components.effects.element);

  // Connect audio chain: osc1 -> filter -> adsr -> effects -> master
  // Osc1 output to Filter input
  components.osc1.outputGain.connect(components.filter.inputGain);
  // Filter output to ADSR input
  components.filter.node.connect(components.adsr.inputGain);
  // ADSR output to Effects input
  components.adsr.node.connect(components.effects.inputGain);
  // Effects output to master
  components.effects.node.connect(masterGain);

  console.log('Audio chain connected');

  // Keyboard
  const kb = document.getElementById('keyboard');
  Object.keys(NOTES).forEach(n => {
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
    components.osc1.frequency = NOTES[note] || 440;
    components.osc1.update();
    components.adsr.triggerAttack();
    document.getElementById('noteDisplay').textContent = note;
    isPlaying = true;
  }

  function stopAll() {
    components.adsr.triggerRelease();
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
