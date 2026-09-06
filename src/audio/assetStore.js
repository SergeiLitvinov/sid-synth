// Binary audio asset store (M4): audio Blobs live in IndexedDB keyed by the
// SHA-256 hex of their raw bytes. The project JSON only carries the metadata
// manifest ({ hash, name, mime, size, sampleRate, channels, duration }), so
// identical files dedup to a single record and unreferenced blobs can be
// garbage-collected by hash set.
export const ASSET_DB_NAME = 'sid-synth-assets';
export const ASSET_STORE_NAME = 'assets';

// SHA-256 hex of an ArrayBuffer (or view — only the viewed bytes are hashed).
export async function hashBuffer(buf) {
  if (!buf || (typeof buf.byteLength !== 'number' && !(buf instanceof ArrayBuffer))) {
    throw new Error('hashBuffer: expected an ArrayBuffer or view');
  }
  const subtle = (globalThis.crypto || {}).subtle;
  if (!subtle) throw new Error('hashBuffer: crypto.subtle unavailable');
  const digest = await subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Metadata-only asset record: everything the project JSON may embed.
// Drops the Blob (and cached peaks) so manifests stay small and serializable.
export function normalizeAsset(a) {
  const src = a && typeof a === 'object' ? a : {};
  const base = defaultAssetMeta();
  return {
    hash: typeof src.hash === 'string' && src.hash ? src.hash : base.hash,
    name: typeof src.name === 'string' ? src.name : base.name,
    mime: typeof src.mime === 'string' ? src.mime : base.mime,
    size: typeof src.size === 'number' && src.size >= 0 ? src.size : base.size,
    sampleRate: typeof src.sampleRate === 'number' && src.sampleRate > 0 ? src.sampleRate : base.sampleRate,
    channels: typeof src.channels === 'number' && src.channels > 0 ? Math.floor(src.channels) : base.channels,
    duration: typeof src.duration === 'number' && src.duration >= 0 ? src.duration : base.duration,
    createdAt: typeof src.createdAt === 'string' ? src.createdAt : base.createdAt,
  };
}

export function defaultAssetMeta() {
  return {
    hash: '',
    name: 'audio',
    mime: '',
    size: 0,
    sampleRate: 0,
    channels: 0,
    duration: 0,
    createdAt: new Date().toISOString(),
  };
}

// Every asset hash a project document references: the media-pool manifest
// plus any audio-backed clips (clips carrying { audio: { hash } }).
export function collectReferencedHashes(project) {
  const out = new Set();
  const p = project && typeof project === 'object' ? project : {};
  if (Array.isArray(p.assets)) {
    p.assets.forEach(a => { if (a && typeof a.hash === 'string' && a.hash) out.add(a.hash); });
  }
  if (Array.isArray(p.tracks)) {
    p.tracks.forEach(t => {
      if (!t || !Array.isArray(t.clips)) return;
      t.clips.forEach(c => {
        const h = c && c.audio && c.audio.hash;
        if (typeof h === 'string' && h) out.add(h);
      });
    });
  }
  return [...out];
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB request failed'));
  });
}

export function createAssetStore({ dbName = ASSET_DB_NAME, storeName = ASSET_STORE_NAME } = {}) {
  let db = null;
  let openPromise = null;

  function ensureIdb() {
    if (typeof indexedDB === 'undefined') throw new Error('assetStore: indexedDB unavailable');
  }

  function open() {
    ensureIdb();
    if (db) return Promise.resolve(db);
    if (openPromise) return openPromise;
    openPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: 'hash' });
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => { openPromise = null; reject(req.error || new Error('assetStore: open failed')); };
      req.onblocked = () => reject(new Error('assetStore: open blocked'));
    });
    return openPromise;
  }

  function tx(mode, fn) {
    return open().then(database => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      return fn(store);
    });
  }

  return {
    open,
    close() {
      if (db) { try { db.close(); } catch (e) {} db = null; openPromise = null; }
    },
    // Full record including the Blob: { hash, name, mime, size, sampleRate,
    // channels, duration, createdAt, blob, peaks? }. Upsert by hash.
    put(record) {
      if (!record || typeof record.hash !== 'string' || !record.hash) {
        return Promise.reject(new Error('assetStore.put: record needs a hash'));
      }
      if (!record.blob) return Promise.reject(new Error('assetStore.put: record needs a blob'));
      return tx('readwrite', store => reqToPromise(store.put(record)));
    },
    get(hash) {
      if (typeof hash !== 'string' || !hash) return Promise.resolve(null);
      return tx('readonly', store => reqToPromise(store.get(hash))).then(r => r || null);
    },
    getBlob(hash) {
      return this.get(hash).then(r => (r && r.blob) || null);
    },
    has(hash) {
      if (typeof hash !== 'string' || !hash) return Promise.resolve(false);
      return tx('readonly', store => reqToPromise(store.getKey(hash))).then(k => k !== undefined);
    },
    // Metadata only (no blobs, no cached peaks) for media-pool listings.
    list() {
      return tx('readonly', store => reqToPromise(store.getAll())).then(all => all.map(normalizeAsset));
    },
    remove(hash) {
      if (typeof hash !== 'string' || !hash) return Promise.resolve();
      return tx('readwrite', store => reqToPromise(store.delete(hash))).then(() => undefined);
    },
    // Delete every record whose hash is not in `usedHashes` (Set or array).
    // Returns the deleted hashes. Backs "project reopen loses no media,
    // edits never touch the source asset" — orphans are collected on save.
    gc(usedHashes) {
      const used = usedHashes instanceof Set ? usedHashes : new Set(usedHashes || []);
      return tx('readwrite', store => reqToPromise(store.getAllKeys()).then(keys => {
        const dead = keys.filter(k => !used.has(k));
        return Promise.all(dead.map(k => reqToPromise(store.delete(k)))).then(() => dead);
      }));
    },
    clear() {
      return tx('readwrite', store => reqToPromise(store.clear())).then(() => undefined);
    },
  };
}
