import { prepareAudio } from '../audio/prepareAudio.js';
import { OscillatorComponent } from '../components/OscillatorComponent.js';
import { FilterComponent } from '../components/FilterComponent.js';
import { AdsrComponent } from '../components/AdsrComponent.js';
import { LfoComponent } from '../components/LfoComponent.js';
import { EffectsComponent } from '../components/EffectsComponent.js';
import { MixerComponent } from '../components/MixerComponent.js';
import { SplitterComponent } from '../components/SplitterComponent.js';
import { SequencerComponent } from '../components/SequencerComponent.js';
import { PRESETS } from '../services/presets.js';
import { createRouter } from '../services/router.js';
import { createPatchStore } from '../services/patchStore.js';
import { createPatchFile } from '../services/patchFile.js';
import { noteToFreq, resolveNote } from '../services/notes.js';
import { captureParams, applyParams } from '../services/componentParams.js';

export function createRackController({ ctx, masterGain, transport = null }) {
  const rack = document.getElementById('rack');
  const svgEl = document.getElementById('connectionsSvg');
  const masterPortEl = document.getElementById('masterOutput');
  const components = {};
  let componentId = 0;
  // Shared transport the rack sequencers follow (injected via setTransport
  // because the transport is created after the rack in main.js).
  let sharedTransport = transport || null;

  const router = createRouter({ components, masterGain, rack, svgEl, masterPortEl, onMutate: () => emitMutate() });

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

  function createComponent(type, id, x, y, stage = null) {
    const audioContext = stage ? stage.audio.ctx : ctx;
    let comp;
    const newId = `${type}_${++componentId}`;

    switch(type) {
      case 'oscillator':
        comp = new OscillatorComponent(audioContext, oscNumberFor(id));
        break;
      case 'filter':
        comp = new FilterComponent(audioContext);
        break;
      case 'adsr':
        comp = new AdsrComponent(audioContext);
        break;
      case 'effects':
        comp = new EffectsComponent(audioContext);
        break;
      case 'lfo':
        comp = new LfoComponent(audioContext);
        break;
      case 'mixer':
        comp = new MixerComponent(audioContext);
        break;
      case 'splitter':
        comp = new SplitterComponent(audioContext);
        break;
      case 'sequencer':
        comp = new SequencerComponent(audioContext);
        break;
      default:
        return;
    }

    (stage ? stage.components : components)[newId] = comp;
    (stage ? stage.rack : rack).appendChild(comp.element);
    comp.element.style.left = Math.max(0, x - 100) + 'px';
    comp.element.style.top = Math.max(0, y - 30) + 'px';
    makeDraggable(comp.element, newId);

    // Sequencer note hook (scheduled on the Web Audio timeline)
    if (comp.type === 'sequencer' && comp.seq) {
      comp.seq.onStep = (step, note, t0, dur) => { if (note) scheduleNote(note, t0, dur); };
      if (!stage && sharedTransport && comp.attachTransport) comp.attachTransport(sharedTransport);
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
        emitMutate();
      });
    }

    if (!stage) {
      router.initPortClicks();
      router.drawConnections();
      emitMutate();
    }
    return newId;
  }

  let projectBus = null;
  // Construct and wire a detached, muted rack before touching the live one.
  function prepareRack(snapshot) {
    const bus = ctx.createGain();
    bus.gain.value = 0;
    const stage = { components: {}, rack: document.createElement('div'), audio: prepareAudio(ctx) };
    const stagedRouter = createRouter({ components: stage.components, masterGain: bus,
      rack: stage.rack, svgEl: document.createElementNS('http://www.w3.org/2000/svg', 'svg'), masterPortEl: null });
    let adopted = false;
    const dispose = () => {
      if (adopted) return;
      Object.values(stage.components).forEach(c => { try { c.dispose(); } catch (_) {} c.element.remove(); });
      stage.audio.dispose();
      bus.disconnect();
    };
    try {
      const ids = new Map();
      snapshot.components.forEach(c => {
        const newId = createComponent(c.type, c.params?.n !== undefined ? 'osc' + c.params.n : c.id, 0, 0, stage);
        if (!newId) throw new Error('Unsupported rack device: ' + c.type);
        ids.set(c.id, newId);
        const comp = stage.components[newId];
        comp.element.style.left = c.x + 'px';
        comp.element.style.top = c.y + 'px';
        applyParams(comp, c.params);
      });
      snapshot.connections.forEach(c => {
        const count = stagedRouter.connections.length;
        stagedRouter.addConnection(ids.get(c.from), c.to === 'master' ? 'master' : ids.get(c.to), c.toChannel ?? null, c.outChannel ?? 0);
        if (stagedRouter.connections.length !== count + 1) throw new Error('Cannot prepare rack connection');
      });
      bus.connect(masterGain);
    } catch (e) { dispose(); throw e; }
    return { dispose, commit() {
      clearRack(true);
      projectBus = bus;
      router.setMasterGain(bus);
      Object.assign(components, stage.components);
      Object.values(stage.components).forEach(c => {
        rack.appendChild(c.element);
        if (sharedTransport && c.attachTransport) c.attachTransport(sharedTransport);
      });
      router.connections.push(...stagedRouter.connections);
      adopted = true;
      stage.audio.commit();
      bus.gain.value = 1;
      router.initPortClicks();
      router.drawConnections();
    } };
  }

  let dragRAF = null;
  let dragState = null;


  // Event-based mutation signal for autosave (P0): the bootstrap subscribes
  // via setOnMutate instead of a DOM MutationObserver.
  let onMutate = null;
  function emitMutate() {
    try { if (onMutate) onMutate(); } catch (e) {}
  }
  function setOnMutate(fn) {
    onMutate = typeof fn === 'function' ? fn : null;
  }

  // Attach the shared transport to every rack sequencer (existing + future).
  // Global Play/Stop/Seek then drives the patterns; tempo comes from the
  // project. Safe to call before any sequencer exists.
  function setTransport(t) {
    sharedTransport = t || null;
    Object.values(components).forEach(comp => {
      if (comp.type === 'sequencer' && comp.attachTransport) comp.attachTransport(sharedTransport);
    });
  }

  function makeDraggable(el) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let moved = false;

    el.addEventListener('pointerdown', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.closest('svg') || e.target.closest('.conn-point') || e.target.classList.contains('close-btn')) return;
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
      moved = true;
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
        if (moved) { moved = false; emitMutate(); }
      }
    });
  }

  function updateDragConnections() {
    router.drawConnections();
    if (dragState) {
      dragRAF = requestAnimationFrame(updateDragConnections);
    }
  }


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
        // Pitch changes at the scheduled note time, not at callback time.
        osc.setFrequency(freq, t0);
        osc.outputGain.gain.setTargetAtTime(1, t0, 0.01);
        osc.outputGain.gain.setTargetAtTime(0, t0 + dur, 0.02);
      }
    });
    document.getElementById('noteDisplay').textContent = noteName;
  }

  router.init();

  // Preset buttons (built-in sounds)
  document.querySelectorAll('.preset-btn').forEach(b => {
    if (b.dataset.preset) {
      b.addEventListener('click', () => {
        const p = PRESETS[b.dataset.preset];
        if (!p) return;

        const applyToAll = (type, params) => {
          Object.keys(components).forEach(id => {
            if (components[id].type === type) applyParams(components[id], params);
          });
        };
        if (p.osc1) applyToAll('oscillator', p.osc1);
        if (p.filter) applyToAll('filter', p.filter);
        if (p.adsr) applyToAll('adsr', p.adsr);
        emitMutate();
      });
    }
  });

  // User presets (localStorage)
  function clearRack(silent = false) {
    router.setMasterGain(masterGain);
    if (projectBus) { projectBus.disconnect(); projectBus = null; }
    Object.keys(components).forEach(id => {
      const comp = components[id];
      try { comp.dispose(); } catch(e) {}
      comp.element.remove();
      delete components[id];
    });
    router.clear(silent);
    router.initPortClicks();
  }

  const patchStore = createPatchStore({
    components,
    captureParams,
    applyParams,
    createComponent,
    clearRack,
    drawConnections: router.drawConnections,
    connections: router.connections,
    addConnection: router.addConnection,
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
    if (e.target.files[0]) patchFile.loadPatch(e.target.files[0], () => emitMutate());
  };

  // Preset buttons
  const savePresetBtn = document.getElementById('savePreset');
  const loadPresetBtn = document.getElementById('loadPreset');
  const deletePresetBtn = document.getElementById('deletePreset');
  if (savePresetBtn) savePresetBtn.onclick = patchStore.savePreset;
  if (loadPresetBtn) loadPresetBtn.onclick = patchStore.loadPreset;
  if (deletePresetBtn) deletePresetBtn.onclick = patchStore.deletePreset;
  patchStore.refreshPresetList();


  return { rack, components, router, createComponent, prepareRack, clearRack, playNote, stopAll, setTransport, setOnMutate };
}

