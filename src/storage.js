import { CITY_VERSION, supportedCityVersion } from './city-format.js';

const RECORDS = 'cities';
const METADATA = 'save-metadata';
export const BACKUP_LIMIT = 20;
const uniqueId = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;

function metadata(record) {
  return {
    id: record.id,
    name: String(record.name || record.data?.name || '未命名城市').slice(0, 40),
    date: Number.isFinite(record.date) ? record.date : 0,
    entityCount: Array.isArray(record.data?.entities) ? record.data.entities.length : null,
    kind: record.kind || (record.id.startsWith('backup-') ? 'legacy-backup' :
      record.id.startsWith('original-') ? 'original' :
      record.id.startsWith('recovery-') ? 'recovery' : 'city'),
  };
}

// The existing cities store and raw records survive the database upgrade.
export function createSaveStore({ indexedDB = globalThis.indexedDB,
  name = 'riverlight-cities', now = Date.now, makeId = uniqueId } = {}) {
  let dbPromise;
  function database() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!indexedDB) { reject(new Error('浏览器不支持本地存档')); return; }
        const request = indexedDB.open(name, 2);
        let blocked = false;
        request.onblocked = () => {
          blocked = true;
          reject(new Error('请关闭其他城市窗口，再重试保存'));
        };
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(METADATA)) {
            const summaries = db.createObjectStore(METADATA, { keyPath: 'id' });
            const cursor = request.transaction.objectStore(RECORDS).openCursor();
            cursor.onsuccess = () => {
              if (!cursor.result) return;
              summaries.put(metadata(cursor.result.value));
              cursor.result.continue();
            };
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) { db.close(); return; }
          db.onversionchange = () => { db.close(); dbPromise = undefined; };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
      }).catch(error => { dbPromise = undefined; throw error; });
    }
    return dbPromise;
  }

  async function read(storeName, fn) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = fn(tx.objectStore(storeName));
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || request.error || new Error('读取失败'));
      tx.onabort = () => reject(tx.error || new Error('读取已中止'));
    });
  }

  function record(id, city, camera, kind = undefined) {
    const data = typeof city.snapshot === 'function' ? city.snapshot() : structuredClone(city);
    return { id, name: data.name, date: now(), data, camera: structuredClone(camera), ...(kind ? { kind } : {}) };
  }

  async function commit(next, backup, importedOriginal) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([RECORDS, METADATA], 'readwrite');
      const records = tx.objectStore(RECORDS), summaries = tx.objectStore(METADATA);
      let failure;
      const put = value => { records.put(value); summaries.put(metadata(value)); };
      const existing = records.get(next.id);
      existing.onsuccess = () => {
        try {
          const original = existing.result;
          if (original && !supportedCityVersion(original.data?.version)) {
            throw new Error('原存档格式未知，已阻止覆盖');
          }
          if (original?.data?.version < CITY_VERSION) {
            put({ ...original, id: makeId('original'), kind: 'original' });
          }
          if (backup) put(backup);
          if (importedOriginal) put(importedOriginal);
          put(next);
          // Only rolling switch backups expire; originals, recoveries and manual saves remain.
          const all = summaries.getAll();
          all.onsuccess = () => {
            const rolling = all.result.filter(value => value.kind === 'backup')
              .sort((a, b) => b.date - a.date || a.id.localeCompare(b.id));
            for (const expired of rolling.slice(BACKUP_LIMIT)) {
              records.delete(expired.id); summaries.delete(expired.id);
            }
          };
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(next);
      tx.onerror = event => { failure ||= tx.error || event.target?.error; };
      tx.onabort = () => reject(failure || tx.error || new Error('保存已中止'));
    });
  }

  return {
    list: () => read(METADATA, store => store.getAll()),
    load: id => read(RECORDS, store => store.get(id)),
    write: (id, city, camera) => commit(record(id, city, camera)),
    replace: (id, city, camera, previous, previousCamera, original) => {
      const imported = original ? { ...record(makeId('original'), original.data, original.camera, 'original'),
        input: structuredClone(original.input) } : undefined;
      return commit(record(id, city, camera), record(makeId('backup'), previous, previousCamera, 'backup'), imported);
    },
    close: async () => { if (dbPromise) { const db = await dbPromise; db.close(); dbPromise = undefined; } },
  };
}

export const saves = createSaveStore();

export function download(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
