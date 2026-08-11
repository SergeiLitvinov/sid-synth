import { OscillatorComponent } from './components/OscillatorComponent.js';
import { FilterComponent } from './components/FilterComponent.js';
import { AdsrComponent } from './components/AdsrComponent.js';
import { LfoComponent } from './components/LfoComponent.js';
import { EffectsComponent } from './components/EffectsComponent.js';
import { MixerComponent } from './components/MixerComponent.js';
import { SplitterComponent } from './components/SplitterComponent.js';
import { SequencerComponent } from './components/SequencerComponent.js';
import { NOTES, noteToFreq, resolveNote } from './services/notes.js';
import { PRESETS } from './services/presets.js';
import { captureParams, applyParams } from './services/componentParams.js';
import { createVisualization } from './services/visualization.js';
import { createKeyboard } from './services/keyboard.js';
import { initMidi } from './services/midi.js';
import { createRouter } from './services/router.js';
import { createPatchStore } from './services/patchStore.js';
import { createPatchFile } from './services/patchFile.js';

console.log('SID Synth Modular loaded');

(async () => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.7;
  masterGain.connect(ctx.destination);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  masterGain.connect(analyser);
  const analyserFreq = ctx.createAnalyser();
  analyserFreq.fftSize = 2048;
  masterGain.connect(analyserFreq);

  createVisualization({
    canvas: document.getElementById('oscilloscope'),
    spectroscope: document.getElementById('spectroscope'),
    analyser,
    analyserFreq,
  }).start();

  const rack = document.getElementById('rack');
  const svgEl = document.getElementById('connectionsSvg');
  const masterPortEl = document.getElementById('masterOutput');
  const components = {};
  let componentId = 0;

  const router = createRouter({ components, masterGain, rack, svgEl, masterPortEl });

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

  let oscSeq = 0;

  function oscNumberFor(id) {
    const m = /^osc(\d+)/i.exec(id || '');
    return m ? Number(m[1]) : ++oscSeq;
  }

  function createComponent(type, id, x, y) {
    let comp;
    const newId = `${type}_${++componentId}`;

    switch(type) {
      case 'oscillator':
        comp = new OscillatorComponent(ctx, oscNumberFor(id));
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

    // Sequencer note hook (scheduled on the Web Audio timeline)
    if (comp.type === 'sequencer' && comp.seq) {
      comp.seq.onStep = (step, note, t0, dur) => { if (note) scheduleNote(note, t0, dur); };
    }

    // Close button handler
    if (comp.closeBtn) {
      comp.closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        router.removeConnectionsOf(newId);
        if (comp.outputGain) comp.outputGain.disconnect();
        if (comp.inputGain) comp.inputGain.disconnect();
        comp.dispose();
        comp.element.remove();
        delete components[newId];
        router.drawConnections();
        router.initPortClicks();
      });
    }

    router.initPortClicks();
    router.drawConnections();
  }

  let dragRAF = null;
  let dragState = null;

  function makeDraggable(el) {
    let isDragging = false;
    let startX = 0, startY = 0;

    el.addEventListener('pointerdown', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.closest('svg') || e.target.classList.contains('close-btn')) return;
      isDragging = true;
      try { el.setPointerCapture(e.pointerId); } catch(_) {}
      const rect = el.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      el.style.zIndex = 1000;
      e.preventDefault();
    });

    el.addEventListener('pointermove', e => {
      if (!isDragging) return;
      const rackRect = rack.getBoundingClientRect();
      let x = e.clientX - rackRect.left - startX;
      let y = e.clientY - rackRect.top - startY;
      x = Math.max(0, Math.min(x, rackRect.width - el.offsetWidth));
      y = Math.max(0, Math.min(y, rackRect.height - el.offsetHeight));
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      if (router.connections.length && !dragRAF) {
        dragState = { el };
        dragRAF = requestAnimationFrame(updateDragConnections);
      }
    });

    el.addEventListener('pointerup', () => {
      if (isDragging) {
        el.style.zIndex = '';
        isDragging = false;
        if (dragRAF) { cancelAnimationFrame(dragRAF); dragRAF = null; }
        dragState = null;
        router.drawConnections();
      }
    });
  }

  function updateDragConnections() {
    router.drawConnections();
    if (dragState) {
      dragRAF = requestAnimationFrame(updateDragConnections);
    }
  }

  let isPlaying = false;

  function playNote(note) {
    if (ctx.state === 'suspended') ctx.resume();

    const oscIds = Object.keys(components).filter(id => components[id].type === 'oscillator');
    oscIds.forEach(oscId => {
      const osc = components[oscId];
      const isConnected = router.connections.some(c => c.from === oscId);
      if (isConnected && osc.outputGain) {
        osc.outputGain.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
        osc.frequency = noteToFreq(note);
        osc.update();
      }
    });

    const adsrIds = Object.keys(components).filter(id => components[id].type === 'adsr');
    adsrIds.forEach(adsrId => {
      const adsr = components[adsrId];
      const isConnected = router.connections.some(c => c.to === adsrId);
      if (isConnected) adsr.triggerAttack();
    });

    document.getElementById('noteDisplay').textContent = note;
    isPlaying = true;
  }

  function stopAll() {
    const oscIds = Object.keys(components).filter(id => components[id].type === 'oscillator');
    oscIds.forEach(oscId => {
      const osc = components[oscId];
      if (osc.outputGain) {
        osc.outputGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      }
    });

    const adsrIds = Object.keys(components).filter(id => components[id].type === 'adsr');
    adsrIds.forEach(adsrId => {
      const adsr = components[adsrId];
      adsr.triggerRelease();
    });

    document.getElementById('noteDisplay').textContent = '_';
    isPlaying = false;
  }

  function scheduleNote(note, t0, dur) {
    const noteName = resolveNote(note);
    if (!noteName) return;
    const freq = noteToFreq(noteName);
    const oscIds = Object.keys(components).filter(id =>
      components[id].type === 'oscillator' && router.connections.some(c => c.from === id)
    );
    oscIds.forEach(oscId => {
      const osc = components[oscId];
      if (osc.outputGain) {
        osc.setFrequency(freq);
        osc.outputGain.gain.setTargetAtTime(1, t0, 0.01);
        osc.outputGain.gain.setTargetAtTime(0, t0 + dur, 0.02);
      }
    });
    document.getElementById('noteDisplay').textContent = noteName;
  }

  function findComponentByType(type) {
    return Object.keys(components).find(id => components[id].type === type);
  }

  // Musical keyboard + MIDI
  createKeyboard({
    container: document.getElementById('keyboard'),
    ctx,
    playNote,
    stopAll,
  });

  router.init();

  // Preset buttons (built-in sounds)
  document.querySelectorAll('.preset-btn').forEach(b => {
    if (b.dataset.preset) {
      b.addEventListener('click', () => {
        const p = PRESETS[b.dataset.preset];
        if (!p) return;

        if (p.osc1) {
          const oscId = findComponentByType('oscillator');
          if (oscId && components[oscId]) applyParams(components[oscId], p.osc1);
        }
        if (p.filter) {
          const filterId = findComponentByType('filter');
          if (filterId && components[filterId]) applyParams(components[filterId], p.filter);
        }
        if (p.adsr) {
          const adsrId = findComponentByType('adsr');
          if (adsrId && components[adsrId]) applyParams(components[adsrId], p.adsr);
        }
      });
    }
  });

  // User presets (localStorage)
  function clearRack() {
    Object.keys(components).forEach(id => {
      const comp = components[id];
      try { comp.dispose(); } catch(e) {}
      comp.element.remove();
      delete components[id];
    });
    router.clear();
    router.initPortClicks();
  }

  const patchStore = createPatchStore({
    components,
    captureParams,
    applyParams,
    createComponent,
    clearRack,
    drawConnections: router.drawConnections,
  });

  const patchFile = createPatchFile({
    components,
    connections: router.connections,
    captureParams,
    applyParams,
    createComponent,
    clearRack,
    drawConnections: router.drawConnections,
    addConnection: router.addConnection,
  });

  // Save/Load patch buttons
  const savePatchBtn = document.getElementById('savePatch');
  const loadPatchBtn = document.getElementById('loadPatch');
  const patchFileInput = document.getElementById('patchFile');

  if (savePatchBtn) savePatchBtn.onclick = patchFile.savePatch;
  if (loadPatchBtn) loadPatchBtn.onclick = () => patchFileInput.click();
  if (patchFileInput) patchFileInput.onchange = (e) => {
    if (e.target.files[0]) patchFile.loadPatch(e.target.files[0]);
  };

  // Preset buttons
  const savePresetBtn = document.getElementById('savePreset');
  const loadPresetBtn = document.getElementById('loadPreset');
  const deletePresetBtn = document.getElementById('deletePreset');
  if (savePresetBtn) savePresetBtn.onclick = patchStore.savePreset;
  if (loadPresetBtn) loadPresetBtn.onclick = patchStore.loadPreset;
  if (deletePresetBtn) deletePresetBtn.onclick = patchStore.deletePreset;
  patchStore.refreshPresetList();

  // MIDI
  initMidi({
    button: document.getElementById('midiConnect'),
    statusEl: document.getElementById('midiStatus'),
    ctx,
    playNote,
    stopAll,
  });
})();
