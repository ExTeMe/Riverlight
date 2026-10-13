import test from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { storageChecks } from './storage-checks.js';

for (const scenario of storageChecks) {
  test(scenario.name, () => scenario.run(new IDBFactory(), IDBObjectStore));
}
