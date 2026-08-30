// Real-time WAV bounce (backlog #38). Renders the live mix into a 16-bit PCM
// WAV file by tapping the master bus with a ScriptProcessorNode while the
// transport plays, then encodes the captured samples with encodeWAV.
//
// encodeWAV is a pure helper (unit-tested); renderWav wires it to the live
// AudioContext and temporarily routes the master output through the tap.

export function encodeWAV(channels, sampleRate) {
  const list = channels instanceof Float32Array ? [channels] : channels;
  const numCh = list.length;
  const frames = list[0] ? list[0].length : 0;
  const blockAlign = numCh * 2;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const str = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, list[ch][i] || 0));
      view.setInt16(off, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
      off += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function renderWav({ ctx, masterGain, play, stop, bars = 4, bpm = 120 }) {
  const sampleRate = ctx.sampleRate || 44100;
  const loopDur = 240 / bpm; // one 16-step bar: 60/bpm * 4 beats
  const target = Math.max(1, Math.round(bars * loopDur * sampleRate));
  const channels = [new Float32Array(target), new Float32Array(target)];
  let got = 0;

  const spn = ctx.createScriptProcessor(4096, 2, 2);
  spn.onaudioprocess = (e) => {
    if (got >= target) return;
    const n = Math.min(e.inputBuffer.length, target - got);
    for (let c = 0; c < 2; c++) channels[c].set(e.inputBuffer.getChannelData(c).subarray(0, n), got);
    got += n;
  };

  const dest = ctx.destination;
  const routeThrough = () => {
    try { masterGain.disconnect(dest); } catch (e) {}
    masterGain.connect(spn);
    spn.connect(dest);
  };
  const restore = () => {
    try { spn.disconnect(dest); } catch (e) {}
    try { masterGain.disconnect(spn); } catch (e) {}
    masterGain.connect(dest);
  };

  stop();
  routeThrough();
  try {
    play();
    await sleep(bars * loopDur * 1000 + 250);
  } finally {
    stop();
    await sleep(120);
    restore();
  }

  const audio = [channels[0].subarray(0, got), channels[1].subarray(0, got)];
  return {
    blob: encodeWAV(audio, sampleRate),
    sampleRate,
    frames: got,
    duration: got / sampleRate,
    channels: 2,
  };
}