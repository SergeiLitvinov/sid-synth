import { Adsr } from './envelope/adshr.js';
import { create as createOsc } from './oscillator/index.js';
import { create as createFilter } from './filter/index.js';
import { Lfo, Pwm, RingMod, HardSync } from './modulator/index.js';
import { PatternSequencer } from './sequencer/pattern.js';
import { Delay, Reverb } from './effects/index.js';

console.log('SID Synth loaded');

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

  let activeNodes = [];
  let currentAdsr = null;
  let arpTimer = null;
  let isPlaying = false;
  let lfo = null;
  let pwm = null;
  let ringMod = null;
  let hardSync = null;
  let delay = null;
  let reverb = null;

  function stopAll() {
    activeNodes.forEach(n => { try { if (n && n.stop) n.stop(); if (n && n.disconnect) n.disconnect(); } catch(e) {} });
    activeNodes = [];
    if (currentAdsr) { try { currentAdsr.dispose(); } catch(e) {} currentAdsr = null; }
    if (lfo) { lfo.dispose(); lfo = null; }
    if (pwm) { pwm.dispose(); pwm = null; }
    if (ringMod) { ringMod.dispose(); ringMod = null; }
    if (hardSync) { hardSync = null; }
    if (delay) { delay.disconnect(); delay = null; }
    if (reverb) { reverb.disconnect(); reverb = null; }
    if (arpTimer) { clearInterval(arpTimer); arpTimer = null; }
    isPlaying = false;
    document.getElementById('noteDisplay').textContent = '_';
    document.querySelectorAll('.seq-step').forEach(el => el.classList.remove('playing'));
    document.querySelectorAll('.osc-unit').forEach(el => el.classList.remove('active'));
  }

  function playNote(note, duration = 0.5) {
    if (ctx.state === 'suspended') ctx.resume();
    const freq = NOTES[note] || 440;

    const adsr = new Adsr(ctx, {
      attack: +document.getElementById('attack')?.value || 0.05,
      decay: +document.getElementById('decay')?.value || 0.2,
      sustain: +document.getElementById('sustain')?.value || 0.6,
      release: +document.getElementById('release')?.value || 0.25
    });
    currentAdsr = adsr;

    const filterNode = createFilter(
      document.getElementById('filterType')?.value || 'lowpass',
      +document.getElementById('filterFreq')?.value || 2000,
      +document.getElementById('filterRes')?.value || 1
    );

    const nodes = [];
    const oscNodes = [];
    const osc1On = document.getElementById('osc1On')?.checked;
    const osc2On = document.getElementById('osc2On')?.checked;
    const osc3On = document.getElementById('osc3On')?.checked;

    let o1, o2, o3;

    if (osc1On) {
      o1 = createOsc(document.getElementById('waveform1')?.value || 'sawtooth', freq);
      oscNodes.push(o1);
      document.getElementById('osc1')?.classList.add('active');
    }
    if (osc2On) {
      const detune = +document.getElementById('freq2')?.value || freq * 2;
      o2 = createOsc(document.getElementById('waveform2')?.value || 'sawtooth', detune);
      oscNodes.push(o2);
      document.getElementById('osc2')?.classList.add('active');
    }
    if (osc3On) {
      const detune = +document.getElementById('freq3')?.value || freq * 3;
      o3 = createOsc(document.getElementById('waveform3')?.value || 'sawtooth', detune);
      oscNodes.push(o3);
      document.getElementById('osc3')?.classList.add('active');
    }

    if (oscNodes.length === 0) { adsr.dispose(); return; }

    // LFO модуляция фильтра
    let lfoNode = null;
    if (document.getElementById('lfoOn')?.checked) {
      lfo = new Lfo(ctx, { type: document.getElementById('lfoType')?.value || 'sine', rate: +document.getElementById('lfoRate')?.value || 1, depth: +document.getElementById('lfoDepth')?.value || 50 });
      lfo.connect(filterNode.frequency);
      lfoNode = lfo;
    }

    // PWM для square осциллятора
    let pwmNode = null;
    if (document.getElementById('pwmOn')?.checked && o1 && document.getElementById('waveform1')?.value === 'square') {
      pwm = new Pwm(ctx, { rate: +document.getElementById('pwmRate')?.value || 1, depth: +document.getElementById('pwmDepth')?.value || 0.5 });
      pwm.connectSquareOsc(o1);
      pwmNode = pwm;
    }

    // Ring Mod - подключаем через спец. цепь
    let ringNode = null;
    if (document.getElementById('ringModOn')?.checked && o1 && o2) {
      ringMod = new RingMod(ctx);
      const ringOutput = ringMod.connect(o1, o2);
      o1.disconnect(); o2.disconnect();
      ringOutput.connect(filterNode);
      ringNode = ringMod;
    } else {
      oscNodes.forEach(o => { try { o.connect(filterNode); } catch(e) {} });
    }

    // Hard Sync
    if (document.getElementById('hardSyncOn')?.checked && o1 && o2) {
      hardSync = new HardSync(ctx);
      hardSync.connect(o1, o2);
    }

    // Effects
    let lastNode = filterNode;
    let delayNode = null;
    let reverbNode = null;

    if (document.getElementById('delayOn')?.checked) {
      delay = new Delay(ctx, {
        time: +document.getElementById('delayTime')?.value || 0.3,
        feedback: +document.getElementById('delayFeedback')?.value || 0.4
      });
      lastNode.connect(delay.input);
      lastNode = delay;
      delayNode = delay;
    }

    if (document.getElementById('reverbOn')?.checked) {
      reverb = new Reverb(ctx, {
        duration: +document.getElementById('reverbDuration')?.value || 2.0,
        decay: +document.getElementById('reverbDecay')?.value || 0.5
      });
      lastNode.connect(reverb.input);
      lastNode = reverb;
      reverbNode = reverb;
    }

    lastNode.connect(adsr.gain);
    adsr.connect(masterGain);

    oscNodes.forEach(o => { try { o.start(); } catch(e) {} });
    adsr.triggerAttack();

    activeNodes = [...oscNodes, filterNode, adsr, lfoNode, pwmNode, ringNode, delayNode, reverbNode].filter(Boolean);

    document.getElementById('noteDisplay').textContent = note;

    setTimeout(() => {
      adsr.triggerRelease();
      setTimeout(() => {
        oscNodes.forEach(o => { try { o.stop(); } catch(e) {} });
      }, (+document.getElementById('release')?.value || 0.25) * 1000 + 50);
    }, duration * 1000);
  }

  function startArp(base) {
    stopAll();
    isPlaying = true;
    let idx = 0;
    const speed = +document.getElementById('arpSpeed')?.value || 100;
    const pattern = document.getElementById('arpPattern')?.value || 'up';
    const noteKeys = Object.keys(NOTES);
    const baseIdx = noteKeys.indexOf(base);

    const tick = () => {
      let n;
      if (pattern === 'up') n = noteKeys[(baseIdx + idx) % noteKeys.length];
      else if (pattern === 'down') n = noteKeys[(noteKeys.length - 1 - ((baseIdx + idx) % noteKeys.length))];
      else n = noteKeys[Math.floor(Math.random() * noteKeys.length)];
      playNote(n, speed / 1000 * 0.8);
      idx++;
    };
    tick();
    arpTimer = setInterval(tick, speed);
  }

  const seqPat = Array(16).fill(null);
  const seq = new PatternSequencer(ctx);
  seq.onStep = (step, note) => {
    document.querySelectorAll('.seq-step').forEach(el => el.classList.remove('playing'));
    const el = document.querySelector(`.seq-step[data-step="${step}"]`);
    if (el) el.classList.add('playing');
    if (note) playNote(note, (60 / seq.bpm / 4) * 0.8);
  };

  function startSeq() {
    stopAll();
    seq.setBpm(+document.getElementById('seqBPM')?.value || 120);
    seq.setPattern(seqPat);
    seq.start();
    isPlaying = true;
  }

  const PRESETS = {
    bass: { osc1: true, osc2: false, osc3: false, wave1: 'sawtooth', freq1: 110, filter: 800, res: 5, a: 0.01, d: 0.2, s: 0.4, r: 0.1 },
    lead: { osc1: true, osc2: true, osc3: false, wave1: 'square', wave2: 'sawtooth', freq1: 440, freq2: 440, filter: 3000, res: 2, a: 0.05, d: 0.1, s: 0.7, r: 0.2 },
    pad: { osc1: true, osc2: true, osc3: false, wave1: 'triangle', wave2: 'triangle', freq1: 220, freq2: 222, filter: 1500, res: 0, a: 0.5, d: 0.5, s: 0.8, r: 1.0 },
    drum: { osc1: true, osc2: true, osc3: false, wave1: 'square', wave2: 'sawtooth', freq1: 100, freq2: 100, filter: 500, res: 8, a: 0.01, d: 0.3, s: 0.1, r: 0.1 }
  };

  function loadPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    document.getElementById('osc1On').checked = p.osc1;
    document.getElementById('osc2On').checked = p.osc2;
    document.getElementById('osc3On').checked = p.osc3 || false;
    document.getElementById('waveform1').value = p.wave1;
    document.getElementById('waveform2').value = p.wave2 || 'sawtooth';
    document.getElementById('freq1').value = p.freq1;
    document.getElementById('freq2').value = p.freq2 || 440;
    document.getElementById('freq3').value = 440;
    document.getElementById('filterFreq').value = p.filter;
    document.getElementById('filterRes').value = p.res;
    document.getElementById('attack').value = p.a;
    document.getElementById('decay').value = p.d;
    document.getElementById('sustain').value = p.s;
    document.getElementById('release').value = p.r;
  }
  document.querySelectorAll('.preset').forEach(b => b.onclick = () => loadPreset(b.dataset.preset));

  function getCurrentSettings() {
    return {
      osc1On: document.getElementById('osc1On')?.checked,
      osc2On: document.getElementById('osc2On')?.checked,
      osc3On: document.getElementById('osc3On')?.checked,
      wave1: document.getElementById('waveform1')?.value,
      wave2: document.getElementById('waveform2')?.value,
      wave3: document.getElementById('waveform3')?.value,
      freq1: document.getElementById('freq1')?.value,
      freq2: document.getElementById('freq2')?.value,
      freq3: document.getElementById('freq3')?.value,
      filterType: document.getElementById('filterType')?.value,
      filterFreq: document.getElementById('filterFreq')?.value,
      filterRes: document.getElementById('filterRes')?.value,
      attack: document.getElementById('attack')?.value,
      decay: document.getElementById('decay')?.value,
      sustain: document.getElementById('sustain')?.value,
      release: document.getElementById('release')?.value,
      lfoOn: document.getElementById('lfoOn')?.checked,
      lfoType: document.getElementById('lfoType')?.value,
      lfoRate: document.getElementById('lfoRate')?.value,
      lfoDepth: document.getElementById('lfoDepth')?.value,
      pwmOn: document.getElementById('pwmOn')?.checked,
      pwmRate: document.getElementById('pwmRate')?.value,
      pwmDepth: document.getElementById('pwmDepth')?.value,
      ringModOn: document.getElementById('ringModOn')?.checked,
      hardSyncOn: document.getElementById('hardSyncOn')?.checked,
      delayOn: document.getElementById('delayOn')?.checked,
      delayTime: document.getElementById('delayTime')?.value,
      delayFeedback: document.getElementById('delayFeedback')?.value,
      reverbOn: document.getElementById('reverbOn')?.checked,
      reverbDuration: document.getElementById('reverbDuration')?.value,
      reverbDecay: document.getElementById('reverbDecay')?.value
    };
  }

  function applySettings(s) {
    if (s.osc1On !== undefined) document.getElementById('osc1On').checked = s.osc1On;
    if (s.osc2On !== undefined) document.getElementById('osc2On').checked = s.osc2On;
    if (s.osc3On !== undefined) document.getElementById('osc3On').checked = s.osc3On;
    if (s.wave1) document.getElementById('waveform1').value = s.wave1;
    if (s.wave2) document.getElementById('waveform2').value = s.wave2;
    if (s.wave3) document.getElementById('waveform3').value = s.wave3;
    if (s.freq1) document.getElementById('freq1').value = s.freq1;
    if (s.freq2) document.getElementById('freq2').value = s.freq2;
    if (s.freq3) document.getElementById('freq3').value = s.freq3;
    if (s.filterType) document.getElementById('filterType').value = s.filterType;
    if (s.filterFreq) document.getElementById('filterFreq').value = s.filterFreq;
    if (s.filterRes) document.getElementById('filterRes').value = s.filterRes;
    if (s.attack) document.getElementById('attack').value = s.attack;
    if (s.decay) document.getElementById('decay').value = s.decay;
    if (s.sustain) document.getElementById('sustain').value = s.sustain;
    if (s.release) document.getElementById('release').value = s.release;
    if (s.lfoOn !== undefined) document.getElementById('lfoOn').checked = s.lfoOn;
    if (s.lfoType) document.getElementById('lfoType').value = s.lfoType;
    if (s.lfoRate) document.getElementById('lfoRate').value = s.lfoRate;
    if (s.lfoDepth) document.getElementById('lfoDepth').value = s.lfoDepth;
    if (s.pwmOn !== undefined) document.getElementById('pwmOn').checked = s.pwmOn;
    if (s.pwmRate) document.getElementById('pwmRate').value = s.pwmRate;
    if (s.pwmDepth) document.getElementById('pwmDepth').value = s.pwmDepth;
    if (s.ringModOn !== undefined) document.getElementById('ringModOn').checked = s.ringModOn;
    if (s.hardSyncOn !== undefined) document.getElementById('hardSyncOn').checked = s.hardSyncOn;
    if (s.delayOn !== undefined) document.getElementById('delayOn').checked = s.delayOn;
    if (s.delayTime) document.getElementById('delayTime').value = s.delayTime;
    if (s.delayFeedback) document.getElementById('delayFeedback').value = s.delayFeedback;
    if (s.reverbOn !== undefined) document.getElementById('reverbOn').checked = s.reverbOn;
    if (s.reverbDuration) document.getElementById('reverbDuration').value = s.reverbDuration;
    if (s.reverbDecay) document.getElementById('reverbDecay').value = s.reverbDecay;
  }

  function updatePresetList() {
    const sel = document.getElementById('presetList');
    sel.innerHTML = '';
    const presets = JSON.parse(localStorage.getItem('sidPresets') || '{}');
    Object.keys(presets).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }
  updatePresetList();

  document.getElementById('savePreset').onclick = () => {
    const name = prompt('Preset name:');
    if (!name) return;
    const presets = JSON.parse(localStorage.getItem('sidPresets') || '{}');
    presets[name] = getCurrentSettings();
    localStorage.setItem('sidPresets', JSON.stringify(presets));
    updatePresetList();
    document.getElementById('presetList').value = name;
  };

  document.getElementById('loadPreset').onclick = () => {
    const name = document.getElementById('presetList').value;
    if (!name) return;
    const presets = JSON.parse(localStorage.getItem('sidPresets') || '{}');
    if (presets[name]) applySettings(presets[name]);
  };

  document.getElementById('deletePreset').onclick = () => {
    const name = document.getElementById('presetList').value;
    if (!name) return;
    const presets = JSON.parse(localStorage.getItem('sidPresets') || '{}');
    delete presets[name];
    localStorage.setItem('sidPresets', JSON.stringify(presets));
    updatePresetList();
  };

  const kb = document.getElementById('keyboard');
  NOTE_NAMES.forEach(n => {
    const k = document.createElement('div');
    k.className = 'key';
    k.textContent = n;
    k.style.width = n.includes('#') ? '28px' : '38px';
    k.style.height = n.includes('#') ? '40px' : '65px';
    k.style.fontSize = '10px';
    k.style.display = 'flex';
    k.style.alignItems = 'flex-end';
    k.style.justifyContent = 'center';
    k.style.paddingBottom = '4px';
    if (n.includes('#')) {
      k.style.position = 'relative';
      k.style.zIndex = '1';
      k.style.marginLeft = '-14px';
      k.style.marginRight = '-14px';
      k.style.background = '#1a1a1a';
      k.style.borderColor = '#4af74a';
    }
    k.onmousedown = () => {
      if (ctx.state === 'suspended') ctx.resume();
      if (document.getElementById('arpOn')?.checked) startArp(n);
      else playNote(n);
    };
    k.onmouseup = () => { if (!isPlaying) stopAll(); };
    k.onmouseleave = () => { if (!isPlaying) stopAll(); };
    kb.appendChild(k);
  });

  document.onkeydown = e => {
    if (e.repeat || e.target.tagName === 'INPUT') return;
    const n = KEY_MAP[e.key.toLowerCase()];
    if (n) {
      e.preventDefault();
      if (ctx.state === 'suspended') ctx.resume();
      if (document.getElementById('arpOn')?.checked) startArp(n);
      else playNote(n);
    }
  };
  document.onkeyup = e => { if (!isPlaying) stopAll(); };

  document.getElementById('play').onclick = () => { if (ctx.state === 'suspended') ctx.resume(); playNote('C'); };

  // MIDI support
  if (navigator.requestMIDIAccess) {
    document.getElementById('midiConnect').onclick = async () => {
      try {
        const midi = await navigator.requestMIDIAccess();
        const inputs = midi.inputs.values();
        for (const input of inputs) {
          input.onmidimessage = handleMidiMessage;
        }
        midi.onstatechange = () => {
          const status = document.getElementById('midiStatus');
          status.textContent = 'MIDI: ' + (midi.inputs.size > 0 ? 'CONNECTED' : 'DISCONNECTED');
        };
        document.getElementById('midiStatus').textContent = 'MIDI: ' + (midi.inputs.size > 0 ? 'CONNECTED' : 'NO DEVICE');
      } catch(e) {
        document.getElementById('midiStatus').textContent = 'MIDI: ERROR';
        console.error('MIDI error:', e);
      }
    };
  } else {
    document.getElementById('midiConnect').disabled = true;
    document.getElementById('midiStatus').textContent = 'MIDI: NOT SUPPORTED';
  }

  function midiNoteToName(midiNote) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midiNote / 12) - 1;
    const name = names[midiNote % 12];
    return name + octave;
  }

  function handleMidiMessage(event) {
    const [cmd, note, vel] = event.data;
    const noteName = midiNoteToName(note);

    if (cmd === 144 && vel > 0) { // Note on
      if (ctx.state === 'suspended') ctx.resume();
      if (document.getElementById('arpOn')?.checked) startArp(noteName);
      else playNote(noteName);
    } else if (cmd === 128 || (cmd === 144 && vel === 0)) { // Note off
      if (!isPlaying) stopAll();
    }
  }
  document.getElementById('seqPlay').onclick = startSeq;
  document.getElementById('seqStop').onclick = stopAll;

  // Sequence export/import
  document.getElementById('exportSeq').onclick = () => {
    const data = { pattern: seqPat, bpm: +document.getElementById('seqBPM')?.value || 120 };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sequence.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('importSeq').onclick = () => {
    document.getElementById('seqFile').click();
  };

  document.getElementById('seqFile').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.pattern && Array.isArray(data.pattern)) {
          for (let i = 0; i < 16; i++) {
            seqPat[i] = data.pattern[i] || null;
            const el = document.querySelector(`.seq-step[data-step="${i}"]`);
            if (el) {
              if (seqPat[i]) { el.classList.add('active'); el.textContent = seqPat[i].charAt(0); }
              else { el.classList.remove('active'); el.textContent = i + 1; }
            }
          }
        }
        if (data.bpm) document.getElementById('seqBPM').value = data.bpm;
      } catch(err) { console.error('Import error:', err); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const grid = document.getElementById('seqGrid');
  for (let i = 0; i < 16; i++) {
    const step = document.createElement('div');
    step.className = 'seq-step';
    step.dataset.step = i;
    step.textContent = i + 1;
    step.onclick = () => {
      step.classList.toggle('active');
      if (step.classList.contains('active')) {
        const n = prompt('Note (C,D,E,F,G,A,B or with #):', 'C');
        if (n && NOTES[n.toUpperCase()]) { seqPat[i] = n.toUpperCase(); step.textContent = n.toUpperCase().charAt(0); }
      } else { seqPat[i] = null; step.textContent = i + 1; }
    };
    grid.appendChild(step);
  }

  function draw() {
    requestAnimationFrame(draw);

    // Oscilloscope
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    const w = canvas.width, h = canvas.height;

    cvs.fillStyle = '#000000';
    cvs.fillRect(0, 0, w, h);

    cvs.strokeStyle = '#0a150a';
    for (let i = 0; i < w; i += 5) { cvs.beginPath(); cvs.moveTo(i, 0); cvs.lineTo(i, h); cvs.stroke(); }
    for (let i = 0; i < h; i += 5) { cvs.beginPath(); cvs.moveTo(0, i); cvs.lineTo(w, i); cvs.stroke(); }

    cvs.strokeStyle = '#0f1a0f';
    for (let i = 0; i < w; i += 20) { cvs.beginPath(); cvs.moveTo(i, 0); cvs.lineTo(i, h); cvs.stroke(); }
    for (let i = 0; i < h; i += 20) { cvs.beginPath(); cvs.moveTo(0, i); cvs.lineTo(w, i); cvs.stroke(); }

    cvs.strokeStyle = '#1a2a1a';
    cvs.lineWidth = 2;
    cvs.beginPath(); cvs.moveTo(0, h/2); cvs.lineTo(w, h/2); cvs.stroke();

    cvs.strokeStyle = '#4af74a';
    cvs.lineWidth = 4;
    cvs.shadowColor = '#4af74a';
    cvs.shadowBlur = 25;
    cvs.beginPath();
    const sliceW = w / data.length;
    for (let i = 0; i < data.length; i++) {
      const y = (data[i] / 128) * h / 2;
      if (i === 0) cvs.moveTo(0, y);
      else cvs.lineTo(i * sliceW, y);
    }
    cvs.stroke();

    cvs.strokeStyle = '#8afa8a';
    cvs.lineWidth = 2;
    cvs.shadowBlur = 0;
    cvs.beginPath();
    for (let i = 0; i < data.length; i++) {
      const y = (data[i] / 128) * h / 2;
      if (i === 0) cvs.moveTo(0, y);
      else cvs.lineTo(i * sliceW, y);
    }
    cvs.stroke();

    cvs.strokeStyle = '#caffca';
    cvs.lineWidth = 1;
    cvs.beginPath();
    for (let i = 0; i < data.length; i++) {
      const y = (data[i] / 128) * h / 2;
      if (i === 0) cvs.moveTo(0, y);
      else cvs.lineTo(i * sliceW, y);
    }
    cvs.stroke();

    // Spectroscope
    const freqData = new Uint8Array(analyserFreq.frequencyBinCount);
    analyserFreq.getByteFrequencyData(freqData);
    const sw = specCanvas.width, sh = specCanvas.height;

    specCvs.fillStyle = '#000000';
    specCvs.fillRect(0, 0, sw, sh);

    const barWidth = (sw / freqData.length) * 2;
    let barX = 0;

    for (let i = 0; i < freqData.length; i++) {
      const barHeight = (freqData[i] / 255) * sh;
      const hue = (i / freqData.length) * 120 + 80;
      specCvs.fillStyle = `hsl(${hue}, 70%, 50%)`;
      specCvs.fillRect(barX, sh - barHeight, barWidth, barHeight);
      barX += barWidth + 1;
    }
  }
  draw();
})();
