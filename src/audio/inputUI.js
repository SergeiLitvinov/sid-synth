import { listInputDevices, requestInputStream, stopStream, createInputMonitor } from './audioInput.js';

// Input panel UI (M4 recording): device picker, monitor arm toggle and a
// live level meter over the input monitor path. Capture (take recording)
// arrives in the next slice; this panel only selects, monitors and meters.
// Device ids are not persisted (they are not portable across sessions).
export function createInputUI({ container, ctx, destination, deps } = {}) {
  const el = container;
  el.classList.add('audio-input');
  const listDevices = (deps && deps.list) || listInputDevices;
  const requestStream = (deps && deps.request) || requestInputStream;
  let stream = null;
  let monitor = null;
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

  select.addEventListener('change', onSelect);
  refreshBtn.addEventListener('click', onRefresh);
  monBtn.addEventListener('click', onMon);

  function dispose() {
    teardownStream();
    select.removeEventListener('change', onSelect);
    refreshBtn.removeEventListener('click', onRefresh);
    monBtn.removeEventListener('click', onMon);
  }

  refreshDevices().catch(err => setStatus(err.message));

  return {
    el, refreshDevices, selectDevice, updateMeter, dispose,
    getStatus: () => statusText,
    getDeviceId: () => deviceId,
    isMonitoring: () => !!(monitor && monitor.isMonitoring()),
  };
}
