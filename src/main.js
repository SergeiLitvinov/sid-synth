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

  const { rack, components, router, createComponent, clearRack, playNote, stopAll, setTransport } = createRackController({ ctx, masterGain });

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
    onNoteOn: (note, channel, velocity) => trackEngine.noteOn(note, { channel, velocity }),
    onNoteOff: (note, channel) => trackEngine.noteOff(note, { channel }),
    onCC: (channel, cc, value) => {
      if (trackEngine) trackEngine.routeCC(channel, cc, value);
    },
    onPitchBend: (channel, value) => {
      if (trackEngine) trackEngine.routePitchBend(channel, value);
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
    ? createRecorderUI({ container: recorderEl, engine: trackEngine, history, exportWav, midiApi })
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

  const { captureProject, applyProject } = createProjectSession({
    components, router, createComponent, clearRack, trackEngine, transport,
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
  setInterval(() => projectStore.markDirty(), 3000);
})();
