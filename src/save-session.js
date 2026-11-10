import { City, createDemo } from './core.js';
import { CITY_VERSION } from './city-format.js';

export function parseCityFile(text) {
  const input = JSON.parse(text);
  if (!input || typeof input !== 'object') throw new Error('存档格式不受支持');
  const data = input.city || input.data || input;
  const city = new City(data);
  return { city, camera: input.camera,
    original: data.version < CITY_VERSION ? { data, camera: input.camera, input } : undefined };
}

// Owns save ordering and recovery; rendering and UI do not choose which original record to overwrite.
export class SaveSession {
  constructor(store, { makeId = () => `recovery-${globalThis.crypto.randomUUID()}` } = {}) {
    this.store = store;
    this.makeId = makeId;
    this.target = 'autosave';
    this.queue = Promise.resolve();
    this.protected = false;
    this.original = undefined;
  }

  async open(initial, { resume = false } = {}) {
    const fresh = () => initial ? { city: new City(initial.city), camera: structuredClone(initial.camera) } : { city: createDemo() };
    if (initial && !resume) return fresh();
    try {
      this.original = await this.store.load('autosave');
      if (!this.original) return fresh();
      if (!this.original.data) throw new Error('原存档缺少城市数据');
      return { city: new City(this.original.data), camera: this.original.camera };
    } catch (error) {
      this.protected = true;
      this.target = this.makeId();
      // Resume an earlier recovery without touching the unreadable original.
      try {
        const candidates = (await this.store.list()).filter(item => item.id.startsWith('recovery-'))
          .sort((a, b) => b.date - a.date).slice(0, 20);
        for (const candidate of candidates) {
          try {
            const saved = await this.store.load(candidate.id);
            if (!saved?.data) throw new Error('恢复存档缺少城市数据');
            const city = new City(saved.data);
            this.target = candidate.id;
            return { city, camera: saved.camera, error };
          } catch { /* Keep invalid recovery records intact and try the next one. */ }
        }
      } catch { /* The in-memory city can still be exported if storage is unavailable. */ }
      return { ...fresh(), error };
    }
  }

  enqueue(operation) {
    this.queue = this.queue.catch(() => {}).then(operation);
    return this.queue;
  }

  persist(city, camera, id = this.target) {
    const snapshot = city.snapshot(), view = structuredClone(camera);
    return this.enqueue(() => this.store.write(id, snapshot, view));
  }

  replace(previous, previousCamera, next, camera, original) {
    const before = previous.snapshot(), after = next.snapshot();
    const oldView = structuredClone(previousCamera), newView = structuredClone(camera);
    const source = structuredClone(original);
    return this.enqueue(() => this.store.replace(this.target, after, newView, before, oldView, source));
  }

  async originalRecord() {
    return this.original || this.store.load('autosave');
  }
}
