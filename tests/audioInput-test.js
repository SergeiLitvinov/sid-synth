import {
  listInputDevices, requestInputStream, stopStream, createInputMonitor,
  createTakeRecorder, finalizeTake, ensureCaptureWorklet, createAssetStore,
} from '../src/audio/index.js';
import { createInputUI } from '../src/audio/index.js';
import { createHistory } from '../src/project/history.js';

const container = document.getElementById('container');
const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];
const queue = [];

function check(name, fn) {
  queue.push({ name, fn });
}

check('listInputDevices returns audioinput entries', async () => {
  const devs = await listInputDevices();
  return Array.isArray(devs) && devs.every(d => typeof d.deviceId === 'string');
});
check('listInputDevices degrades to [] without media APIs', async () => {
  return JSON.stringify(await listInputDevices({})) === '[]';
});
check('requestInputStream rejects unknown devices', async () => {
  let threw = false;
  try {
    await requestInputStream({ deviceId: '__no_such_device__' });
  } catch (e) {
    threw = true;
  }
  return threw;
});
check('requestInputStream throws without capture APIs', async () => {
  let threw = false;
  try {
    await requestInputStream({}, {});
  } catch (e) {
    threw = /capture unavailable/.test(e.message);
  }
  return threw;
});
check('stopStream stops tracks and tolerates junk', () => {
  let stopped = 0;
  stopStream({ getTracks: () => [{ stop() { stopped++; } }, { stop() { throw new Error('x'); } }] });
  stopStream(null);
  stopStream({});
  return stopped === 1;
});
check('input monitor gates speakers but always meters', async () => {
  const ctx = new AudioContext();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mon = createInputMonitor({ ctx, stream, destination: ctx.destination });
    const peak = mon.getPeak();
    const off = mon.isMonitoring();
    mon.setMonitoring(true);
    const gain = mon.setGain(0.5);
    const p2 = mon.getPeak();
    mon.dispose();
    stopStream(stream);
    try { await ctx.close(); } catch (e) {}
    return Number.isFinite(peak) && peak >= 0 && peak <= 1 && off === false
      && mon.isMonitoring() === true && gain === 0.5 && Number.isFinite(p2);
  } catch (e) {
    try { await ctx.close(); } catch (err) {}
    throw e;
  }
});
check('input monitor clamps gain and needs stream/context', async () => {
  const ctx = new AudioContext();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mon = createInputMonitor({ ctx, stream, destination: ctx.destination });
  const hi = mon.setGain(99);
  const lo = mon.setGain(-5);
  mon.dispose();
  stopStream(stream);
  let n = 0;
  try { createInputMonitor({ ctx, stream: new MediaStream() }); } catch (e) { n++; }
  try { createInputMonitor({ ctx: null, stream: new MediaStream() }); } catch (e) { n++; }
  try { await ctx.close(); } catch (e) {}
  return hi === 1.5 && lo === 0 && n === 2;
});
check('input UI renders picker, MON, meter and status', async () => {
  const el = document.createElement('div');
  container.appendChild(el);
  const ctx = new AudioContext();
  const ui = createInputUI({ container: el, ctx, destination: ctx.destination });
  await new Promise(res => setTimeout(res, 300));
  const ok = !!el.querySelector('#inpDevice') && !!el.querySelector('#inpMon')
    && !!el.querySelector('#inpMeter') && !!el.querySelector('.inp-status')
    && el.querySelector('.panel-title').textContent === 'INPUT';
  ui.dispose();
  el.remove();
  try { await ctx.close(); } catch (e) {}
  return ok;
});
check('input UI lists devices and arms the monitor', async () => {
  const el = document.createElement('div');
  container.appendChild(el);
  const ctx = new AudioContext();
  const ui = createInputUI({ container: el, ctx, destination: ctx.destination });
  const devs = await ui.refreshDevices();
  if (!devs.length) {
    ui.dispose();
    el.remove();
    try { await ctx.close(); } catch (e) {}
    return false;
  }
  const okSelect = await ui.selectDevice(devs[0].deviceId);
  el.querySelector('#inpMon').click();
  const armed = ui.isMonitoring()
    && el.querySelector('#inpMon').classList.contains('on');
  el.querySelector('#inpMon').click();
  const disarmed = !ui.isMonitoring();
  ui.dispose();
  el.remove();
  try { await ctx.close(); } catch (e) {}
  return okSelect && armed && disarmed;
});
check('input UI reports unknown devices without throwing', async () => {
  const el = document.createElement('div');
  container.appendChild(el);
  const ctx = new AudioContext();
  const ui = createInputUI({ container: el, ctx, destination: ctx.destination });
  const ok = await ui.selectDevice('__no_such_device__');
  const reported = /failed|unavailable|not found|constraint|overconstrained|notallowed/i.test(ui.getStatus());
  ui.dispose();
  el.remove();
  try { await ctx.close(); } catch (e) {}
  return ok === false && reported;
});
check('input UI meter draws without an active stream', () => {
  const el = document.createElement('div');
  container.appendChild(el);
  const ui = createInputUI({ container: el, ctx: new AudioContext(), destination: null });
  ui.updateMeter();
  const ok = ui.getDeviceId() === '' && !ui.isMonitoring() && !el.querySelector('#inpRec');
  ui.dispose();
  el.remove();
  return ok;
});
check('take recorder idles null and loads the worklet twice cleanly', async () => {
  const ctx = new AudioContext();
  try {
    await ensureCaptureWorklet(ctx);
    await ensureCaptureWorklet(ctx);
    const rec = createTakeRecorder({ ctx });
    const idle = rec.stop() === null && !rec.isRecording();
    let threw = false;
    try { await rec.start(null); } catch (e) { threw = true; }
    try { await ctx.close(); } catch (e) {}
    return idle && threw;
  } catch (e) {
    try { await ctx.close(); } catch (err) {}
    throw e;
  }
});
check('finalizeTake rejects empty takes', async () => {
  const store = createAssetStore({ dbName: 'sid-synth-assets-take-test' });
  await store.open();
  let threw = false;
  try {
    await finalizeTake({ audioBuffer: null, duration: 0 }, { store });
  } catch (e) {
    threw = /empty take/.test(e.message);
  }
  store.close();
  return threw;
});
check('REC captures a take into an asset and a track clip', async () => {
  const el = document.createElement('div');
  container.appendChild(el);
  const ctx = new AudioContext();
  const store = createAssetStore({ dbName: 'sid-synth-assets-take-test' });
  await store.open();
  await store.clear();
  let manifest = [];
  const placed = [];
  const engine = {
    activeTrackId: 'trk_a', bpm: 120, ppq: 480,
    getTracks: () => [{ id: 'trk_a', clips: [] }],
    addClip: (id, cfg) => { placed.push({ id, cfg }); return { id: 'clip_take', ...cfg }; },
  };
  const ui = createInputUI({
    container: el, ctx, destination: ctx.destination,
    take: {
      engine, history: createHistory(), transport: { getState: () => ({ loopPosTicks: 960 }) },
      store, getAssets: () => manifest, setAssets: (a) => { manifest = a; },
    },
  });
  const recBtn = el.querySelector('#inpRec');
  if (!recBtn) {
    ui.dispose();
    el.remove();
    try { await ctx.close(); } catch (e) {}
    store.close();
    return false;
  }
  const devs = await ui.refreshDevices();
  if (!devs.length) {
    ui.dispose();
    el.remove();
    try { await ctx.close(); } catch (e) {}
    store.close();
    return false;
  }
  if (!(await ui.selectDevice(devs[0].deviceId))) {
    ui.dispose();
    el.remove();
    try { await ctx.close(); } catch (e) {}
    store.close();
    return false;
  }
  recBtn.click();
  let waited = 0;
  while (!ui.isRecording() && waited < 3000) {
    await new Promise(res => setTimeout(res, 100));
    waited += 100;
  }
  const wasRecording = ui.isRecording();
  await new Promise(res => setTimeout(res, 500));
  recBtn.click();
  await new Promise(res => setTimeout(res, 1200));
  const clip = placed.length ? placed[0].cfg : null;
  const ok = wasRecording && manifest.length === 1 && !!clip
    && clip.start === 960 && clip.audio && typeof clip.audio.hash === 'string'
    && clip.length > 480 && /take .*s/.test(ui.getStatus());
  ui.dispose();
  el.remove();
  try { await ctx.close(); } catch (e) {}
  store.close();
  await new Promise(resolve => {
    const req = indexedDB.deleteDatabase('sid-synth-assets-take-test');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  return ok;
});

(async () => {
  for (const t of queue) {
    try {
      const r = await t.fn();
      if (r === false) throw new Error('assertion returned false');
      passed.push(t.name);
      const li = document.createElement('li');
      li.textContent = 'PASS  ' + t.name;
      results.appendChild(li);
    } catch (err) {
      failed.push(t.name);
      const li = document.createElement('li');
      li.className = 'fail';
      li.textContent = 'FAIL  ' + t.name + ': ' + err.message;
      results.appendChild(li);
    }
  }
  summary.textContent = 'SUMMARY: ' + passed.length + ' passed, ' + failed.length + ' failed';
  if (failed.length > 0) {
    summary.style.color = '#ff4444';
    summary.textContent += ' — ' + failed.join(', ');
  }
})();
