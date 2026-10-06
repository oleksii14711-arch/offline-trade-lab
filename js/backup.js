/* backup.js — EXPORT/IMPORT JSON + RESET. */
'use strict';

// Перепривʼязка залежних записів (candles, simulations) до нових id datasets.
// Чиста функція: не чіпає IndexedDB, тому придатна для Node-тестів.
// dsMap: Map(oldDatasetId -> newDatasetId).
// Записи з datasetId, якого нема в dsMap, НЕ копіюються мовчки — рахуються як orphans.
function remapDatasetRefs(records, dsMap) {
  const kept = [];
  let orphans = 0;
  for (const rec of (records || [])) {
    const oldDs = rec ? rec.datasetId : undefined;
    if (oldDs !== undefined && oldDs !== null && dsMap.has(oldDs)) {
      const copy = Object.assign({}, rec);
      delete copy.id; // новий id згенерує IndexedDB
      copy.datasetId = dsMap.get(oldDs);
      kept.push(copy);
    } else {
      orphans++;
    }
  }
  return { kept, orphans };
}

function stripId(rec) {
  const copy = Object.assign({}, rec);
  delete copy.id;
  return copy;
}

async function buildBackup() {
  const datasets = await dbGetAll('datasets');
  const db = await openDb();
  // свічки
  const candles = await new Promise((resolve, reject) => {
    const t = db.transaction('candles', 'readonly');
    const r = t.objectStore('candles').getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
  const presets = await dbGetAll('presets');
  const simulations = await dbGetAll('simulations');
  const journal = await dbGetAll('journal');
  const kv = await dbGetAll('kv');
  return {
    app: 'offline-trade-lab',
    version: 1,
    exportedAt: new Date().toISOString(),
    datasets, candles, presets, simulations, journal, kv
  };
}

function backupSummary(b) {
  return {
    datasets: (b.datasets || []).length,
    candles: (b.candles || []).length,
    presets: (b.presets || []).length,
    simulations: (b.simulations || []).length,
    journal: (b.journal || []).length
  };
}

function validateBackup(b) {
  if (!b || typeof b !== 'object') return 'Файл не є JSON-обʼєктом.';
  if (b.app !== 'offline-trade-lab') return 'Це не backup Offline Trade Lab (поле app).';
  if (!Array.isArray(b.datasets) || !Array.isArray(b.journal)) return 'Пошкоджена структура backup.';
  return null;
}

function batchAdd(db, store, arr) {
  return new Promise((resolve, reject) => {
    if (!arr.length) { resolve(0); return; }
    const t = db.transaction(store, 'readwrite');
    const st = t.objectStore(store);
    t.oncomplete = () => resolve(arr.length);
    t.onerror = () => reject(t.error);
    for (const rec of arr) st.add(rec);
  });
}

function batchPut(db, store, arr) {
  return new Promise((resolve, reject) => {
    if (!arr.length) { resolve(0); return; }
    const t = db.transaction(store, 'readwrite');
    const st = t.objectStore(store);
    t.oncomplete = () => resolve(arr.length);
    t.onerror = () => reject(t.error);
    for (const rec of arr) st.put(Object.assign({}, rec));
  });
}

async function restoreBackup(b, mode) {
  // mode: 'replace' | 'merge'
  const err = validateBackup(b);
  if (err) throw new Error(err);
  const db = await openDb();
  if (mode === 'replace') {
    // Повна заміна: id зберігаються, звʼязки datasetId цілі за визначенням.
    for (const s of ['datasets', 'candles', 'presets', 'simulations', 'journal', 'kv']) {
      await dbClear(s);
    }
    await batchPut(db, 'datasets', b.datasets || []);
    await batchPut(db, 'candles', b.candles || []);
    await batchPut(db, 'presets', b.presets || []);
    await batchPut(db, 'simulations', b.simulations || []);
    await batchPut(db, 'journal', b.journal || []);
    await batchPut(db, 'kv', b.kv || []);
    return Object.assign(backupSummary(b), {
      mode: 'replace', datasetsAdded: (b.datasets || []).length,
      orphanCandles: 0, orphanSimulations: 0, remapped: null
    });
  }
  // ---- merge: datasets отримують НОВІ id, залежні записи перепривʼязуються ----
  const dsMap = new Map(); // oldDatasetId -> newDatasetId
  const addedIds = [];
  for (const rec of (b.datasets || [])) {
    const copy = Object.assign({}, rec);
    const oldId = copy.id;
    delete copy.id;
    const newId = await dbAdd('datasets', copy); // реальний новий id з IndexedDB
    addedIds.push(newId);
    if (oldId !== undefined && oldId !== null) dsMap.set(oldId, newId);
  }
  const rc = remapDatasetRefs(b.candles || [], dsMap);
  await batchAdd(db, 'candles', rc.kept);
  const rs = remapDatasetRefs(b.simulations || [], dsMap);
  await batchAdd(db, 'simulations', rs.kept);
  await batchAdd(db, 'presets', (b.presets || []).map(stripId));
  await batchAdd(db, 'journal', (b.journal || []).map(stripId));
  await batchPut(db, 'kv', b.kv || []);
  return {
    mode: 'merge',
    datasets: (b.datasets || []).length,
    datasetsAdded: addedIds.length,
    addedDatasetIds: addedIds,
    remapped: Array.from(dsMap.entries()).map(([from, to]) => ({ from, to })),
    candlesAdded: rc.kept.length,
    simulationsAdded: rs.kept.length,
    presets: (b.presets || []).length,
    simulations: (b.simulations || []).length,
    journal: (b.journal || []).length,
    candles: (b.candles || []).length,
    orphanCandles: rc.orphans,
    orphanSimulations: rs.orphans
  };
}

async function resetAllData() {
  for (const s of ['datasets', 'candles', 'presets', 'simulations', 'journal', 'kv']) {
    await dbClear(s);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { backupSummary, validateBackup, remapDatasetRefs };
}
