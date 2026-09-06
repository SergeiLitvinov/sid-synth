import { encodeWAV } from '../services/wavExport.js';
import { hashBuffer, normalizeAsset } from './assetStore.js';

// Take recording (M4): sample-accurate PCM capture through an AudioWorklet,
// finalized into a versioned stack — AudioBuffer, WAV Blob, asset-store
// record, project manifest entry. Latency calibration and punch/count-in
// arrive in later slices; the take stores its ctx start time so placement
// compensation can consume it.
let workletLoadedFor = new WeakSet();

export async function ensureCaptureWorklet(ctx) {
  if (!ctx || !ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') {
    throw new Error('capture: AudioWorklet unavailable');
  }
  if (workletLoadedFor.has(ctx)) return;
  await ctx.audioWorklet.addModule(new URL('./captureProcessor.js', import.meta.url));
  workletLoadedFor.add(ctx);
}

export function createTakeRecorder({ ctx } = {}) {
  if (!ctx) throw new Error('capture: no audio context');
  let node = null;
  let source = null;
  let chunks = [];
  let channels = 0;
  let startedAtCtx = 0;
  let recording = false;

  async function start(inputSource) {
    if (recording) return false;
    if (!inputSource || typeof inputSource.connect !== 'function') {
      throw new Error('capture: no input source');
    }
    await ensureCaptureWorklet(ctx);
    chunks = [];
    channels = 0;
    node = new AudioWorkletNode(ctx, 'take-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (e) => {
      const data = e.data;
      if (!data || data.type !== 'data' || !Array.isArray(data.channels)) return;
      channels = Math.max(channels, data.channels.length);
      chunks.push(data.channels);
    };
    inputSource.connect(node);
    source = inputSource;
    startedAtCtx = ctx.currentTime;
    recording = true;
    return true;
  }

  function stop() {
    if (!recording) return null;
    recording = false;
    try { if (source && node) source.disconnect(node); } catch (e) {}
    try { if (node) node.port.close(); } catch (e) {}
    try { if (node) node.disconnect(); } catch (e) {}
    node = null;
    source = null;
    let frames = 0;
    chunks.forEach(ch => { frames += ch[0] ? ch[0].length : 0; });
    const trackCount = Math.max(1, channels);
    let audioBuffer = null;
    if (frames > 0) {
      audioBuffer = ctx.createBuffer(trackCount, frames, ctx.sampleRate);
      for (let c = 0; c < trackCount; c++) {
        const out = audioBuffer.getChannelData(c);
        let at = 0;
        chunks.forEach(ch => {
          const src = ch[c] || ch[0];
          if (!src) return;
          out.set(src, at);
          at += src.length;
        });
      }
    }
    chunks = [];
    channels = 0;
    return {
      audioBuffer,
      frames,
      channels: trackCount,
      sampleRate: ctx.sampleRate,
      duration: frames > 0 ? frames / ctx.sampleRate : 0,
      startedAtCtx,
    };
  }

  function dispose() {
    stop();
  }

  return {
    start,
    stop,
    dispose,
    isRecording: () => recording,
    getDuration: () => {
      let frames = 0;
      chunks.forEach(ch => { frames += ch[0] ? ch[0].length : 0; });
      return frames / ctx.sampleRate;
    },
  };
}

// Finalize a recorded take: WAV-encode, hash, dedup into the asset store,
// return the manifest-ready asset. The WAV Blob is the canonical take
// artifact (byte-identical round-trip through the store).
export async function finalizeTake(take, { store, name } = {}) {
  if (!take || !take.audioBuffer) throw new Error('finalizeTake: empty take');
  if (!store) throw new Error('finalizeTake: no asset store');
  const buf = take.audioBuffer;
  const channelData = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channelData.push(buf.getChannelData(c));
  const blob = encodeWAV(channelData, buf.sampleRate);
  const bytes = await blob.arrayBuffer();
  const digest = await hashBuffer(bytes);
  if (await store.has(digest)) {
    const existing = await store.get(digest);
    return { hash: digest, asset: normalizeAsset(existing), deduplicated: true };
  }
  const record = {
    hash: digest,
    name: name || 'take.wav',
    mime: 'audio/wav',
    size: bytes.byteLength,
    sampleRate: buf.sampleRate,
    channels: buf.numberOfChannels,
    duration: buf.duration,
    createdAt: new Date().toISOString(),
    blob: new Blob([bytes], { type: 'audio/wav' }),
  };
  await store.put(record);
  return { hash: digest, asset: normalizeAsset(record), deduplicated: false };
}
