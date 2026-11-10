import test from 'node:test';
import assert from 'node:assert/strict';
import { City, footprintBounds } from '../src/core.js';
import { createBaseline, createLegacyBaseline } from '../src/baseline.js';
import { placementOf, usesParcel } from '../src/parcel.js';
import { legacyPlacement } from '../src/space.js';

test('v1 and v2 baselines retain original grid occupancy, model transforms and river after migration', () => {
  for (const fixture of [createLegacyBaseline(), createBaseline()]) {
    const before = new City(fixture.city), snapshot = before.snapshot();
    const after = new City(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(snapshot.version, 3);
    assert.equal(after.terrain, before.terrain);
    assert.deepEqual(after.occupancy, before.occupancy);
    assert.deepEqual(after.chunks, before.chunks);
    assert.deepEqual(after.snapshot(), snapshot);
    for (const e of before.entities.values()) {
      const restored = after.entities.get(e.id);
      assert.deepEqual(restored, e);
      assert.deepEqual(placementOf(restored), legacyPlacement(e));
      assert.deepEqual(footprintBounds(restored), footprintBounds(e));
      if (usesParcel(e.type)) {
        const record = snapshot.entities.find(record => record.id === e.id);
        assert.equal('x' in record, false);
        assert.equal(record.parcelId, `legacy-${e.id}`);
      }
    }
  }
});

function nativeCity() {
  const raw = new City().snapshot();
  raw.parcels.push({ id: 'house-lot', x: -84.25, z: -30.5, width: 16, depth: 18, angle: 18 },
    { id: 'empty-lot', x: -114, z: -30, width: 10, depth: 14, angle: 11 });
  raw.entities.push({ id: 1, type: 'cottage', color: 2, parcelId: 'house-lot', offsetX: .75, offsetZ: -1.25, angle: 17 });
  raw.nextId = 12;
  return raw;
}

test('native parcels retain their empty lots, fractional offsets and arbitrary angles through history and save', () => {
  const raw = nativeCity(), city = new City(raw), house = city.entities.get(1);
  const p = placementOf(house), a = 18 * Math.PI / 180;
  assert.equal(p.x, -84.25 + .75 * Math.cos(a) - 1.25 * Math.sin(a));
  assert.equal(p.z, -30.5 - .75 * Math.sin(a) - 1.25 * Math.cos(a));
  assert.equal(p.radians, 35 * Math.PI / 180);
  assert.equal(p.scaleX, 1);
  assert.equal(p.scaleZ, 1);
  assert.deepEqual(city.queryFootprints(footprintBounds(house)), [house]);
  assert.ok(city.remove(house.id));
  assert.deepEqual(new City(city.snapshot()).snapshot().parcels, raw.parcels);
  assert.ok(city.undo());
  assert.deepEqual(city.snapshot(), raw);
  assert.deepEqual(new City(city.snapshot()).snapshot(), raw);
});

test('malformed parcels and building poses cannot replace an existing city', () => {
  const city = new City(createBaseline().city), before = city.snapshot();
  for (const corrupt of [
    raw => raw.parcels[0].width = 0,
    raw => raw.parcels[0].width = Infinity,
    raw => raw.parcels[0].x = 400,
    raw => raw.parcels[0].x = 0,
    raw => Object.assign(raw.parcels[1], { x: raw.parcels[0].x, z: raw.parcels[0].z }),
    raw => raw.parcels[1].id = raw.parcels[0].id,
    raw => raw.entities[0].parcelId = 'missing',
    raw => raw.entities[0].offsetX = 20,
    raw => raw.entities.push({ ...raw.entities[0], id: 2 }),
    raw => raw.entities.push({ id: 2, type: 'road', x: -21, z: -8, color: 0, rotation: 0 }),
  ]) {
    const raw = nativeCity();
    corrupt(raw);
    assert.throws(() => city.restore(raw));
    assert.deepEqual(city.snapshot(), before);
  }
});
