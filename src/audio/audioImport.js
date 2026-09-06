import { hashBuffer, normalizeAsset } from './assetStore.js';
import { decodeAtSampleRate } from './resample.js';

// Audio file import (M4): read → hash → dedup → decode → store. The stored
// Blob is the byte-identical source file; decode only feeds the metadata
// (sampleRate/channels/duration), so edits and playback never mutate it.
export const AUDIO_EXTENSIONS = {
  wav: 'audio/wav',
  wave: 'audio/wav',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
};

export function sniffAudioMime(file) {
  const name = file && typeof file.name === 'string' ? file.name : '';
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (ext && AUDIO_EXTENSIONS[ext]) return AUDIO_EXTENSIONS[ext];
  const type = file && typeof file.type === 'string' ? file.type : '';
  if (type.startsWith('audio/')) return type;
  return '';
}

export function isSupportedAudioFile(file) {
  return sniffAudioMime(file) !== '';
}

export function readFileBuffer(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    return Promise.reject(new Error('importAudio: not a readable file'));
  }
  return file.arrayBuffer();
}

// decodeAudioData detaches its input, so always hand it a copy and keep the
// original bytes for hashing and blob storage.
export function decodeAudioBuffer(arrayBuffer, ctx) {
  if (!ctx || typeof ctx.decodeAudioData !== 'function') {
    return Promise.reject(new Error('importAudio: no decodeAudioData context'));
  }
  try {
    const copy = arrayBuffer.slice(0);
    return Promise.resolve(ctx.decodeAudioData(copy));
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error('importAudio: decode failed'));
  }
}

// Full import pipeline. Returns { hash, asset, deduplicated, audioBuffer }:
// `asset` is the metadata record for the project manifest, `deduplicated`
// is true when identical bytes were already stored (no second Blob, no
// re-decode — then audioBuffer is undefined), `audioBuffer` is the decoded
// audio for peak metering and preview without decoding twice.
// `targetSampleRate` decodes straight to the project rate via an offline
// context; without it, the live context rate applies as before.
export async function importAudioFile(file, { ctx, store, targetSampleRate } = {}) {
  if (!file) throw new Error('importAudio: no file');
  if (!store) throw new Error('importAudio: no asset store');
  const buf = await readFileBuffer(file);
  const hash = await hashBuffer(buf);
  if (await store.has(hash)) {
    const existing = await store.get(hash);
    return { hash, asset: normalizeAsset(existing), deduplicated: true, audioBuffer: undefined };
  }
  const target = typeof targetSampleRate === 'number' && targetSampleRate > 0 ? targetSampleRate : 0;
  if (!ctx && !target) throw new Error('importAudio: no audio context for decode');
  let decoded;
  try {
    decoded = target
      ? await decodeAtSampleRate(buf, target)
      : await decodeAudioBuffer(buf, ctx);
  } catch (e) {
    throw new Error('importAudio: cannot decode ' + (file.name || 'file'));
  }
  const mime = sniffAudioMime(file) || file.type || 'application/octet-stream';
  const record = {
    hash,
    name: file.name || 'audio',
    mime,
    size: buf.byteLength,
    sampleRate: decoded.sampleRate || 0,
    channels: decoded.numberOfChannels || 0,
    duration: typeof decoded.duration === 'number' ? decoded.duration : 0,
    createdAt: new Date().toISOString(),
    blob: new Blob([buf], { type: mime }),
  };
  await store.put(record);
  return { hash, asset: normalizeAsset(record), deduplicated: false, audioBuffer: decoded };
}
