/* db.js — IndexedDB шар. Основні дані в IndexedDB, localStorage лише для теми/сайдбару. */
'use strict';

const DB_NAME = 'offline-trade-lab';
const DB_VERSION = 1;

let _db = null;

function openDb() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('datasets')) {
        db.createObjectStore('datasets', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('candles')) {
        const st = db.createObjectStore('candles', { keyPath: 'id', autoIncrement: true });
        st.createIndex('datasetId', 'datasetId', { unique: false });
        st.createIndex('datasetTs', ['datasetId', 'ts'], { unique: false });
      }
      if (!db.objectStoreNames.contains('presets')) {
        db.createObjectStore('presets', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('simulations')) {
        const st = db.createObjectStore('simulations', { keyPath: 'id', autoIncrement: true });
        st.createIndex('datasetId', 'datasetId', { unique: false });
      }
      if (!db.objectStoreNames.contains('journal')) {
        const st = db.createObjectStore('journal', { keyPath: 'id', autoIncrement: true });
        st.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return openDb().then((db) => db.transaction(store, mode || 'readonly').objectStore(store));
}

// ---- generic helpers ----
async function dbAdd(store, value) {
  const st = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const r = st.add(value);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function dbPut(store, value) {
  const st = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const r = st.put(value);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function dbGet(store, key) {
  const st = await tx(store, 'readonly');
  return new Promise((resolve, reject) => {
    const r = st.get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function dbGetAll(store) {
  const st = await tx(store, 'readonly');
  return new Promise((resolve, reject) => {
    const r = st.getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

async function dbDelete(store, key) {
  const st = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const r = st.delete(key);
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}

async function dbClear(store) {
  const st = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const r = st.clear();
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}

// ---- candles ----
async function dbAddCandlesBatch(datasetId, candles) {
  // candles: [{ts,open,high,low,close,volume}]
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('candles', 'readwrite');
    const st = t.objectStore('candles');
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
    const CHUNK = 2000;
    let i = 0;
    function pump() {
      let n = 0;
      while (i < candles.length && n < CHUNK) {
        const c = candles[i];
        st.add({ datasetId, ts: c.ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 });
        i++; n++;
      }
      if (i < candles.length) setTimeout(pump, 0);
    }
    pump();
  });
}

async function dbGetCandles(datasetId, limit) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('candles', 'readonly');
    const idx = t.objectStore('candles').index('datasetTs');
    const range = IDBKeyRange.bound([datasetId, -Infinity], [datasetId, Infinity]);
    const out = [];
    const req = idx.openCursor(range);
    req.onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) {
        const v = cur.value;
        out.push({ ts: v.ts, open: v.open, high: v.high, low: v.low, close: v.close, volume: v.volume });
        if (limit && out.length >= limit) { resolve(out); return; }
        cur.continue();
      } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

async function dbDeleteCandlesOfDataset(datasetId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('candles', 'readwrite');
    const st = t.objectStore('candles');
    const idx = st.index('datasetId');
    const req = idx.openKeyCursor(IDBKeyRange.only(datasetId));
    req.onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { st.delete(cur.primaryKey); cur.continue(); }
    };
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}

async function dbCountCandles(datasetId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('candles', 'readonly');
    const idx = t.objectStore('candles').index('datasetId');
    const r = idx.count(IDBKeyRange.only(datasetId));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// ---- kv settings (ambiguousMode тощо) ----
async function kvGet(key, defVal) {
  const v = await dbGet('kv', key);
  if (!v) return defVal;
  return v.value;
}

async function kvSet(key, value) {
  await dbPut('kv', { key, value });
  return true;
}

// UI налаштування (тема) — localStorage
const UIStore = {
  get(k, d) {
    try {
      const v = localStorage.getItem('otl-ui-' + k);
      return v === null ? d : v;
    } catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('otl-ui-' + k, v); } catch (e) {}
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { openDb };
}
