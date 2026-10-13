import { City, waterAt } from './core.js';

export const BASELINE = Object.freeze({
  id: 'BASE-02',
  sceneVersion: 1,
  seed: 20261013,
  camera: { position: [120, 115, 150], target: [0, 0, 0] },
  limitations: ['任意角度、信号通行、目的地行为、雨伞和桥船净空尚未实现'],
});

// Explicit placements keep the layout independent of render-frame randomness.
export function createBaseline() {
  const city = new City();
  city.name = '基线 · 河畔编辑院';
  city.environment = { ...city.environment, hour: 16.5, playing: false, wind: .4, quality: 'high' };
  const add = (type, x, z, rotation = 0, color = 0) => {
    if (!city.place(type, x, z, rotation, color)) throw new Error(`无效基线物件：${type} (${x}, ${z})`);
  };
  for (let x = -28; x <= 28; x++) add(waterAt(x, 0) ? 'bridge' : 'road', x, 0);
  for (let x = -36; x <= -32; x++) add('road', x, -14);
  for (let z = 1; z <= 8; z++) add('path', -18, z);
  for (const entry of [
    ['cottage', -26.5, -5.5, 0, 1], ['villa', -24, 5.5, 1, 2],
    ['bakery', -20, -4, 0, 0], ['cafe', 18, -4, 0, 2], ['park', 20, 5, 0, 0],
    ['tree', -29, 3, 0, 0], ['bench', -18.5, 10, 0, 0],
  ]) add(...entry);
  city.undoStack = []; city.redoStack = [];
  return { ...structuredClone(BASELINE), city: city.snapshot() };
}

export function createLegacyBaseline() {
  const city = new City();
  city.terrain = 'legacy'; city.name = '基线 · 旧城原件';
  const data = city.snapshot();
  data.version = 1; delete data.terrain;
  data.entities = [
    { id: 1, type: 'cottage', x: -30, z: -10, rotation: 1, color: 2 },
    { id: 2, type: 'road', x: -30, z: -5, rotation: 0, color: 0 },
  ];
  data.nextId = 3;
  return { id: 'BASE-02-v1', sceneVersion: 1, seed: BASELINE.seed,
    city: data, camera: structuredClone(BASELINE.camera) };
}
