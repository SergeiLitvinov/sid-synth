import { listInputDevices, requestInputStream, stopStream, createInputMonitor } from './audioInput.js';
import { createTakeRecorder, finalizeTake } from './capture.js';
import { addClipCommand } from '../project/trackCommands.js';
import { ticksPerSecond } from '../project/clipEvents.js';

// Manual latency trim persistence (device-specific value, intentionally
// outside the project JSON — it describes the hardware, not the song).
export const INPUT_LATENCY_KEY = 'sidSynthInputLatencyMs';

// Measured output pipeline latency, seconds. First-order estimate for take
// placement; true loopback calibration needs a physical loop, so the manual
// trim below covers the remainder.
export function measureOutputLatency(ctx) {
  if (!ctx) return 0;
  const out = typeof ctx.outputLatency === 'number' ? ctx.outputLatency : 0;
  const base = typeof ctx.baseLatency === 'number' ? ctx.baseLatency : 0;
  return Math.max(0, out + base);
}

// Input panel UI (M4 recording): device picker, monitor arm toggle, live
// level meter, and — when take deps are provided — a take REC button that
// captures the input into an asset and drops an audio clip on the active
// track at the position where recording started. Device ids are not
// persisted (they are not portable across sessions).
export function createInputUI({ container, ctx, destination, deps, take } = {}) {
  const el = container;
  el.classList.add('audio-input');
  const listDevices = (deps && deps.list) || listInputDevices;
  const requestStream = (deps && deps.request) || requestInputStream;
  const takeCfg = take || null;
  let stream = null;
  let monitor = null;
  let sourceNode = null;
  let recorder = null;
  let takeStartTicks = 0;
  let takeCount = 0;
  let deviceId = '';
  let rafId = 0;
  let statusText = '';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'INPUT';

  const toolbar = document.createElement('div');
  toolbar.className = 'inp-toolbar';
  const select = document.createElement('select');
  select.className = 'inp-select';
  select.id = 'inpDevice';
  select.title = 'Input device';
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'rec-btn';
  refreshBtn.textContent = '⟳';
  refreshBtn.title = 'Refresh device list';
  const monBtn = document.createElement('button');
  monBtn.className = 'rec-btn inp-mon';
  monBtn.id = 'inpMon';
  monBtn.textContent = 'MON';
  monBtn.title = 'Monitor input through the speakers (feedback guard: off by default)';
  const meter = document.createElement('canvas');
  meter.className = 'inp-meter';
  meter.id = 'inpMeter';
  meter.width = 120;
  meter.height = 12;
  const status = document.createElement('div');
  status.className = 'inp-status';

  toolbar.append(select, refreshBtn, monBtn, meter);
  // Take REC lives only when the host wires engine/history/transport/store.
  let recBtn = null;
  if (takeCfg && takeCfg.engine && takeCfg.store) {
    recBtn = document.createElement('button');
    recBtn.className = 'rec-btn inp-rec';
    recBtn.id = 'inpRec';
    recBtn.textContent = '●';
    recBtn.title = 'Record a take into an audio clip on the active track';
    toolbar.append(recBtn);
  }
  // Latency calibration row: measured system latency (read-only) plus a
  // manual trim in ms, persisted across sessions. Takes are placed earlier
  // by system + trim so captured audio lands in sync.
  const latRow = document.createElement('div');
  latRow.className = 'inp-latrow';
  const latName = document.createElement('span');
  latName.className = 'inp-lat-name';
  latName.textContent = 'latency';
  const latSys = document.createElement('span');
  latSys.className = 'inp-lat-sys';
  const latTrim = document.createElement('input');
  latTrim.type = 'number';
  latTrim.className = 'inp-lat-trim';
  latTrim.id = 'inpLatTrim';
  latTrim.min = '-500';
  latTrim.max = '500';
  latTrim.step = '0.5';
  latTrim.title = 'Manual latency trim in ms (added to the measured system value)';
  latRow.append(latName, latSys, latTrim);
  el.append(title, toolbar, latRow, status);

  function setStatus(text) {
    statusText = text;
    status.textContent = text;
  }

  function readTrimMs() {
    let saved = 0;
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(INPUT_LATENCY_KEY) : null;
      if (raw !== null) saved = parseFloat(raw);
    } catch (e) {}
    return Number.isFinite(saved) ? Math.max(-500, Math.min(500, saved)) : 0;
  }

  function getLatencySec() {
    const trim = parseFloat(latTrim.value);
    const trimMs = Number.isFinite(trim) ? trim : 0;
    return Math.max(0, measureOutputLatency(ctx) + trimMs / 1000);
  }

  latTrim.value = String(readTrimMs());
  function refreshSysLabel() {
    // outputLatency estimates settle asynchronously after context start —
    // re-read late (device select, take finalize) rather than caching.
    latSys.textContent = (measureOutputLatency(ctx) * 1000).toFixed(1) + 'ms sys';
  }
  refreshSysLabel();
  latSys.title = 'Measured output pipeline latency (baseLatency + outputLatency)';
  latTrim.addEventListener('change', () => {
    const v = parseFloat(latTrim.value);
    if (!Number.isFinite(v)) {
      latTrim.value = String(readTrimMs());
      return;
    }
    const clamped = Math.max(-500, Math.min(500, v));
    latTrim.value = String(clamped);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(INPUT_LATENCY_KEY, String(clamped));
    } catch (e) {}
  });

  function stopLoop() {
    if (rafId) {
      try { cancelAnimationFrame(rafId); } catch (e) {}
      rafId = 0;
    }
  }

  function updateMeter() {
    if (monitor) {
      try { monitor.drawMeter(meter); } catch (e) {}
    } else {
      const g = meter.getContext('2d');
      if (g) {
        g.clearRect(0, 0, meter.width, meter.height);
        g.fillStyle = '#0a0f0a';
        g.fillRect(0, 0, meter.width, meter.height);
      }
    }
  }

  function loopMeter() {
    stopLoop();
    const frame = () => {
      updateMeter();
      rafId = requestAnimationFrame(frame);
    };
    if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(frame);
  }

  function teardownStream() {
    stopLoop();
    if (recorder && recorder.isRecording()) {
      recorder.stop();
      if (recBtn) recBtn.classList.remove('on');
    }
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch (e) {}
      sourceNode = null;
    }
    if (monitor) {
      try { monitor.dispose(); } catch (e) {}
      monitor = null;
    }
    if (stream) {
      stopStream(stream);
      stream = null;
    }
    monBtn.classList.remove('on');
    updateMeter();
  }

  async function refreshDevices() {
    let devs = [];
    try {
      devs = await listDevices();
    } catch (e) {
      setStatus('device list failed: ' + (e.message || e));
      return devs;
    }
    while (select.firstChild) select.removeChild(select.firstChild);
    devs.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId || '';
      o.textContent = d.label || ('Input ' + (i + 1));
      select.appendChild(o);
    });
    if (!devs.length) setStatus('no input devices found');
    else if (!statusText) setStatus(devs.length + ' input(s)');
    return devs;
  }

  async function selectDevice(id) {
    teardownStream();
    deviceId = id || '';
    if (!ctx) {
      setStatus('no audio context');
      return false;
    }
    try {
      stream = await requestStream({ deviceId: deviceId || undefined });
    } catch (e) {
      setStatus('input failed: ' + (e.message || e));
      return false;
    }
    try {
      monitor = createInputMonitor({ ctx, stream, destination });
    } catch (e) {
      stopStream(stream);
      stream = null;
      setStatus('monitor failed: ' + (e.message || e));
      return false;
    }
    try {
      sourceNode = ctx.createMediaStreamSource(stream);
    } catch (e) {
      sourceNode = null;
    }
    select.value = deviceId;
    loopMeter();
    updateMeter();
    refreshSysLabel();
    setStatus('input ready');
    return true;
  }

  function onSelect() {
    selectDevice(select.value).catch(err => setStatus(err.message));
  }
  function onRefresh() {
    teardownStream();
    refreshDevices().catch(err => setStatus(err.message));
  }
  function onMon() {
    if (!monitor) {
      setStatus('select an input first');
      return;
    }
    const on = monitor.setMonitoring(!monitor.isMonitoring());
    monBtn.classList.toggle('on', on);
  }

  function transportTicks() {
    try {
      if (takeCfg && takeCfg.transport && typeof takeCfg.transport.getState === 'function') {
        const s = takeCfg.transport.getState();
        if (s && typeof s.loopPosTicks === 'number') return Math.max(0, Math.round(s.loopPosTicks));
      }
    } catch (e) {}
    return 0;
  }

  function resolveTargetTrack() {
    const engine = takeCfg && takeCfg.engine;
    if (!engine || typeof engine.getTracks !== 'function') return null;
    const tracks = engine.getTracks() || [];
    if (!tracks.length) return null;
    const active = engine.activeTrackId;
    return (active && tracks.some(t => t.id === active) ? active : tracks[0].id);
  }

  function runCommand(cmd) {
    const history = takeCfg && takeCfg.history;
    if (history && typeof history.execute === 'function') history.execute(cmd);
    else if (typeof cmd.apply === 'function') cmd.apply();
  }

  // Take REC: toggles capture; on stop the take becomes an asset plus an
  // audio clip on the active track at the position where recording started.
  async function onRec() {
    if (!takeCfg) return;
    if (!recorder) {
      try {
        recorder = createTakeRecorder({ ctx });
      } catch (e) {
        setStatus('capture unavailable: ' + (e.message || e));
        return;
      }
    }
    if (recorder.isRecording()) {
      if (recBtn) recBtn.classList.remove('on');
      const take = recorder.stop();
      await finishTake(take);
      return;
    }
    if (!stream || !sourceNode) {
      setStatus('select an input first');
      return;
    }
    takeStartTicks = transportTicks();
    try {
      await recorder.start(sourceNode);
    } catch (e) {
      setStatus('record failed: ' + (e.message || e));
      return;
    }
    if (recBtn) recBtn.classList.add('on');
    setStatus('recording…');
  }

  async function finishTake(take) {
    if (!take || !take.audioBuffer || !(take.duration > 0)) {
      setStatus('empty take discarded');
      return null;
    }
    const { engine, store, getAssets, setAssets } = takeCfg;
    takeCount++;
    let res;
    try {
      res = await finalizeTake(take, { store, name: 'Take ' + takeCount + '.wav' });
    } catch (e) {
      setStatus('take failed: ' + (e.message || e));
      return null;
    }
    const manifest = typeof getAssets === 'function' ? getAssets().slice() : [];
    if (!manifest.some(a => a && a.hash === res.hash)) {
      manifest.push(res.asset);
      if (typeof setAssets === 'function') setAssets(manifest);
    }
    const targetId = resolveTargetTrack();
    if (targetId && engine) {
      const tps = ticksPerSecond(engine.bpm || 120, engine.ppq || 480);
      // Placement compensation: captured audio lags the transport by the
      // effective latency, so the clip starts earlier by that amount.
      const compTicks = Math.round(getLatencySec() * tps);
      const clip = {
        name: res.asset.name || 'Take',
        start: Math.max(0, takeStartTicks - compTicks),
        length: Math.max(480, Math.round(take.duration * tps)),
        events: [],
        audio: { hash: res.hash },
      };
      try {
        runCommand(addClipCommand(engine, targetId, clip));
      } catch (e) {
        if (typeof engine.addClip === 'function') engine.addClip(targetId, clip);
      }
    }
    setStatus('take ' + take.duration.toFixed(1) + 's → ' + res.asset.name);
    refreshSysLabel();
    return res;
  }

  select.addEventListener('change', onSelect);
  refreshBtn.addEventListener('click', onRefresh);
  monBtn.addEventListener('click', onMon);
  if (recBtn) recBtn.addEventListener('click', onRecClick);

  function onRecClick() {
    onRec().catch(err => setStatus(err.message));
  }

  function dispose() {
    teardownStream();
    select.removeEventListener('change', onSelect);
    refreshBtn.removeEventListener('click', onRefresh);
    monBtn.removeEventListener('click', onMon);
    if (recBtn) recBtn.removeEventListener('click', onRecClick);
  }

  refreshDevices().catch(err => setStatus(err.message));

  return {
    el, refreshDevices, selectDevice, updateMeter, dispose,
    getStatus: () => statusText,
    getDeviceId: () => deviceId,
    isMonitoring: () => !!(monitor && monitor.isMonitoring()),
    isRecording: () => !!(recorder && recorder.isRecording()),
    getTakeDuration: () => (recorder ? recorder.getDuration() : 0),
    getLatencySec,
  };
}
