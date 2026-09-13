import { createProjectSession } from './project/projectSession.js';
import { createRackController } from './rack/rackController.js';
import { resolveNote } from './services/notes.js';
import { createVisualization } from './services/visualization.js';
import { createKeyboard } from './services/keyboard.js';
import { initMidi } from './services/midi.js';
import { renderWav } from './services/wavExport.js';
import { createTrackEngine } from './tracks/trackEngine.js';
import { createStepEngineAdapter } from './tracks/stepEngineAdapter.js';
import { createRecorderUI } from './tracks/recorderUI.js';
import { createArranger } from './arranger/arranger.js';
import { createPianoRoll } from './arranger/pianoRoll.js';
import { createHistory } from './project/history.js';
import { createTransport } from './project/transport.js';
import { createProjectStore } from './project/projectStore.js';
import { createMarkerStore } from './project/markers.js';
import { addClipCommand } from './project/trackCommands.js';
import { ticksPerSecond } from './project/clipEvents.js';
import { createAssetStore } from './audio/assetStore.js';
import { exportBundle, importBundle, downloadText, readFileText, sanitizeFileName } from './project/projectFiles.js';
import { defaultProject } from './project/defaultProject.js';
import { createMediaPool } from './audio/mediaPool.js';
import { createInputUI } from './audio/inputUI.js';


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

  const { rack, components, router, createComponent, prepareRack, clearRack, playNote, stopAll, setTransport, setOnMutate } = createRackController({ ctx, masterGain });

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

  // MIDI
  const midiApi = initMidi({
    button: document.getElementById('midiConnect'),
    statusEl: document.getElementById('midiStatus'),
    ctx,
    onNoteOn: (note, channel, velocity, deviceId) => trackEngine.noteOn(note, { channel, velocity, device: deviceId }),
    onNoteOff: (note, channel, deviceId) => trackEngine.noteOff(note, { channel, device: deviceId }),
    onCC: (channel, cc, value) => {
      if (trackEngine) trackEngine.routeCC(channel, cc, value);
    },
    onPitchBend: (channel, value) => {
      if (trackEngine) trackEngine.routePitchBend(channel, value);
    },
    onPressure: (channel, value) => {
      if (trackEngine) trackEngine.routePressure(channel, value);
    },
    onProgram: (channel, program) => {
      if (trackEngine) trackEngine.routeProgram(channel, program);
    },
    onPanic: () => {
      if (trackEngine) trackEngine.panic();
    },
    onDeviceLost: (deviceId, held) => {
      // A disconnected device never sends note-off: release exactly the
      // notes it was holding so no voice rings forever.
      if (!trackEngine) return;
      held.forEach(h => trackEngine.noteOff(h.note, { channel: h.channel, device: deviceId }));
    },
  });

  // Recorder: multi-track loop sequencer + realtime recording.
  // Keyboard presses feed recorder noteOn/noteOff while armed tracks capture them.
  const recorderCtx = ctx;
  const recorderDest = ctx.createGain();
  recorderDest.gain.value = 0.7;
  recorderDest.connect(masterGain);

  // Binary audio lives in one IndexedDB store shared by the media pool UI
  // and the track engine's clip-audio playback.
  const assetStore = createAssetStore();
  const trackEngine = createTrackEngine(recorderCtx, recorderDest, { audioStore: assetStore, playbackMode: 'song' });
  const recorderEl = document.getElementById('recorder');
  const history = createHistory();
  // Takes commit through this history as single undo entries (P0).
  trackEngine.history = history;
  // Declared early: arranger/piano-roll cfg callbacks below close over it,
  // and createArranger renders synchronously during construction.
  let projectAssets = [];

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
  // Rack sequencers follow the shared transport (P0): global Play/Stop/Seek
  // drives the patterns and project tempo sets the step rate.
  setTransport(transport);
  const recorderUI = recorderEl
    ? createRecorderUI({ container: recorderEl, engine: trackEngine, history, exportWav, midiApi, transport })
    : null;

  // Linear arranger: ruler + track lanes + playhead on the unified transport.
  const arrangerEl = document.getElementById('arranger');
  const markers = createMarkerStore();
  // Audio clip helpers (M4): manifest lookups and pool-to-track attach.
  const getAssetName = (hash) => {
    const found = projectAssets.find(a => a && a.hash === hash);
    return (found && found.name) || (typeof hash === 'string' ? hash.slice(0, 8) : 'audio');
  };
  const getAudioPeaks = async (hash) => {
    try {
      const rec = await assetStore.get(hash);
      return (rec && rec.peaks) || null;
    } catch (e) {
      return null;
    }
  };
  // Add a pool asset as an audio clip on the active track at the next free
  // position, sized from the asset duration. Undoable through history.
  function addAudioClipToActiveTrack(asset) {
    if (!asset || typeof asset.hash !== 'string' || !asset.hash) return;
    const tracks = trackEngine.getTracks();
    if (!tracks.length) return;
    const targetId = (trackEngine.activeTrackId && tracks.some(t => t.id === trackEngine.activeTrackId))
      ? trackEngine.activeTrackId
      : tracks[0].id;
    const target = tracks.find(t => t.id === targetId);
    const nextStart = (target.clips || []).reduce((max, c) => Math.max(max, c.start + c.length), 0);
    const tps = ticksPerSecond(trackEngine.bpm, trackEngine.ppq);
    const clip = {
      name: asset.name || 'Audio',
      start: nextStart,
      length: Math.max(480, Math.round((asset.duration || 1) * tps)),
      events: [],
      audio: { hash: asset.hash },
    };
    if (history) history.execute(addClipCommand(trackEngine, targetId, clip));
    else trackEngine.addClip(targetId, clip);
  }
  const pianoRollEl = document.getElementById('pianoRoll');
  const pianoRoll = pianoRollEl
    ? createPianoRoll({ container: pianoRollEl, engine: trackEngine, transport, history, getAssetName })
    : null;
  const arranger = arrangerEl
    ? createArranger({
        container: arrangerEl, engine: trackEngine, transport, history, markers,
        cfg: {
          onSelectionChange: (s) => {
            if (s) trackEngine.selectStepClip(s.trackId, s.clipId);
            if (pianoRoll) pianoRoll.setSelection(s);
          },
          getAssetName,
          getAudioPeaks,
        },
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
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
    else if (k === 'z' && e.shiftKey) { e.preventDefault(); history.redo(); }
    else if (k === 'y') { e.preventDefault(); history.redo(); }
  });

  // Route keyboard presses into the recorder engine (monitor + record).
  recNoteOn = (n) => trackEngine.noteOn(resolveNote(n) || n);
  recNoteOff = (n) => trackEngine.noteOff(resolveNote(n) || n);

  // Unified project persistence: one versioned snapshot (rack + tracks + tempo).
  // Media-pool manifest (M4): metadata only — binary audio lives in the
  // IndexedDB asset store. Mutated by the media pool import UI, persisted
  // here so save/load round-trips keep every referenced hash.
  // (projectAssets itself is declared above the arranger wiring.)

  const { captureProject, applyProject, getProjectName, setProjectName } = createProjectSession({
    components, router, prepareRack, trackEngine, transport,
    markers, history, recorderUI, arranger,
    getAssets: () => projectAssets,
    setAssets: assets => { projectAssets = assets; },
  });

  const projectStore = createProjectStore({
    capture: captureProject,
    apply: applyProject,
    onError: (error) => {
      const status = document.getElementById('saveStatus');
      if (status) status.textContent = 'Сохранение недоступно: ' + error.message;
    },
  });

  // Event-based autosave (P0): rack mutations, history, and transport state
  // changes mark the store dirty; unchanged content is never rewritten
  // (revision check inside the store). No MutationObserver, no blind interval.
  setOnMutate(() => projectStore.markDirty());
  rack.addEventListener('change', () => projectStore.markDirty());
  history.subscribe(() => projectStore.markDirty());
  transport.onStateChange(() => projectStore.markDirty());

  // Save-status line: dirty / saved time / error. Bundle operations set
  // their own message afterwards (they save synchronously first).
  function renderSaveStatus(s) {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    if (s.state === 'error') el.textContent = 'Сохранение недоступно: ' + (s.error || 'error');
    else if (s.state === 'dirty') el.textContent = '● Есть несохранённые изменения…';
    else if (s.state === 'saved' && s.savedAt) {
      try { el.textContent = 'Сохранено ' + new Date(s.savedAt).toLocaleTimeString(); }
      catch (e) { el.textContent = 'Сохранено'; }
    }
  }
  projectStore.subscribe(renderSaveStatus);

  const restored = projectStore.restore();
  if (!restored) {
    // Nothing (or unreadable data) under the main key: offer the newest
    // backup snapshot instead of an empty session.
    let snap = null;
    try { snap = projectStore.recoverSnapshot(); } catch (e) { snap = null; }
    if (snap) {
      applyProject(snap);
      projectStore.saveNow();
      const el = document.getElementById('saveStatus');
      if (el) el.textContent = 'Восстановлено из резервной копии'
        + (projectStore.isBlocked() ? ' (основное сохранение не читается)' : '');
    }
  }
  if (recorderUI) recorderUI.renderAll();
  if (arranger) arranger.render();

  // Media pool (M4): import UI over the shared asset store. Created after
  // restore so the first refresh already sees the restored assets manifest.
  const mediaPoolEl = document.getElementById('mediaPool');
  const mediaPool = mediaPoolEl
    ? createMediaPool({
        container: mediaPoolEl,
        ctx,
        destination: masterGain,
        store: assetStore,
        getAssets: () => projectAssets,
        setAssets: (arr) => { projectAssets = arr; projectStore.markDirty(); },
        onAddClip: addAudioClipToActiveTrack,
        isReferenced: hash => trackEngine.getTracks().some(t => t.clips.some(c => c.audio?.hash === hash)),
      })
    : null;

  // Audio input (M4 recording): device picker + monitor + meter + take REC.
  // Device selection is session-local and never persisted.
  const audioInputEl = document.getElementById('audioInput');
  const audioInput = audioInputEl
    ? createInputUI({
        container: audioInputEl,
        ctx,
        destination: masterGain,
        take: {
          engine: trackEngine,
          history,
          transport,
          store: assetStore,
          getAssets: () => projectAssets,
          setAssets: (arr) => { projectAssets = arr; projectStore.markDirty(); },
        },
      })
    : null;

  router.drawConnections();

  // Flush a pending autosave before the page goes away (localStorage is
  // synchronous, so this actually lands).
  const flushAutosave = () => { try { projectStore.flush(); } catch (e) {} };
  window.addEventListener('beforeunload', flushAutosave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAutosave();
  });

  // Portable project files (P0): NEW / OPEN / SAVE / SAVE AS move the whole
  // song plus its audio as one JSON bundle. SAVE PATCH stays rack-only.
  // Autosave (localStorage + IndexedDB) never leaves this browser profile.
  function projectStatus(text) {
    const el = document.getElementById('saveStatus');
    if (el) el.textContent = text;
  }
  function confirmDiscard() {
    try {
      if (history.state().dirty) return window.confirm('Unsaved changes will be lost. Continue?');
    } catch (e) {}
    return true;
  }
  async function saveBundleAs(name) {
    setProjectName(name);
    const bundle = await exportBundle({ project: captureProject(), store: assetStore });
    const filename = sanitizeFileName(name) + '.sidproject.json';
    downloadText(filename, JSON.stringify(bundle));
    projectStore.saveNow();
    history.markSaved();
    const miss = bundle.mediaMissing ? bundle.mediaMissing.length : 0;
    projectStatus('Saved ' + filename + ' (' + bundle.media.length + ' audio files'
      + (miss ? ', ' + miss + ' missing from this browser' : '') + ')');
  }
  function refreshPool() {
    if (mediaPool && typeof mediaPool.refresh === 'function') {
      try { mediaPool.refresh(); } catch (e) {}
    }
  }
  const projNew = document.getElementById('projNew');
  const projOpen = document.getElementById('projOpen');
  const projSave = document.getElementById('projSave');
  const projSaveAs = document.getElementById('projSaveAs');
  const projFile = document.getElementById('projFile');
  if (projNew) projNew.onclick = () => {
    if (!confirmDiscard()) return;
    applyProject(defaultProject());
    projectStore.saveNow();
    history.reset();
    history.markSaved();
    refreshPool();
    projectStatus('New project');
  };
  if (projOpen && projFile) {
    projOpen.onclick = () => projFile.click();
    projFile.onchange = () => {
      const file = projFile.files && projFile.files[0];
      projFile.value = '';
      if (!file) return;
      (async () => {
        const { project, imported, skipped } = await importBundle(await readFileText(file), { store: assetStore });
        if (!confirmDiscard()) return;
        applyProject(project);
        projectStore.saveNow();
        history.reset();
        history.markSaved();
        refreshPool();
        projectStatus('Opened ' + (project.name || file.name) + ' (' + imported.length + ' audio files'
          + (skipped.length ? ', ' + skipped.length + ' skipped' : '') + ')');
      })().catch(err => projectStatus('Open failed: ' + (err.message || err)));
    };
  }
  if (projSave) projSave.onclick = () => {
    saveBundleAs(getProjectName()).catch(err => projectStatus('Save failed: ' + (err.message || err)));
  };
  if (projSaveAs) projSaveAs.onclick = () => {
    let name = null;
    try { name = window.prompt('Project name', getProjectName()); } catch (e) {}
    if (name) saveBundleAs(name).catch(err => projectStatus('Save failed: ' + (err.message || err)));
  };
})();
