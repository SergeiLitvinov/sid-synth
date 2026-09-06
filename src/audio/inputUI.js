import { listInputDevices, requestInputStream, stopStream, createInputMonitor } from './audioInput.js';
import { createTakeRecorder, finalizeTake } from './capture.js';
import { addClipCommand } from '../project/trackCommands.js';
import { ticksPerSecond } from '../project/clipEvents.js';

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
  el.append(title, toolbar, status);

  function setStatus(text) {
    statusText = text;
    status.textContent = text;
  }

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
      const clip = {
        name: res.asset.name || 'Take',
        start: takeStartTicks,
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
  };
}
