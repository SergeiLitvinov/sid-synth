import { initMidi } from '../src/services/midi.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];
const queue = [];

function check(name, fn) {
  queue.push({ name, fn });
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Fake WebMIDI access with two hot-pluggable inputs.
function makeAccess() {
  const inputs = new Map();
  const mk = (id) => ({ id, name: 'Keys ' + id, manufacturer: 'Test', onmidimessage: null, _sidBound: false });
  inputs.set('devA', mk('devA'));
  inputs.set('devB', mk('devB'));
  return { inputs, onstatechange: null };
}

let stubAccess = null;
let stubOk = false;
try {
  stubAccess = makeAccess();
  navigator.requestMIDIAccess = async () => stubAccess;
  stubOk = true;
} catch (e) {
  stubOk = false;
}

// Boot one API behind a real button click (initMidi binds init to click).
async function bootApi(cbs = {}) {
  if (!stubOk) throw new Error('WebMIDI stub unavailable in this browser');
  stubAccess = makeAccess();
  navigator.requestMIDIAccess = async () => stubAccess;
  const ctx = { state: 'running', resume() {} };
  const btn = document.createElement('button');
  document.body.appendChild(btn);
  const api = initMidi({ button: btn, statusEl: null, ctx, ...cbs });
  btn.click();
  await sleep(50);
  return { api, access: stubAccess, btn };
}

function closeApi(t) {
  try { t.api.destroy(); } catch (e) {}
  t.btn.remove();
}

check('note on/off carry channel, velocity and the source device id', async () => {
  const seen = [];
  const t = await bootApi({
    onNoteOn: (n, ch, vel, dev) => seen.push(['on', n, ch, vel, dev]),
    onNoteOff: (n, ch, dev) => seen.push(['off', n, ch, dev]),
  });
  t.access.inputs.get('devA').onmidimessage({ data: [0x90, 60, 100] });
  t.access.inputs.get('devB').onmidimessage({ data: [0x80, 60, 0] });
  t.access.inputs.get('devA').onmidimessage({ data: [0x90, 60, 0] }); // vel-0 off
  closeApi(t);
  return seen.length === 3
    && seen[0].join(',') === 'on,C4,1,100,devA'
    && seen[1].join(',') === 'off,C4,1,devB'
    && seen[2].join(',') === 'off,C4,1,devA';
});

check('CC123 fires panic, other CCs route with the device id', async () => {
  const cc = [];
  let panics = 0;
  const t = await bootApi({
    onCC: (ch, c, v, dev) => cc.push([ch, c, v, dev]),
    onPanic: () => panics++,
  });
  t.access.inputs.get('devA').onmidimessage({ data: [0xB0, 7, 90] });
  t.access.inputs.get('devB').onmidimessage({ data: [0xB1, 123, 0] });
  closeApi(t);
  return cc.length === 1 && cc[0].join(',') === '1,7,90,devA' && panics === 1;
});

check('pitch bend scales 14-bit with the device id', async () => {
  const bends = [];
  const t = await bootApi({ onPitchBend: (ch, v, dev) => bends.push([ch, v, dev]) });
  t.access.inputs.get('devA').onmidimessage({ data: [0xE0, 0x00, 0x40] }); // center
  t.access.inputs.get('devA').onmidimessage({ data: [0xE7, 0x7F, 0x7F] }); // max
  closeApi(t);
  return bends.length === 2 && Math.abs(bends[0][1]) < 1e-9 && bends[0][2] === 'devA'
    && Math.abs(bends[1][1] - 8191 / 8192) < 1e-6;
});

check('channel pressure calls onPressure, else aliases to CC1', async () => {
  const pr = [];
  const cc = [];
  const t = await bootApi({
    onPressure: (ch, v, dev) => pr.push([ch, v, dev]),
    onCC: (ch, c, v) => cc.push([ch, c, v]),
  });
  t.access.inputs.get('devA').onmidimessage({ data: [0xD0, 64, 0] });
  closeApi(t);
  const t2 = await bootApi({ onCC: (ch, c, v) => cc.push([ch, c, v]) });
  t2.access.inputs.get('devA').onmidimessage({ data: [0xD0, 64, 0] });
  closeApi(t2);
  return pr.length === 1 && Math.abs(pr[0][1] - 64 / 127) < 1e-9 && pr[0][2] === 'devA'
    && cc.length === 1 && cc[0].join(',') === '1,1,64';
});

check('disconnect releases exactly the notes its device was holding', async () => {
  const offs = [];
  let lost = null;
  const t = await bootApi({
    onNoteOn: () => {},
    onNoteOff: (n, ch, dev) => offs.push([n, ch, dev]),
    onDeviceLost: (dev, held) => { lost = { dev, held }; },
  });
  t.access.inputs.get('devA').onmidimessage({ data: [0x90, 60, 100] }); // C4 ch1
  t.access.inputs.get('devA').onmidimessage({ data: [0x91, 62, 100] }); // D4 ch2
  t.access.inputs.get('devB').onmidimessage({ data: [0x90, 60, 100] }); // C4 ch1
  t.access.inputs.delete('devA');
  t.access.onstatechange();
  closeApi(t);
  const names = lost ? lost.held.map(h => h.channel + ':' + h.note).sort() : [];
  return lost && lost.dev === 'devA' && offs.length === 0
    && names.join(',') === '1:C4,2:D4';
});

check('selectDevice scopes input, destroy unbinds handlers', async () => {
  const seen = [];
  const t = await bootApi({ onNoteOn: (n) => seen.push(n) });
  t.api.selectDevice('devB');
  const scoped = t.access.inputs.get('devA').onmidimessage === null;
  t.access.inputs.get('devB').onmidimessage({ data: [0x90, 60, 100] });
  const routed = seen.length === 1;
  t.api.destroy();
  const unbound = t.access.inputs.get('devB').onmidimessage === null;
  closeApi(t);
  return scoped && routed && unbound;
});

check('program change calls onProgram with the device id', async () => {
  const pgm = [];
  const t = await bootApi({ onProgram: (ch, p, dev) => pgm.push([ch, p, dev]) });
  t.access.inputs.get('devB').onmidimessage({ data: [0xC2, 5, 0] });
  closeApi(t);
  return pgm.length === 1 && pgm[0].join(',') === '3,5,devB';
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
