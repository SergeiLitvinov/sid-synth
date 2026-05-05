import { OscillatorComponent } from './components/OscillatorComponent.js';
import { FilterComponent } from './components/FilterComponent.js';
import { AdsrComponent } from './components/AdsrComponent.js';
import { LfoComponent } from './components/LfoComponent.js';
import { EffectsComponent } from './components/EffectsComponent.js';
import { MixerComponent } from './components/MixerComponent.js';
import { SplitterComponent } from './components/SplitterComponent.js';
import { SequencerComponent } from './components/SequencerComponent.js';

console.log('SID Synth Modular loaded');

const NOTES = {
  'C2': 65.41, 'C#2': 69.30, 'D2': 73.42, 'D#2': 77.78, 'E2': 82.41, 'F2': 87.31, 'F#2': 92.50, 'G2': 98.00, 'G#2': 103.83, 'A2': 110.00, 'A#2': 116.54, 'B2': 123.47,
  'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
  'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88
};

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
        comp = new OscillatorComponent(ctx, id ? (parseInt(id.replace('osc', '')) || 1) : 1);
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
    makeDraggable(comp.element, newId);
    
    // Close button handler
    if (comp.closeBtn) {
      comp.closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Remove any connections involving this component
        connections = connections.filter(c => c.from !== newId && c.to !== newId);
        if (comp.outputGain) comp.outputGain.disconnect();
        if (comp.inputGain) comp.inputGain.disconnect();
        comp.dispose();
        comp.element.remove();
        delete components[newId];
        drawConnections();
        initPortClicks();
      });
    }
    
    initPortClicks();
    drawConnections();
  }

  let connections = [];
  let currentConnectionFrom = null;
  let tempLine = null;

  let dragRAF = null;
  let dragState = null;

  function makeDraggable(el, id) {
    let isDragging = false;
    let startX = 0, startY = 0;

    el.addEventListener('mousedown', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.closest('svg') || e.target.classList.contains('close-btn')) return;
      isDragging = true;
      const rect = el.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
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
      if (connections.length && !dragRAF) {
        dragState = { el, id };
        dragRAF = requestAnimationFrame(updateDragConnections);
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        el.style.zIndex = '';
        isDragging = false;
        if (dragRAF) { cancelAnimationFrame(dragRAF); dragRAF = null; }
        dragState = null;
        drawConnections();
      }
    });
  }

  function updateDragConnections() {
    drawConnections();
    if (dragState) {
      dragRAF = requestAnimationFrame(updateDragConnections);
    }
  }

  function drawConnections() {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    
    const rackRect = rack.getBoundingClientRect();
    const masterPort = document.getElementById('masterOutput');
    const masterRect = masterPort ? masterPort.getBoundingClientRect() : null;
    
    connections.forEach((conn, index) => {
      const fromComp = components[conn.from];
      if (!fromComp || !fromComp.element) return;
      
      const fromOutput = fromComp.element.querySelector('[data-type="output"]');
      if (!fromOutput) return;
      const r1 = fromOutput.getBoundingClientRect();
      const x1 = r1.left - rackRect.left + r1.width/2;
      const y1 = r1.top - rackRect.top + r1.height/2;
      
      let x2, y2, toLabel;
      
      if (conn.to === 'master') {
        if (!masterRect) return;
        x2 = masterRect.left - rackRect.left + masterRect.width/2;
        y2 = masterRect.top - rackRect.top + masterRect.height/2;
        toLabel = 'MASTER';
      } else {
        const toComp = components[conn.to];
        if (!toComp || !toComp.element) return;
        const toInput = toComp.element.querySelector('[data-type="input"]');
        if (!toInput) return;
        const r2 = toInput.getBoundingClientRect();
        x2 = r2.left - rackRect.left + r2.width/2;
        y2 = r2.top - rackRect.top + r2.height/2;
        toLabel = conn.to;
      }
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const cx = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#4af74a');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('opacity', '0.7');
      path.style.cursor = 'pointer';
      path.title = `Click to delete ${conn.from} → ${toLabel}`;
      path.dataset.index = index;
      path.onclick = (e) => {
        e.stopPropagation();
        deleteConnection(index);
      };
      svgEl.appendChild(path);
      
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', (x1 + x2) / 2);
      label.setAttribute('y', (y1 + y2) / 2 - 5);
      label.setAttribute('fill', '#4af74a');
      label.setAttribute('font-size', '8px');
      label.textContent = `${conn.from} → ${toLabel}`;
      svgEl.appendChild(label);
    });
  }
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const cx = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#4af74a');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('opacity', '0.7');
      svgEl.appendChild(path);
      
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', (x1 + x2) / 2);
      label.setAttribute('y', (y1 + y2) / 2 - 5);
      label.setAttribute('fill', '#4af74a');
      label.setAttribute('font-size', '8px');
      label.textContent = `${conn.from} → ${toLabel}`;
      svgEl.appendChild(label);
    });
  }

  function deleteConnection(index) {
    if (index < 0 || index >= connections.length) return;
    const conn = connections[index];
    
    // Disconnect audio
    const fromComp = components[conn.from];
    if (fromComp && fromComp.outputGain) {
      if (conn.to === 'master') {
        fromComp.outputGain.disconnect(masterGain);
      } else {
        const toComp = components[conn.to];
        if (toComp && toComp.inputGain) {
          fromComp.outputGain.disconnect(toComp.inputGain);
        }
      }
    }
    
    connections.splice(index, 1);
    drawConnections();
  }

  // Save/Load patch connections
  function savePatch() {
    const patch = {
      connections: connections.map(c => ({ from: c.from, to: c.to })),
      components: Object.keys(components).map(id => ({
        id,
        type: components[id].type,
        label: components[id].label,
        frequency: components[id].frequency,
        waveform: components[id].waveform
      }))
    };
    const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sid-synth-patch.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function loadPatch(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const patch = JSON.parse(e.target.result);
        // Clear existing
        Object.keys(components).forEach(id => {
          components[id].dispose();
          components[id].element.remove();
        });
        connections = [];
        components = {};
        
        // Recreate components (simplified - just log for now)
        console.log('Loaded patch:', patch);
        alert('Patch loaded! Check console for details.');
      } catch(err) {
        console.error('Failed to load patch:', err);
      }
    };
    reader.readAsText(file);
  }

  function initPortClicks() {
    // Master output port
    const masterPort = document.getElementById('masterOutput');
    if (masterPort) {
      masterPort.style.cursor = 'crosshair';
      masterPort.title = 'Click to connect component output here';
      masterPort.onclick = () => {
        if (currentConnectionFrom) {
          addConnection(currentConnectionFrom.id, 'master');
          currentConnectionFrom.port.style.background = '';
          currentConnectionFrom = null;
        }
      };
    }

    Object.keys(components).forEach(id => {
      const comp = components[id];
      if (!comp || !comp.element) return;
      
      const outputPort = comp.element.querySelector('[data-type="output"]');
      const inputPort = comp.element.querySelector('[data-type="input"]');
      
      if (outputPort) {
        outputPort.style.cursor = 'crosshair';
        outputPort.title = 'Click to connect output';
        outputPort.onclick = (e) => {
          e.stopPropagation();
          if (currentConnectionFrom) {
            currentConnectionFrom.port.style.background = '';
            if (currentConnectionFrom.id === id) {
              currentConnectionFrom = null;
              if (tempLine) { tempLine.remove(); tempLine = null; }
              return;
            }
            addConnection(currentConnectionFrom.id, id);
            currentConnectionFrom.port.style.background = '';
            currentConnectionFrom = null;
            if (tempLine) { tempLine.remove(); tempLine = null; }
          } else {
            currentConnectionFrom = { id, port: outputPort };
            outputPort.style.background = '#4af74a';
          }
        };
      }
      
      if (inputPort) {
        inputPort.style.cursor = 'crosshair';
        inputPort.title = 'Click to receive connection';
      }
    });
    
    // Temp line for active connection
    document.addEventListener('mousemove', e => {
      if (!currentConnectionFrom) return;
      if (tempLine) tempLine.remove();
      
      const rackRect = rack.getBoundingClientRect();
      const fromComp = components[currentConnectionFrom.id];
      if (!fromComp) return;
      const fromOutput = fromComp.element.querySelector('[data-type="output"]');
      if (!fromOutput) return;
      
      const r1 = fromOutput.getBoundingClientRect();
      const x1 = r1.left - rackRect.left + r1.width/2;
      const y1 = r1.top - rackRect.top + r1.height/2;
      const x2 = e.clientX - rackRect.left;
      const y2 = e.clientY - rackRect.top;
      
      const cx = (x1 + x2) / 2;
      tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempLine.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`);
      tempLine.setAttribute('fill', 'none');
      tempLine.setAttribute('stroke', '#4af74a');
      tempLine.setAttribute('stroke-width', '2');
      tempLine.setAttribute('opacity', '0.4');
      tempLine.setAttribute('stroke-dasharray', '5,5');
      svgEl.appendChild(tempLine);
    });
  }

  function addConnection(fromId, toId) {
    if (fromId === toId) return;
    if (connections.some(c => c.from === fromId && c.to === toId)) return;
    
    connections.push({ from: fromId, to: toId });
    
    // Audio connection
    const fromComp = components[fromId];
    if (fromComp && fromComp.outputGain) {
      if (toId === 'master') {
        // Connect to master output
        fromComp.outputGain.connect(masterGain);
      } else {
        const toComp = components[toId];
        if (toComp && toComp.inputGain) {
          fromComp.outputGain.connect(toComp.inputGain);
        }
      }
    }
    
    drawConnections();
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
    const oscId = findComponentByType('oscillator');
    if (oscId && components[oscId]) {
      components[oscId].outputGain.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
      components[oscId].frequency = NOTES[note] || 440;
      components[oscId].update();
    }
    const adsrId = findComponentByType('adsr');
    if (adsrId && components[adsrId]) components[adsrId].triggerAttack();
    document.getElementById('noteDisplay').textContent = note;
    isPlaying = true;
  }

  function stopAll() {
    const oscId = findComponentByType('oscillator');
    if (oscId && components[oscId]) {
      components[oscId].outputGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    }
    const adsrId = findComponentByType('adsr');
    if (adsrId && components[adsrId]) components[adsrId].triggerRelease();
    document.getElementById('noteDisplay').textContent = '_';
    isPlaying = false;
  }

  // Presets
  const PRESETS = {
    bass: { osc1: { on: true, wave: 'sawtooth', freq: 110 }, filter: { type: 'lowpass', freq: 800, q: 5 }, adsr: { a: 0.01, d: 0.2, s: 0.4, r: 0.1 } },
    lead: { osc1: { on: true, wave: 'square', freq: 440 }, filter: { type: 'lowpass', freq: 3000, q: 2 }, adsr: { a: 0.05, d: 0.1, s: 0.7, r: 0.2 } },
    pad: { osc1: { on: true, wave: 'triangle', freq: 220 }, filter: { type: 'lowpass', freq: 1500, q: 0 }, adsr: { a: 0.5, d: 0.5, s: 0.8, r: 1.0 } },
    drum: { osc1: { on: true, wave: 'square', freq: 100 }, filter: { type: 'lowpass', freq: 500, q: 8 }, adsr: { a: 0.01, d: 0.3, s: 0.1, r: 0.1 } },
    arp: { osc1: { on: true, wave: 'sawtooth', freq: 440 }, filter: { type: 'bandpass', freq: 1200, q: 3 }, adsr: { a: 0.02, d: 0.1, s: 0.5, r: 0.15 } },
    bass2: { osc1: { on: true, wave: 'triangle', freq: 55 }, filter: { type: 'lowpass', freq: 400, q: 6 }, adsr: { a: 0.05, d: 0.3, s: 0.6, r: 0.2 } },
    fx: { osc1: { on: true, wave: 'noise', freq: 800 }, filter: { type: 'highpass', freq: 2000, q: 1 }, adsr: { a: 0.01, d: 0.05, s: 0.3, r: 0.1 } }
  };

  function findComponentByType(type) {
    return Object.keys(components).find(id => components[id].type === type);
  }

  document.querySelectorAll('.preset-btn').forEach(b => {
    if (b.dataset.preset) {
      b.addEventListener('click', () => {
        const p = PRESETS[b.dataset.preset];
        if (!p) return;
        
        if (p.osc1) {
          const oscId = findComponentByType('oscillator');
          if (oscId && components[oscId]) {
            components[oscId].isOn = p.osc1.on;
            components[oscId].waveform = p.osc1.wave;
            components[oscId].frequency = p.osc1.freq;
            components[oscId].update();
          }
        }
        if (p.filter) {
          const filterId = findComponentByType('filter');
          if (filterId && components[filterId]) {
            components[filterId].filterType = p.filter.type;
            components[filterId].frequency = p.filter.freq;
            components[filterId].Q = p.filter.q;
            components[filterId].update();
          }
        }
        if (p.adsr) {
          const adsrId = findComponentByType('adsr');
          if (adsrId && components[adsrId]) {
            components[adsrId].attack = p.adsr.a;
            components[adsrId].decay = p.adsr.d;
            components[adsrId].sustain = p.adsr.s;
            components[adsrId].release = p.adsr.r;
            components[adsrId].adsr.setParams({ attack: p.adsr.a, decay: p.adsr.d, sustain: p.adsr.s, release: p.adsr.r });
          }
        }
      });
    }
  });

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

  // MIDI Support
  const midiBtn = document.getElementById('midiConnect');
  const midiStatus = document.getElementById('midiStatus');
  
  if (midiBtn && navigator.requestMIDIAccess) {
    midiBtn.addEventListener('click', async () => {
      try {
        const midi = await navigator.requestMIDIAccess();
        midiStatus.textContent = 'MIDI OK';
        midiStatus.style.color = '#4af74a';
        
        midi.inputs.forEach(input => {
          input.onmidimessage = (msg) => {
            const [cmd, note, vel] = msg.data;
            if (cmd === 144 && vel > 0) { // Note on
              if (ctx.state === 'suspended') ctx.resume();
              const noteName = Object.keys(NOTES).find(n => Math.round(NOTES[n]) === Math.round(440 * Math.pow(2, (note - 69) / 12)));
              if (noteName) playNote(noteName);
            } else if (cmd === 128 || (cmd === 144 && vel === 0)) { // Note off
              stopAll();
            }
          };
        });
      } catch(e) {
        midiStatus.textContent = 'MIDI ERR';
        midiStatus.style.color = '#ff4444';
      }
    });
  } else if (midiBtn) {
    midiBtn.disabled = true;
    midiStatus.textContent = 'NO MIDI';
  }

  // Save/Load patch buttons
  const savePatchBtn = document.getElementById('savePatch');
  const loadPatchBtn = document.getElementById('loadPatch');
  const patchFileInput = document.getElementById('patchFile');
  
  if (savePatchBtn) savePatchBtn.onclick = savePatch;
  if (loadPatchBtn) loadPatchBtn.onclick = () => patchFileInput.click();
  if (patchFileInput) patchFileInput.onchange = (e) => {
    if (e.target.files[0]) loadPatch(e.target.files[0]);
  };
})();
