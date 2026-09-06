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
import { renderWav } from './services/wavExport.js';
import { createTrackEngine } from './tracks/trackEngine.js';
import { createStepEngineAdapter } from './tracks/stepEngineAdapter.js';
import { createRecorderUI } from './tracks/recorderUI.js';
import { createArranger } from './arranger/arranger.js';
import { createPianoRoll } from './arranger/pianoRoll.js';
import { createHistory } from './project/history.js';
import { createTransport } from './project/transport.js';
import { createProjectStore } from './project/projectStore.js';
import { serializeProject } from './project/serialize.js';
import { createProjectId } from './project/defaultProject.js';
import { createMarkerStore } from './project/markers.js';
import { normalizeAsset } from './audio/assetStore.js';
import { createAssetStore } from './audio/assetStore.js';
import { createMediaPool } from './audio/mediaPool.js';

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

  // Musical keyboard + MIDI
  let recNoteOn = null, recNoteOff = null;
  createKeyboard({
    container: document.getElementById('keyboard'),
    ctx,
    playNote,
    stopAll,
    onNoteOn: (n) => { if (recNoteOn) recNoteOn(n); },
    onNoteOff: (n) => { if (recNoteOff) recNoteOff(n); },
  });

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
  const midiApi = initMidi({
    button: document.getElementById('midiConnect'),
    statusEl: document.getElementById('midiStatus'),
    ctx,
    onNoteOn: (note, channel) => {
      // Route to track engine with channel filtering
      if (trackEngine) _routeMidiNote(note, channel, true);
      // Also route to rack for live preview
      if (trackEngine && !trackEngine._armed.size) playNote(note);
    },
    onNoteOff: (note, channel) => {
      if (trackEngine) _routeMidiNote(note, channel, false);
    },
    onCC: (channel, cc, value) => {
      if (trackEngine) trackEngine.routeCC(channel, cc, value);
    },
    onPitchBend: (channel, value) => {
      if (trackEngine) trackEngine.routePitchBend(channel, value);
    },
  });

  function _routeMidiNote(note, channel, isOn) {
    if (!trackEngine) return;
    const tracks = trackEngine.getTracks();
    // Find tracks that accept this channel (midiChannel === null = omni)
    const targets = tracks.filter(t => t.midiChannel === null || t.midiChannel === channel);
    if (!targets.length) {
      // Fallback: route to active track like keyboard does
      const id = trackEngine.activeTrackId || (tracks[0] && tracks[0].id);
      if (id && trackEngine.byId[id]) {
        if (isOn) trackEngine.noteOn(note);
        else trackEngine.noteOff(note);
      }
      return;
    }
    // Route to matching tracks directly (bypass armed-track gate)
    const resolve = (n) => (n && n.length ? n.toUpperCase() : n);
    const noteName = resolve(note);
    const now = trackEngine.ctx.currentTime;
    targets.forEach(t => {
      if (isOn) {
        t.voice.noteOn(noteName, now);
        if (trackEngine._recording && trackEngine._armed.has(t.id)) {
          // Stamp into armed+matching tracks' realtime buffer
          trackEngine.noteOn(note);
        }
      } else {
        t.voice.noteOff(noteName, now);
      }
    });
    if (isOn) trackEngine._lastNote = noteName;
  }

  // Recorder: multi-track loop sequencer + realtime recording.
  // Keyboard presses feed recorder noteOn/noteOff while armed tracks capture them.
  const recorderCtx = ctx;
  const recorderDest = ctx.createGain();
  recorderDest.gain.value = 0.7;
  recorderDest.connect(masterGain);

  const trackEngine = createTrackEngine(recorderCtx, recorderDest);
  const recorderEl = document.getElementById('recorder');
  const history = createHistory();

  // WAV export (backlog #38): bounce the live mix through the master bus.
  const exportWav = (opts = {}) => renderWav({
    ctx,
    masterGain,
    play: () => trackEngine.play(),
    stop: () => trackEngine.stop(),
    bars: opts.bars || 4,
    bpm: trackEngine.bpm,
  });
  const transport = createTransport({ ctx: recorderCtx, bpm: trackEngine.bpm });
  createStepEngineAdapter(trackEngine, transport);
  const recorderUI = recorderEl
    ? createRecorderUI({ container: recorderEl, engine: trackEngine, history, exportWav, midiApi })
    : null;

  // Linear arranger: ruler + track lanes + playhead on the unified transport.
  const arrangerEl = document.getElementById('arranger');
  const markers = createMarkerStore();
  const pianoRollEl = document.getElementById('pianoRoll');
  const pianoRoll = pianoRollEl
    ? createPianoRoll({ container: pianoRollEl, engine: trackEngine, transport, history })
    : null;
  const arranger = arrangerEl
    ? createArranger({
        container: arrangerEl, engine: trackEngine, transport, history, markers,
        cfg: { onSelectionChange: (s) => { if (pianoRoll) pianoRoll.setSelection(s); } },
      })
    : null;

  // Start with one default track so the panel is usable immediately.
  trackEngine.addTrack({ name: 'Track 1', id: 'trk_1' });
  trackEngine.activeTrackId = 'trk_1';
  if (recorderUI) recorderUI.renderAll();
  if (arranger) arranger.render();

  // Keyboard: Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo (recorder edits).
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !history) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
    else if (k === 'z' && e.shiftKey) { e.preventDefault(); history.redo(); }
    else if (k === 'y') { e.preventDefault(); history.redo(); }
  });

  // Route keyboard presses into the recorder engine (monitor + record).
  recNoteOn = (n) => trackEngine.noteOn(resolveNote(n) || n);
  recNoteOff = (n) => trackEngine.noteOff(resolveNote(n) || n);

  // Unified project persistence: one versioned snapshot (rack + tracks + tempo).
  let projectId = null;
  let projectName = 'SID Project';
  // Media-pool manifest (M4): metadata only — binary audio lives in the
  // IndexedDB asset store. Mutated by the media pool import UI, persisted
  // here so save/load round-trips keep every referenced hash.
  let projectAssets = [];

  function captureProject() {
    if (!projectId) projectId = createProjectId();
    return serializeProject({
      components,
      connections: router.connections,
      captureParams,
      tracks: trackEngine.getTracks(),
      tempo: trackEngine.bpm,
      activeTrackId: trackEngine.activeTrackId,
      markers: markers.getMarkers(),
      id: projectId,
      name: projectName,
      loopEnabled: transport.loopEnabled,
      loopStartTicks: transport.loopStartTicks,
      loopEndTicks: transport.loopEndTicks,
      projectEndTicks: transport.projectEndTicks,
      assets: projectAssets,
    });
  }

  function applyProject(project) {
    if (project.id) projectId = project.id;
    if (project.name) projectName = project.name;
    projectAssets = Array.isArray(project.assets) ? project.assets.map(normalizeAsset) : [];

    // Rack: rebuild components + connections from the snapshot.
    clearRack();
    const idMap = {};
    (project.rack.components || []).forEach(c => {
      const before = new Set(Object.keys(components));
      const createId = (c.type === 'oscillator' && c.params && c.params.n) ? 'osc' + c.params.n : c.id;
      createComponent(c.type, createId, 0, 0);
      const createdId = Object.keys(components).find(id => !before.has(id));
      idMap[c.id] = createdId;
      if (createdId && components[createdId]) {
        components[createdId].element.style.left = (c.x || 0) + 'px';
        components[createdId].element.style.top = (c.y || 0) + 'px';
        applyParams(components[createdId], c.params);
      }
    });
    (project.rack.connections || []).forEach(conn => {
      const from = idMap[conn.from] ?? conn.from;
      const to = conn.to === 'master' ? 'master' : (idMap[conn.to] ?? conn.to);
      router.addConnection(from, to, conn.toChannel ?? null, conn.outChannel ?? 0);
    });
    router.drawConnections();

    // Tracks: replace the track set (keeps the default track when empty).
    if (Array.isArray(project.tracks) && project.tracks.length) {
      trackEngine.tracks.forEach(t => { try { t.voice.dispose(); } catch (e) {} });
      trackEngine.tracks.length = 0;
      trackEngine.byId = {};
      project.tracks.forEach(d => trackEngine.addTrack(d));
      if (project.tempo) { trackEngine.bpm = project.tempo; trackEngine.recalcTempo(); }
      trackEngine.activeTrackId = project.activeTrackId || (trackEngine.tracks[0] && trackEngine.tracks[0].id);
    }
    if (recorderUI) recorderUI.renderAll();
    markers.set(Array.isArray(project.markers) ? project.markers : []);

    // Restore loop locators + project end.
    transport.loopEnabled = !!project.loopEnabled;
    transport.loopStartTicks = typeof project.loopStartTicks === 'number' ? project.loopStartTicks : 0;
    transport.loopEndTicks = typeof project.loopEndTicks === 'number' ? project.loopEndTicks : 4 * transport.ppq;
    transport.projectEndTicks = typeof project.projectEndTicks === 'number' ? project.projectEndTicks : null;

    if (arranger) arranger.render();
  }

  const projectStore = createProjectStore({
    capture: captureProject,
    apply: applyProject,
  });

  // Trigger a save on rack DOM mutations, rack param changes, and history
  // changes (undo/redo/commands). A 3s safety interval covers anything missed.
  new MutationObserver(() => projectStore.markDirty()).observe(rack, {
    childList: true,
    subtree: true,
    attributes: true,
  });
  rack.addEventListener('change', () => projectStore.markDirty());
  history.subscribe(() => projectStore.markDirty());
  transport.onStateChange(() => projectStore.markDirty());

  projectStore.restore();
  if (recorderUI) recorderUI.renderAll();
  if (arranger) arranger.render();

  // Media pool (M4): IndexedDB asset store + import UI. Created after restore
  // so the first refresh already sees the restored assets manifest.
  const assetStore = createAssetStore();
  const mediaPoolEl = document.getElementById('mediaPool');
  const mediaPool = mediaPoolEl
    ? createMediaPool({
        container: mediaPoolEl,
        ctx,
        destination: masterGain,
        store: assetStore,
        getAssets: () => projectAssets,
        setAssets: (arr) => { projectAssets = arr; projectStore.markDirty(); },
      })
    : null;

  router.drawConnections();
  setInterval(() => projectStore.markDirty(), 3000);
})();
