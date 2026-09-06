import {
  listInputDevices, requestInputStream, stopStream, createInputMonitor,
} from '../src/audio/index.js';
import { createInputUI } from '../src/audio/index.js';

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
  const ok = ui.getDeviceId() === '' && !ui.isMonitoring();
  ui.dispose();
  el.remove();
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
