import { createAssetStore } from './assetStore.js';
import { importAudioFile, isSupportedAudioFile, decodeAudioBuffer } from './audioImport.js';
import { computePeaksStereo } from './peaks.js';
import { projectSampleRate } from './resample.js';

// Media pool panel (M4): file-picker + drag-and-drop import into the IndexedDB
// asset store, metadata manifest round-tripped through the project JSON,
// per-row audition preview and delete. Waveform sparklines come from peaks
// cached on the store record at import time (single LOD; worker multi-LOD
// is a later item).
export const MP_PEAK_BUCKETS = 256;

function fmtDuration(sec) {
  const d = typeof sec === 'number' && sec >= 0 ? sec : 0;
  return d.toFixed(1) + 's';
}

function fmtSize(bytes) {
  const n = typeof bytes === 'number' && bytes >= 0 ? bytes : 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function extOf(name) {
  const s = typeof name === 'string' ? name : '';
  const dot = s.lastIndexOf('.');
  return dot >= 0 ? s.slice(dot + 1).toLowerCase() : '';
}

export function createMediaPool({ container, ctx, destination, store, getAssets, setAssets } = {}) {
  const el = container;
  el.classList.add('media-pool');
  const audioStore = store || createAssetStore();
  const readManifest = typeof getAssets === 'function' ? getAssets : () => [];
  const writeManifest = typeof setAssets === 'function' ? setAssets : () => {};
  const buffers = new Map();
  const peaksCache = new Map();
  let playingHash = null;
  let playingSource = null;
  let statusText = '';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'MEDIA POOL';

  const toolbar = document.createElement('div');
  toolbar.className = 'mp-toolbar';
  const importBtn = document.createElement('button');
  importBtn.className = 'rec-btn';
  importBtn.id = 'mpImport';
  importBtn.textContent = 'IMPORT';
  importBtn.title = 'Import audio files (wav, mp3, ogg, flac, aiff)';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*,.wav,.wave,.aiff,.aif,.mp3,.ogg,.oga,.flac,.m4a,.opus';
  fileInput.multiple = true;
  fileInput.style.display = 'none';

  const status = document.createElement('div');
  status.className = 'mp-status';

  const list = document.createElement('div');
  list.className = 'mp-list';
  list.id = 'mpList';

  toolbar.append(importBtn, fileInput);
  el.append(title, toolbar, status, list);

  function setStatus(text) {
    statusText = text;
    status.textContent = text;
  }

  function drawPeaks(canvas, peaks) {
    const w = canvas.width;
    const h = canvas.height;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0a0f0a';
    g.fillRect(0, 0, w, h);
    if (!peaks || !peaks.length) return;
    g.fillStyle = '#4af74a';
    const n = peaks.length;
    const bw = Math.max(1, w / n);
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(1, peaks[i]));
      const bh = Math.max(1, v * h);
      g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 0.5), bh);
    }
  }

  function updatePlayButtons() {
    list.querySelectorAll('.mp-row').forEach(row => {
      const btn = row.querySelector('.mp-play');
      if (!btn) return;
      const active = row.dataset.hash === playingHash;
      btn.classList.toggle('on', active);
      btn.textContent = active ? '■' : '▶';
    });
  }

  async function ensureBuffer(hash) {
    if (buffers.has(hash)) return buffers.get(hash);
    if (!ctx || typeof ctx.decodeAudioData !== 'function') throw new Error('mediaPool: no audio context');
    const rec = await audioStore.get(hash);
    if (!rec || !rec.blob) throw new Error('mediaPool: asset missing in store');
    const buf = await rec.blob.arrayBuffer();
    const decoded = await decodeAudioBuffer(buf, ctx);
    buffers.set(hash, decoded);
    return decoded;
  }

  // Persist peaks on the store record so waveforms render without re-decode.
  async function cachePeaks(hash, audioBuffer) {
    if (!audioBuffer || typeof audioBuffer.numberOfChannels !== 'number') return;
    const channels = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      try { channels.push(audioBuffer.getChannelData(c)); } catch (e) { /* ignore */ }
    }
    if (!channels.length) return;
    const peaks = Array.from(computePeaksStereo(channels, MP_PEAK_BUCKETS));
    peaksCache.set(hash, peaks);
    try {
      const rec = await audioStore.get(hash);
      if (rec && rec.blob && !rec.peaks) await audioStore.put({ ...rec, peaks });
    } catch (e) { /* peaks caching is best-effort */ }
  }

  function previewStop() {
    if (playingSource) {
      try { playingSource.onended = null; } catch (e) {}
      try { playingSource.stop(); } catch (e) {}
      try { playingSource.disconnect(); } catch (e) {}
      playingSource = null;
    }
    playingHash = null;
    updatePlayButtons();
  }

  async function togglePreview(hash) {
    if (playingHash === hash) {
      previewStop();
      return false;
    }
    previewStop();
    if (!ctx) throw new Error('mediaPool: no audio context');
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
    const audioBuffer = await ensureBuffer(hash);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    try { src.connect(destination || ctx.destination); } catch (e) {}
    playingHash = hash;
    playingSource = src;
    src.onended = () => {
      if (playingHash === hash) {
        playingHash = null;
        playingSource = null;
        updatePlayButtons();
      }
    };
    try { src.start(); } catch (e) {
      playingHash = null;
      playingSource = null;
      throw e;
    }
    if (!peaksCache.has(hash)) await cachePeaks(hash, audioBuffer);
    updatePlayButtons();
    return true;
  }

  async function importFiles(fileList) {
    const files = [...(fileList || [])];
    let imported = 0;
    let deduplicated = 0;
    let skipped = 0;
    const manifest = readManifest().slice();
    const known = new Set(manifest.map(a => a && a.hash).filter(Boolean));
    // Project-rate policy: decode straight to the context rate when known,
    // otherwise fall back to the decode-context default.
    let target = 0;
    try { target = projectSampleRate(ctx); } catch (e) {}
    for (const file of files) {
      if (!isSupportedAudioFile(file)) { skipped++; continue; }
      try {
        const { hash, asset, deduplicated: dup, audioBuffer } = await importAudioFile(file, {
          ctx, store: audioStore, targetSampleRate: target || undefined,
        });
        if (!known.has(hash)) {
          known.add(hash);
          manifest.push(asset);
        }
        if (dup) deduplicated++;
        else imported++;
        if (audioBuffer && !peaksCache.has(hash)) await cachePeaks(hash, audioBuffer);
      } catch (e) {
        skipped++;
      }
    }
    writeManifest(manifest);
    await refresh();
    const parts = [];
    if (imported) parts.push(imported + ' imported');
    if (deduplicated) parts.push(deduplicated + ' already in pool');
    if (skipped) parts.push(skipped + ' skipped');
    setStatus(parts.length ? parts.join(', ') : 'nothing to import');
    return { imported, deduplicated, skipped };
  }

  async function removeAsset(hash) {
    if (playingHash === hash) previewStop();
    await audioStore.remove(hash);
    buffers.delete(hash);
    peaksCache.delete(hash);
    writeManifest(readManifest().filter(a => !a || a.hash !== hash));
    await refresh();
  }

  async function refresh() {
    while (list.firstChild) list.removeChild(list.firstChild);
    const manifest = readManifest();
    if (!manifest.length) {
      const empty = document.createElement('div');
      empty.className = 'mp-empty';
      empty.textContent = 'Drop audio files here or IMPORT — wav · mp3 · ogg · flac · aiff';
      list.appendChild(empty);
      return;
    }
    for (const asset of manifest) {
      const hash = asset && asset.hash;
      let rec = null;
      try { rec = hash ? await audioStore.get(hash) : null; } catch (e) { rec = null; }
      const missing = !rec || !rec.blob;
      const row = document.createElement('div');
      row.className = 'mp-row' + (missing ? ' mp-missing' : '');
      if (hash) row.dataset.hash = hash;

      const play = document.createElement('button');
      play.className = 'rec-btn mp-play';
      play.textContent = hash === playingHash ? '■' : '▶';
      if (hash === playingHash) play.classList.add('on');
      play.title = missing ? 'Asset missing in store' : 'Preview';
      play.disabled = missing;
      if (!missing) play.addEventListener('click', () => { togglePreview(hash).catch(err => setStatus(err.message)); });

      const wave = document.createElement('canvas');
      wave.className = 'mp-wave';
      wave.width = 120;
      wave.height = 28;
      const peaks = (rec && rec.peaks) || peaksCache.get(hash);
      drawPeaks(wave, peaks);

      const info = document.createElement('div');
      info.className = 'mp-info';
      const name = document.createElement('div');
      name.className = 'mp-name';
      name.textContent = (asset && asset.name) || 'audio';
      const meta = document.createElement('div');
      meta.className = 'mp-meta';
      const sr = asset && asset.sampleRate ? (asset.sampleRate / 1000).toFixed(1) + 'kHz' : '';
      const ch = asset && asset.channels ? asset.channels + 'ch' : '';
      meta.textContent = [extOf(asset && asset.name), fmtDuration(asset && asset.duration), sr, ch, fmtSize(asset && asset.size), missing ? '(missing)' : '']
        .filter(Boolean).join(' · ');
      info.append(name, meta);

      const del = document.createElement('button');
      del.className = 'rec-btn mp-del';
      del.textContent = '×';
      del.title = 'Remove from pool and store';
      del.addEventListener('click', () => { removeAsset(hash).catch(err => setStatus(err.message)); });

      row.append(play, wave, info, del);
      list.appendChild(row);
    }
  }

  function onPick() { fileInput.click(); }
  function onFileChange() {
    const files = [...(fileInput.files || [])];
    fileInput.value = '';
    if (files.length) importFiles(files).catch(err => setStatus(err.message));
  }
  function onDragOver(e) {
    e.preventDefault();
    el.classList.add('mp-dragover');
  }
  function onDragLeave(e) {
    if (e.target === el || !el.contains(e.relatedTarget)) el.classList.remove('mp-dragover');
  }
  function onDrop(e) {
    e.preventDefault();
    el.classList.remove('mp-dragover');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) importFiles(files).catch(err => setStatus(err.message));
  }

  importBtn.addEventListener('click', onPick);
  fileInput.addEventListener('change', onFileChange);
  el.addEventListener('dragover', onDragOver);
  el.addEventListener('dragleave', onDragLeave);
  el.addEventListener('drop', onDrop);

  function dispose() {
    previewStop();
    importBtn.removeEventListener('click', onPick);
    fileInput.removeEventListener('change', onFileChange);
    el.removeEventListener('dragover', onDragOver);
    el.removeEventListener('dragleave', onDragLeave);
    el.removeEventListener('drop', onDrop);
    buffers.clear();
    peaksCache.clear();
  }

  refresh().catch(err => setStatus(err.message));

  return { el, refresh, importFiles, togglePreview, previewStop, dispose, getStatus: () => statusText };
}
