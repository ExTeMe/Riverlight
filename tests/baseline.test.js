import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBaseline, createLegacyBaseline } from '../src/baseline.js';
import { City } from '../src/core.js';

test('fixed baseline fixtures match their versioned generators and survive editing/save roundtrips', async () => {
  for (const [file, fixture] of [['base-02-v2.json', createBaseline()], ['base-02-v1.json', createLegacyBaseline()]]) {
    const raw = JSON.parse(await readFile(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
    assert.deepEqual(raw, fixture);
    const original = structuredClone(raw), city = new City(raw.city), before = city.snapshot();
    const house = [...city.entities.values()].find(entity => entity.type === 'cottage');
    assert.equal(city.move(house.id, 0, 0, 0), false);
    assert.deepEqual(city.snapshot(), before);
    assert.ok(city.move(house.id, -30, -20, 1));
    assert.ok(city.undo()); assert.deepEqual(city.snapshot().entities.toSorted((a,b)=>a.id-b.id), before.entities.toSorted((a,b)=>a.id-b.id));
    assert.ok(city.redo());
    assert.deepEqual(new City(JSON.parse(JSON.stringify(city.snapshot()))).snapshot(), city.snapshot());
    assert.deepEqual(raw, original);
  }
});
