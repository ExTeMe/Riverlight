import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBaseline, createLegacyBaseline, createScene, SCENES } from '../src/baseline.js';
import { City } from '../src/core.js';
import { footprintOutline, parcelOnLand, usesParcel } from '../src/parcel.js';
import { boxOutline, outlinesOverlap } from '../src/outline.js';
import { buildWalkNetwork } from '../src/walk-network.js';
import { RIVERFRONT_STUDY_ID, STUDY_FRONTAGES, riverfrontEvidence, riverfrontGuideLines } from '../src/riverfront-study.js';

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

test('T01 includes only its two editable parcel samples and the original street layout',()=>{
  const scene=createScene('T01'),city=new City(scene.city);
  const buildings=[...city.entities.values()].filter(e=>usesParcel(e.type));
  assert.deepEqual(buildings.map(e=>[e.id,e.type,e.pose?.parcel.id]),[
    [82,'cottage','t01-cottage'],[83,'library','t01-library'],
  ]);
  assert.deepEqual(scene.scaleIds,buildings.map(e=>e.id));
  assert.equal(scene.city.parcels.length,2);
  assert.ok(scene.city.parcels.every(parcel=>!parcel.grid));
  const streets=snapshot=>snapshot.entities.filter(e=>!usesParcel(e.type));
  assert.deepEqual(streets(scene.city),streets(new City(createBaseline().city).snapshot()));
});

test('the independent western riverfront fixture uses the designated crossing and keeps the bridge navigable', () => {
  const base = createScene('T04');
  const fixture = createScene(RIVERFRONT_STUDY_ID);
  const original = new City(base.city);
  const city = new City(JSON.parse(JSON.stringify(fixture.city)));
  assert.deepEqual(createScene(RIVERFRONT_STUDY_ID), fixture);
  assert.deepEqual(createScene('T04'), base);
  assert.equal(city.undoStack.length, 0);
  assert.deepEqual(city.snapshot(), fixture.city);
  assert.deepEqual(city.roadNetwork.bridges.crossings, original.roadNetwork.bridges.crossings);
  assert.ok(city.roadNetwork.bridges.crossings[0].passable);
  assert.deepEqual(city.waterfront, original.waterfront);
  assert.ok(STUDY_FRONTAGES.every(({id})=>!city.parcels.has(id)));
  for(const {type,...parcel} of STUDY_FRONTAGES){
    assert.ok(city.editParcel(parcel,{type,color:0,angle:0,offsetX:0,offsetZ:0}).changed);
  }
  assert.ok(city.paint('path',Array.from({length:11},(_,i)=>[i-18,-1])));
  assert.deepEqual(['west-bakery', 'west-market'].map(id => city.parcels.get(id).width), [7.5, 13]);

  const probe = () => riverfrontEvidence(city, buildWalkNetwork(city));
  const evidence = probe();
  assert.deepEqual(evidence.crossing, [[-30.2, .12, -1.9], [-30.2, .12, 1.9]]);
  assert.equal(evidence.quay[2], 12);
  assert.ok(city.waterfront.some(section => section.side === -1 && section.points.some(p => p.every((v, i) => v === evidence.quay[i]))));
  for (const { route, point } of evidence.entries) {
    assert.deepEqual(route[0], point);
    const north = route.findIndex(p => p.every((v, i) => v === evidence.crossing[0][i]));
    assert.ok(north > 0);
    assert.deepEqual(route[north + 1], evidence.crossing[1]);
    assert.deepEqual(route.at(-1), evidence.quay);
  }

  for (const name of ['alley', 'platform', 'ramp']) {
    const bounds = evidence.reserved[name], outline = boxOutline(bounds);
    assert.ok(parcelOnLand(outline, bounds, city.terrain), name);
    assert.ok(!city.queryFootprints(bounds).some(e => outlinesOverlap(outline, footprintOutline(e))), name);
    assert.ok(!city.waterfront.some(section => outlinesOverlap(outline, section.outline)), name);
  }
  const ramp = evidence.reserved.ramp;
  const approach = city.roadNetwork.segments.get(city.at(-7, 1).id);
  assert.equal(ramp.lowY, approach.profile.walkY);
  assert.equal((ramp.minX + ramp.maxX) / 2, approach.center[0]);
  assert.equal(ramp.maxZ, evidence.reserved.platform.minZ);
  for (const layer of ['buildings', 'forecourt', 'alley', 'platform']) {
    assert.ok(riverfrontGuideLines(city, layer).length > 0);
  }

  assert.ok(city.remove(city.at(-8, 1).id));
  assert.equal(probe().crossing, null);
  assert.ok(probe().entries.every(entry => entry.route === null));
  assert.ok(city.undo());
  assert.deepEqual(probe(), evidence);
});
