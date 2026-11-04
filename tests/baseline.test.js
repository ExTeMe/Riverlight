import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBaseline, createLegacyBaseline, createScene, SCENES } from '../src/baseline.js';
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

test('seven scene layouts are deterministic, valid, distinct and save compatible', () => {
  const layouts=new Set();
  for(const {id} of SCENES){
    const fixture=createScene(id);
    assert.deepEqual(fixture,createScene(id));
    const city=new City(fixture.city);
    assert.deepEqual(city.snapshot(),fixture.city);
    assert.equal(city.undoStack.length,0);
    assert.ok(fixture.limitations.length);
    assert.deepEqual(fixture.camera,fixture.cameras.medium);
    assert.ok(Object.values(fixture.cameras).every(c=>c.position.every(Number.isFinite)));
    layouts.add(JSON.stringify(fixture.city.entities));
    city.remove(city.entities.keys().next().value);
    assert.notDeepEqual(city.snapshot(),createScene(id).city);
    assert.deepEqual(createScene(id),fixture);
  }
  assert.equal(layouts.size,7);
  const counts=['sparse','standard','dense'].map(d=>new City(createScene('T07',d).city).entities.size);
  assert.ok(counts[0]<counts[1]&&counts[1]<counts[2]);
  assert.throws(()=>createScene('T08'),/未知场景/);
  assert.throws(()=>createScene('T07','huge'),/未知场景密度/);
});
