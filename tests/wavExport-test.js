import { encodeWAV } from '../src/services/wavExport.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];

const tasks = [];

function check(name, fn) {
  tasks.push(async () => {
    try {
      const r = await fn();
      if (r === false) throw new Error('assertion returned false');
      passed.push(name);
      const li = document.createElement('li');
      li.textContent = 'PASS  ' + name;
      results.appendChild(li);
    } catch (err) {
      failed.push(name);
      const li = document.createElement('li');
      li.className = 'fail';
      li.textContent = 'FAIL  ' + name + ': ' + err.message;
      results.appendChild(li);
    }
  });
}

async function readHeader(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const str = (off, len) => String.fromCharCode.apply(null, buf.subarray(off, off + len));
  const dv = new DataView(buf.buffer);
  return {
    riff: str(0, 4),
    wave: str(8, 4),
    fmt: str(12, 4),
    data: str(36, 4),
    riffSize: dv.getUint32(4, true),
    fmtSize: dv.getUint32(16, true),
    audioFormat: dv.getUint16(20, true),
    numCh: dv.getUint16(22, true),
    sampleRate: dv.getUint32(24, true),
    byteRate: dv.getUint32(28, true),
    blockAlign: dv.getUint16(32, true),
    bits: dv.getUint16(34, true),
    dataSize: dv.getUint32(40, true),
    dataStart: 44,
    size: blob.size,
    type: blob.type,
  };
}

check('mono silence: RIFF/WAVE header, data chunk, sizes', async () => {
  const blob = encodeWAV(new Float32Array(10), 44100);
  const h = await readHeader(blob);
  return h.riff === 'RIFF' && h.wave === 'WAVE' && h.fmt === 'fmt ' && h.data === 'data'
    && h.size === 44 + 10 * 2 && h.dataSize === 10 * 2
    && h.riffSize === 36 + 20 && h.type === 'audio/wav';
});

check('format fields: PCM, mono, 16-bit, sampleRate, byteRate, blockAlign', async () => {
  const blob = encodeWAV(new Float32Array(4), 48000);
  const h = await readHeader(blob);
  return h.audioFormat === 1 && h.numCh === 1 && h.bits === 16
    && h.sampleRate === 48000 && h.fmtSize === 16
    && h.byteRate === 48000 * 2 && h.blockAlign === 2;
});

check('sample values map: 0 -> 0x0000, +1 -> 0x7FFF, -1 -> 0x8000', async () => {
  const blob = encodeWAV(new Float32Array([0, 1, -1]), 44100);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  return dv.getInt16(44, true) === 0
    && dv.getInt16(46, true) === 0x7fff
    && dv.getInt16(48, true) === -0x8000;
});

check('samples are clamped to [-1, 1]', async () => {
  const blob = encodeWAV(new Float32Array([2, -2, 0.5]), 44100);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  return dv.getInt16(44, true) === 0x7fff
    && dv.getInt16(46, true) === -0x8000
    && dv.getInt16(48, true) === Math.round(0.5 * 0x7fff);
});

check('stereo: two channels interleaved L/R', async () => {
  const left = new Float32Array([0.5, 0.25]);
  const right = new Float32Array([-0.5, -0.25]);
  const blob = encodeWAV([left, right], 44100);
  const h = await readHeader(blob);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  return h.numCh === 2 && h.blockAlign === 4 && h.dataSize === 2 * 2 * 2
    && dv.getInt16(44, true) === Math.round(0.5 * 0x7fff)
    && dv.getInt16(46, true) === Math.round(-0.5 * 0x8000)
    && dv.getInt16(48, true) === Math.round(0.25 * 0x7fff)
    && dv.getInt16(50, true) === Math.round(-0.25 * 0x8000);
});

check('missing/empty channels are encoded as silence', async () => {
  const blob = encodeWAV(new Float32Array(0), 44100);
  const h = await readHeader(blob);
  return h.dataSize === 0 && h.size === 44;
});

check('negative frame in right channel stays within int16 range', async () => {
  const blob = encodeWAV([new Float32Array([0]), new Float32Array([-1])], 44100);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  return dv.getInt16(46, true) === -0x8000;
});

check('a longer buffer keeps a consistent dataSize = frames * blockAlign', async () => {
  const frames = 1000;
  const blob = encodeWAV([new Float32Array(frames), new Float32Array(frames)], 22050);
  const h = await readHeader(blob);
  return h.dataSize === 1000 * 4 && h.size === 44 + 4000 && h.byteRate === 22050 * 4;
});

(async () => {
  for (const t of tasks) await t();
  const total = passed.length + failed.length;
  const ok = failed.length === 0;
  summary.textContent = `${passed.length}/${total} PASS${ok ? '' : ' (' + failed.join(', ') + ')'}`;
  summary.style.color = ok ? '#4af74a' : '#ff4444';
})();