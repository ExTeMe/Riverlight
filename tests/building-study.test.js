import assert from 'node:assert/strict';
import test from 'node:test';
import { createScene } from '../src/baseline.js';
import { buildingStudyAssets, createBuildingStudy, registerStudyBuildings } from '../src/building-study.js';
import { BY_ID } from '../src/catalog.js';
import { City } from '../src/core.js';
import { placementOf } from '../src/parcel.js';
import { parseCityFile } from '../src/save-session.js';

registerStudyBuildings();

test('building study shares the original bridge and waterfront with the West Bank fixture', () => {
  const options = { allowRiverfront: true };
  const base = new City(createScene('T04-WEST').city, options);
  const study = createBuildingStudy('WEST-BUILDINGS', 'standard');
  const city = new City(study.city, options);
  assert.deepEqual(city.roadNetwork.bridges.crossings, base.roadNetwork.bridges.crossings);
  assert.deepEqual(city.waterfront, base.waterfront);
  assert.equal(city.platform.record.rise, .14);
  assert.deepEqual([...city.entities.values()].filter(entity => Object.hasOwn(buildingStudyAssets, entity.type))
    .map(entity => [placementOf(entity).x, placementOf(entity).z]), [[-64.75, -12.25], [-49.5, -16]]);
  const saved = JSON.stringify({ city: study.city, camera: study.camera });
  assert.throws(() => parseCityFile(saved), /不受支持/);
  assert.deepEqual(parseCityFile(saved, options).city.snapshot(), study.city);
});

test('the two study roofs enforce clearance before and after road placement', () => {
  const road = height => ({ start: [-112, height, 12, 0], end: [-40, height, 12, 0], elevated: true });
  for (const [type, lowDeck] of [['west-reading-house', 6.75], ['west-bridge-market', 6.1]]) {
    const { w, d } = BY_ID[type];
    const parcel = { id: 'construction-test', x: -76, z: 12, width: w * 4, depth: d * 4, angle: 0 };
    const design = { type, angle: 0, offsetX: 0, offsetZ: 0, color: 0 };
    const fromBuilding = new City();
    assert.ok(fromBuilding.editParcel(parcel, design).changed);
    assert.match(fromBuilding.planRoadAlignment(road(lowDeck)).error, /上方桥底净空不足/);
    assert.ok(fromBuilding.editRoadAlignment(road(10)).changed);
    for (const height of [lowDeck, 10]) {
      const fromRoad = new City();
      assert.ok(fromRoad.editRoadAlignment(road(height)).changed);
      const result = fromRoad.editParcel(parcel, design);
      if (height === lowDeck) assert.match(result.error, /上方桥底净空不足/);
      else assert.ok(result.changed);
      assert.deepEqual(new City(fromRoad.snapshot()).snapshot(), fromRoad.snapshot());
    }
    const rotated = new City();
    const lot = { ...parcel, width: 19, depth: 18 };
    assert.ok(rotated.editParcel(lot, design).changed);
    const result = rotated.editParcel(lot, { ...design, angle: 23 });
    assert.ok(result.changed);
    assert.equal(result.entity.pose.angle, 23);
    assert.ok(rotated.undo());
    assert.equal(rotated.parcelOwner(rotated.parcels.get(lot.id)).pose.angle, 0);
    assert.ok(rotated.redo());
    assert.equal(rotated.parcelOwner(rotated.parcels.get(lot.id)).pose.angle, 23);
    assert.deepEqual(new City(rotated.snapshot()).snapshot(), rotated.snapshot());
  }
});
