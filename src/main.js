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
  let selectedConnection = null;

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
        
        let toInput;
        // For mixer, find specific channel input
        if (toComp.type === 'mixer' && conn.toChannel !== null) {
          toInput = toComp.element.querySelector(`[data-type="input"][data-channel="${conn.toChannel}"]`);
          toLabel = `${conn.to} CH${conn.toChannel + 1}`;
        } else {
          toInput = toComp.element.querySelector('[data-type="input"]');
          toLabel = conn.to;
        }
        
        if (!toInput) return;
        const r2 = toInput.getBoundingClientRect();
        x2 = r2.left - rackRect.left + r2.width/2;
        y2 = r2.top - rackRect.top + r2.height/2;
      }
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const cx = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', selectedConnection === index ? '#ffaa00' : '#4af74a');
      path.setAttribute('stroke-width', selectedConnection === index ? '3' : '2');
      path.setAttribute('opacity', selectedConnection === index ? '1' : '0.7');
      path.style.cursor = 'pointer';
      path.dataset.index = index;
      
      path.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedConnection === index) {
          deleteConnection(index);
          selectedConnection = null;
        } else {
          selectedConnection = index;
          drawConnections();
        }
      });
      
      path.addEventListener('mouseenter', () => {
        if (selectedConnection !== index) {
          path.setAttribute('opacity', '1');
          path.setAttribute('stroke-width', '3');
        }
      });
      
      path.addEventListener('mouseleave', () => {
        if (selectedConnection !== index) {
          path.setAttribute('opacity', '0.7');
          path.setAttribute('stroke-width', '2');
        }
      });
      
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      
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
    if (isNaN(index) || index < 0 || index >= connections.length) return;
    const conn = connections[index];
    
    // Disconnect audio
    const fromComp = components[conn.from];
    if (fromComp && fromComp.outputGain) {
      if (conn.to === 'master') {
        try { fromComp.outputGain.disconnect(masterGain); } catch(e) {}
      } else {
        const toComp = components[conn.to];
        if (toComp) {
          if (toComp.type === 'mixer' && conn.toChannel !== null && toComp.inputGains) {
            try { fromComp.outputGain.disconnect(toComp.inputGains[conn.toChannel]); } catch(e) {}
          } else if (toComp.inputGain) {
            try { fromComp.outputGain.disconnect(toComp.inputGain); } catch(e) {}
          }
        }
      }
    }
    
    connections.splice(index, 1);
    drawConnections();
  }

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

  // Keyboard handlers
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (currentConnectionFrom) {
        currentConnectionFrom.port.style.background = '';
        currentConnectionFrom = null;
        if (tempLine) { tempLine.remove(); tempLine = null; }
      }
      selectedConnection = null;
      drawConnections();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedConnection !== null) {
        deleteConnection(selectedConnection);
        selectedConnection = null;
      }
    }
  });

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
      
      // Handle output ports - all of them
      const outputPorts = comp.element.querySelectorAll('[data-type="output"]');
      outputPorts.forEach(outputPort => {
        outputPort.style.cursor = 'crosshair';
        outputPort.title = 'Click to connect output';
        outputPort.onclick = (e) => {
          e.stopPropagation();
          if (currentConnectionFrom) {
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
      });
      
      // Handle input ports - all of them
      const inputPorts = comp.element.querySelectorAll('[data-type="input"]');
      inputPorts.forEach(inputPort => {
        inputPort.style.cursor = 'crosshair';
        inputPort.title = 'Click to receive connection';
        inputPort.onclick = (e) => {
          e.stopPropagation();
          
          // Check if there's a connection to this input - click to disconnect
          const existingConnIndex = connections.findIndex(c => {
            if (comp.type === 'mixer') {
              return c.to === id && c.toChannel !== null && 
                inputPort.dataset.channel == c.toChannel;
            }
            return c.to === id;
          });
          
          if (existingConnIndex !== -1) {
            // Disconnect existing connection
            deleteConnection(existingConnIndex);
            return;
          }
          
          // If creating connection, connect to this input
          if (currentConnectionFrom) {
            let toChannel = null;
            if (comp.type === 'mixer' && inputPort.dataset.channel !== undefined) {
              toChannel = parseInt(inputPort.dataset.channel);
            }
            addConnection(currentConnectionFrom.id, id, toChannel);
            currentConnectionFrom.port.style.background = '';
            currentConnectionFrom = null;
            if (tempLine) { tempLine.remove(); tempLine = null; }
          }
        };
      });
    });
  }

  function addConnection(fromId, toId, toChannel = null) {
    if (fromId === toId) return;
    if (connections.some(c => c.from === fromId && c.to === toId && c.toChannel === toChannel)) return;
    
    let channel = toChannel;
    const fromComp = components[fromId];
    const toComp = components[toId];
    
    // Audio connection
    if (fromComp && fromComp.outputGain) {
      if (toId === 'master') {
        fromComp.outputGain.connect(masterGain);
        connections.push({ from: fromId, to: toId, toChannel: null });
      } else if (toComp) {
        // Handle mixer - use channel from input port
        if (toComp.type === 'mixer' && toComp.inputGains) {
          if (channel === null) {
            // Find first available channel
            let usedChannels = connections.filter(c => c.to === toId && c.toChannel !== null).map(c => c.toChannel);
            channel = [0,1,2,3].find(i => !usedChannels.includes(i));
          }
          if (channel !== undefined) {
            connections.push({ from: fromId, to: toId, toChannel: channel });
            fromComp.outputGain.connect(toComp.inputGains[channel]);
          }
        } else if (toComp.inputGain) {
          fromComp.outputGain.connect(toComp.inputGain);
          connections.push({ from: fromId, to: toId, toChannel: null });
        }
      }
    }
    
    drawConnections();
  }

  // Keyboard
  const kb = document.getElementById('keyboard');
  if (kb) {
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
  } else {
    console.error('Keyboard element not found!');
  }

  let isPlaying = false;

  function playNote(note) {
    if (ctx.state === 'suspended') ctx.resume();
    
    // Find all oscillators that are connected to something
    const oscIds = Object.keys(components).filter(id => components[id].type === 'oscillator');
    oscIds.forEach(oscId => {
      const osc = components[oscId];
      // Check if this oscillator is connected to something
      const isConnected = connections.some(c => c.from === oscId);
      if (isConnected && osc.outputGain) {
        osc.outputGain.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
        osc.frequency = NOTES[note] || 440;
        osc.update();
      }
    });
    
    // Trigger all connected ADSRs
    const adsrIds = Object.keys(components).filter(id => components[id].type === 'adsr');
    adsrIds.forEach(adsrId => {
      const adsr = components[adsrId];
      const isConnected = connections.some(c => c.to === adsrId);
      if (isConnected) adsr.triggerAttack();
    });
    
    document.getElementById('noteDisplay').textContent = note;
    isPlaying = true;
  }

  function stopAll() {
    // Stop all oscillators
    const oscIds = Object.keys(components).filter(id => components[id].type === 'oscillator');
    oscIds.forEach(oscId => {
      const osc = components[oscId];
      if (osc.outputGain) {
        osc.outputGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      }
    });
    
    // Release all ADSRs
    const adsrIds = Object.keys(components).filter(id => components[id].type === 'adsr');
    adsrIds.forEach(adsrId => {
      const adsr = components[adsrId];
      adsr.triggerRelease();
    });
    
    document.getElementById('noteDisplay').textContent = '_';
    isPlaying = false;
  }

  function findComponentByType(type) {
    return Object.keys(components).find(id => components[id].type === type);
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

  // Save/Load patch buttons
  const savePatchBtn = document.getElementById('savePatch');
  const loadPatchBtn = document.getElementById('loadPatch');
  const patchFileInput = document.getElementById('patchFile');
  
  if (savePatchBtn) savePatchBtn.onclick = savePatch;
  if (loadPatchBtn) loadPatchBtn.onclick = () => patchFileInput.click();
  if (patchFileInput) patchFileInput.onchange = (e) => {
    if (e.target.files[0]) loadPatch(e.target.files[0]);
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
})();
