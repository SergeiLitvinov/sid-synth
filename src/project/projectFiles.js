// Portable project bundle (P0): one JSON file carrying the project document
// plus every referenced audio blob as base64 media, so a project survives a
// move to a clean browser profile (localStorage + IndexedDB do not travel).
// SAVE PATCH stays rack-only; this module owns the whole song + media.
// Pure async functions (no DOM) except downloadText; unit-tested in browser.
import { parseProject } from './serialize.js';
import { collectReferencedHashes, hashBuffer } from '../audio/assetStore.js';

export const BUNDLE_KIND = 'sid-synth-bundle';
export const BUNDLE_VERSION = 1;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result || '');
        const comma = url.indexOf(',');
        if (comma < 0) { reject(new Error('bundle: data URL decode failed')); return; }
        resolve(url.slice(comma + 1));
      };
      reader.onerror = () => reject(reader.error || new Error('bundle: blob read failed'));
      reader.readAsDataURL(blob);
    } catch (e) {
      reject(e);
    }
  });
}

function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function sanitizeFileName(name) {
  const clean = String(name || 'SID Project').replace(/[\\/:*?"<>|#%]+/g, '_').trim();
  return (clean || 'SID Project').slice(0, 80);
}

// Bundle the project document with every audio blob it references
// (pool manifest + clip audio refs). Blobs missing from the store are
// listed, not fatal: the song still opens, silent where media is gone.
export async function exportBundle({ project, store }) {
  if (!project || typeof project !== 'object') throw new Error('bundle: no project to export');
  const hashes = collectReferencedHashes(project);
  const manifest = new Map();
  (Array.isArray(project.assets) ? project.assets : []).forEach(a => {
    if (a && typeof a.hash === 'string' && a.hash) manifest.set(a.hash, a);
  });
  const media = [];
  const missing = [];
  for (const hash of hashes) {
    let blob = null;
    try { blob = store ? await store.getBlob(hash) : null; } catch (e) { blob = null; }
    if (!blob) { missing.push(hash); continue; }
    const meta = manifest.get(hash) || {};
    media.push({
      hash,
      name: typeof meta.name === 'string' && meta.name ? meta.name : 'audio',
      mime: typeof blob.type === 'string' && blob.type ? blob.type
        : (typeof meta.mime === 'string' ? meta.mime : 'audio/wav'),
      data: await blobToBase64(blob),
    });
  }
  const bundle = {
    kind: BUNDLE_KIND,
    bundleVersion: BUNDLE_VERSION,
    savedAt: new Date().toISOString(),
    project,
    media,
  };
  if (missing.length) bundle.mediaMissing = missing;
  return bundle;
}

// Split bundle bytes back into a project doc + store records. Accepts a
// bundle object (or its JSON text) and, for hand-made files, a raw project
// document without the bundle wrapper (no media then). Every media entry is
// hash-verified before it touches the store; mismatches are skipped, never
// stored. Returns { project, imported, skipped }.
export async function importBundle(input, { store } = {}) {
  let doc = input;
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc); }
    catch (e) { throw new Error('bundle: JSON parse failed: ' + e.message); }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('bundle: not an object');
  let rawProject = doc.project;
  let media = [];
  if (doc.kind === undefined && doc.project === undefined) {
    rawProject = doc; // raw project document, no wrapper
  } else {
    if (doc.kind !== BUNDLE_KIND) throw new Error('bundle: not a SID Synth project file');
    if (doc.bundleVersion !== BUNDLE_VERSION) {
      throw new Error('bundle: unsupported bundle version ' + doc.bundleVersion);
    }
    if (Array.isArray(doc.media)) media = doc.media;
  }
  const project = parseProject(rawProject);
  const imported = [];
  const skipped = [];
  for (const entry of media) {
    const hash = entry && entry.hash;
    const data = entry && entry.data;
    if (typeof hash !== 'string' || !hash || typeof data !== 'string' || !data) {
      skipped.push({ hash: typeof hash === 'string' ? hash : '', reason: 'malformed entry' });
      continue;
    }
    let bytes;
    try { bytes = base64ToBytes(data); }
    catch (e) { skipped.push({ hash, reason: 'base64 decode failed' }); continue; }
    let actual = '';
    try { actual = await hashBuffer(bytes); }
    catch (e) { skipped.push({ hash, reason: 'hash unavailable' }); continue; }
    if (actual !== hash) { skipped.push({ hash, reason: 'hash mismatch' }); continue; }
    if (store) {
      try {
        await store.put({
          hash,
          blob: new Blob([bytes], { type: typeof entry.mime === 'string' ? entry.mime : 'audio/wav' }),
          name: typeof entry.name === 'string' ? entry.name : 'audio',
          mime: typeof entry.mime === 'string' ? entry.mime : 'audio/wav',
          size: bytes.byteLength,
        });
      } catch (e) { skipped.push({ hash, reason: 'store put failed: ' + (e.message || e) }); continue; }
    }
    imported.push(hash);
  }
  return { project, imported, skipped };
}

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('bundle: file read failed'));
      reader.readAsText(file);
    } catch (e) {
      reject(e);
    }
  });
}
