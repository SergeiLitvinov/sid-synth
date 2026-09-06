import { normalizeAudioRef, createAudioEngine } from '../src/audio/audioEngine.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];
const queue = [];

function check(name, fn) {
  queue.push({ name, fn });
}

// Scriptable fake context: records source starts/stops and gain automation
// so scheduling math (offsets, catch-up, fades) asserts exactly.
function makeFakeCtx(testBuffer) {
  const calls = { starts: [], stops: [], params: [] };
  const sources = [];
  const mkParam = () => ({
    value: 1,
    setValueAtTime(v, t) { calls.params.push(['set', v, t]); },
    linearRampToValueAtTime(v, t) { calls.params.push(['ramp', v, t]); },
    cancelScheduledValues(t) { calls.params.push(['cancel', t]); },
  });
  return {
    calls,
    sources,
    currentTime: 100,
    destination: {},
    createBufferSource() {
      const s = {
        buffer: null,
        ended: null,
        start(...a) { calls.starts.push(a); },
        stop(...a) { calls.stops.push(a); },
        connect() {},
        disconnect() {},
        set onended(fn) { this.ended = fn; },
        get onended() { return this.ended; },
      };
      sources.push(s);
      return s;
    },
    createGain() {
      return { gain: mkParam(), connect() {}, disconnect() {} };
    },
    decodeAudioData: async () => testBuffer,
  };
}

function fakeStore(blobBytes) {
  return {
    get: async (h) => (h === 'h1'
      ? { hash: 'h1', blob: { arrayBuffer: async () => new Uint8Array(blobBytes).buffer } }
      : null),
  };
}

const TEST_BUFFER = { duration: 20 };

check('normalizeAudioRef passes valid refs with defaults', () => {
  const a = normalizeAudioRef({ hash: 'h' });
  return a.hash === 'h' && a.offset === 0 && a.gain === 1 && a.fadeIn === 0 && a.fadeOut === 0;
});
check('normalizeAudioRef clamps junk and rejects hashless refs', () => {
  const a = normalizeAudioRef({ hash: 'h', offset: -2, gain: -1, fadeIn: -1 });
  return a.offset === 0 && a.gain === 1 && a.fadeIn === 0
    && normalizeAudioRef(null) === null && normalizeAudioRef({}) === null
    && normalizeAudioRef('h1') === null;
});
check('playClip starts the source with when/offset/duration', async () => {
  const ctx = makeFakeCtx(TEST_BUFFER);
  const engine = createAudioEngine({ ctx, store: fakeStore([1, 2]) });
  const h = await engine.playClip({ hash: 'h1', when: 100.5, offset: 0.25, duration: 1.0, gain: 0.8, destination: {} });
  const [w, off, dur] = ctx.calls.starts[0];
  return !!h && ctx.calls.starts.length === 1 && w === 100.5 && off === 0.25 && dur === 1.0
    && ctx.calls.params.some(p => p[0] === 'set' && p[1] === 0.8)
    && engine.activeCount() === 1;
});
check('playClip trims late starts to the remainder', async () => {
  const ctx = makeFakeCtx(TEST_BUFFER);
  const engine = createAudioEngine({ ctx, store: fakeStore([1]) });
  // Ends at 90+15=105, now is 100: 5s remain from offset 2+10=12.
  const h = await engine.playClip({ hash: 'h1', when: 90, offset: 2, duration: 15, destination: {} });
  const [w, off, dur] = ctx.calls.starts[0];
  return !!h && w === 100 && off === 12 && dur === 5;
});
check('playClip drops fully-late starts', async () => {
  const ctx = makeFakeCtx(TEST_BUFFER);
  const engine = createAudioEngine({ ctx, store: fakeStore([1]) });
  // Ends at 90+5=95, now is 100: nothing remains.
  const h = await engine.playClip({ hash: 'h1', when: 90, offset: 2, duration: 5, destination: {} });
  return h === null && ctx.calls.starts.length === 0;
});
check('playClip returns null for missing blobs without starting', async () => {
  const ctx = makeFakeCtx(TEST_BUFFER);
  const engine = createAudioEngine({ ctx, store: fakeStore([1]) });
  const h = await engine.playClip({ hash: 'nope', when: 100, destination: {} });
  return h === null && ctx.sources.length === 0 && engine.activeCount() === 0;
});
check('playClip stopped while decoding resolves null', async () => {
  const ctx = makeFakeCtx(TEST_BUFFER);
  let resolveGet;
  const store = { get: () => new Promise(res => { resolveGet = res; }) };
  const engine = createAudioEngine({ ctx, store });
  const pending = engine.playClip({ hash: 'h1', when: 100, destination: {} });
  engine.stopAll();
  resolveGet({ hash: 'h1', blob: { arrayBuffer: async () => new ArrayBuffer(8) } });
  const h = await pending;
  return h === null && ctx.sources.length === 0;
});
check('playClip writes fade automation around clip gain', async () => {
  const ctx = makeFakeCtx(TEST_BUFFER);
  const engine = createAudioEngine({ ctx, store: fakeStore([1]) });
  await engine.playClip({ hash: 'h1', when: 100, duration: 1.0, gain: 0.8, fadeIn: 0.1, fadeOut: 0.2, destination: {} });
  const seq = ctx.calls.params.map(p => p[0]).join(',');
  return seq === 'cancel,set,ramp,set,ramp';
});
check('stopAll stops actives and onended untracks', async () => {
  const ctx = makeFakeCtx(TEST_BUFFER);
  const engine = createAudioEngine({ ctx, store: fakeStore([1]) });
  await engine.playClip({ hash: 'h1', when: 100, duration: 1.0, destination: {} });
  if (engine.activeCount() !== 1) return false;
  ctx.sources[0].ended();
  if (engine.activeCount() !== 0) return false;
  await engine.playClip({ hash: 'h1', when: 100, duration: 1.0, destination: {} });
  engine.stopAll();
  // Scheduled stops carry a when-arg; the immediate stopAll stop has none.
  const immediate = ctx.calls.stops.filter(a => a.length === 0);
  return immediate.length === 1 && engine.activeCount() === 0;
});
check('playClip clamps duration to the buffer end', async () => {
  const ctx = makeFakeCtx({ duration: 2.0 });
  const engine = createAudioEngine({ ctx, store: fakeStore([1]) });
  await engine.playClip({ hash: 'h1', when: 100, offset: 0.5, duration: 50, destination: {} });
  return ctx.calls.starts[0][2] === 1.5;
});
check('real context decodes, plays and stops without throwing', async () => {
  const ctx = new AudioContext();
  try {
    // Tiny synthetic WAV: decodeAudioData exercises the real pipeline.
    const n = 800;
    const raw = new ArrayBuffer(44 + n * 2);
    const v = new DataView(raw);
    const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    wstr(8, 'WAVE');
    wstr(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true);
    v.setUint32(28, 16000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    wstr(36, 'data');
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, 1000, true);
    const store = { get: async () => ({ hash: 'h1', blob: new Blob([raw], { type: 'audio/wav' }) }) };
    const engine = createAudioEngine({ ctx, store });
    const h = await engine.playClip({ hash: 'h1', when: ctx.currentTime + 0.05, duration: 0.05, destination: ctx.destination });
    const playing = !!h && engine.activeCount() === 1;
    if (h) h.stop();
    const stopped = engine.activeCount() === 0;
    try { await ctx.close(); } catch (e) {}
    return playing && stopped;
  } catch (e) {
    try { await ctx.close(); } catch (err) {}
    throw e;
  }
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
