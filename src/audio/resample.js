// Resampling to the project sample rate (M4): decode and buffer-rate
// conversion go through an OfflineAudioContext at an explicit target rate,
// so imported audio always lands at the project rate by policy — not by
// whatever the decode context happens to run at. The source Blob (original
// file bytes + metadata) is stored untouched; only the decoded working
// buffer and the manifest metadata reflect the project rate.
export function projectSampleRate(ctx) {
  const r = ctx && typeof ctx.sampleRate === 'number' ? ctx.sampleRate : 0;
  if (!(r > 0)) throw new Error('resample: no sample rate on context');
  return r;
}

function ensureOffline() {
  if (typeof OfflineAudioContext === 'undefined') throw new Error('resample: OfflineAudioContext unavailable');
}

// Decode straight to the target rate in one step: the offline context's
// rate governs decodeAudioData resampling, so no second pass is needed.
export async function decodeAtSampleRate(arrayBuffer, targetRate) {
  if (!(targetRate > 0)) throw new Error('resample: invalid target rate');
  ensureOffline();
  if (!arrayBuffer || typeof arrayBuffer.slice !== 'function') {
    throw new Error('resample: expected an ArrayBuffer');
  }
  const off = new OfflineAudioContext(1, 1, targetRate);
  return off.decodeAudioData(arrayBuffer.slice(0));
}

// Render an existing AudioBuffer at another rate. Same-rate input is
// returned untouched (no copy, no render).
export async function resampleBuffer(audioBuffer, targetRate) {
  if (!(targetRate > 0)) throw new Error('resample: invalid target rate');
  if (!audioBuffer || typeof audioBuffer.sampleRate !== 'number') {
    throw new Error('resample: expected an AudioBuffer');
  }
  ensureOffline();
  if (audioBuffer.sampleRate === targetRate) return audioBuffer;
  const channels = audioBuffer.numberOfChannels || 1;
  const targetLen = Math.max(1, Math.ceil((audioBuffer.length * targetRate) / audioBuffer.sampleRate));
  const off = new OfflineAudioContext(channels, targetLen, targetRate);
  const src = off.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(off.destination);
  src.start(0);
  return off.startRendering();
}
