import test from 'node:test';
import assert from 'node:assert/strict';
import { City, footprintBounds } from '../src/core.js';
import { createBaseline, createLegacyBaseline, createScene } from '../src/baseline.js';
import { footprintOutline, parcelOutline, placementOf, usesParcel } from '../src/parcel.js';
import { outlineBounds, outlinesOverlap, transformOutline } from '../src/outline.js';
import { legacyPlacement, riverBanks } from '../src/space.js';

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

test('convex outlines distinguish shared edges, shared vertices and a real overlap after rotation', () => {
  const angle=.37;
  const shape=points=>transformOutline(points,-75,-32,angle);
  const left=shape([[0,0],[6,0],[0,6]]);
  const right=shape([[6,0],[6,6],[0,6]]);
  assert.equal(outlinesOverlap(left,right),false);
  assert.equal(outlinesOverlap(left,shape([[6,0],[8,-1],[8,1]])),false);
  assert.equal(outlinesOverlap(left,shape([[5.999,0],[6,6],[0,6]])),true);
  assert.equal(outlinesOverlap(right,left),false);
});

test('T01 keeps unequal parcels with a shared slanted edge and rejects intrusion across buckets', () => {
  const {city:raw}=createScene('T01'),city=new City(raw);
  const a=city.parcels.get('t01-cottage'),b=city.parcels.get('t01-library');
  const bounds=outlineBounds(parcelOutline(b)),id=raw.entities.find(e=>e.parcelId===b.id).id;
  assert.ok(a.width*a.depth<b.width*b.depth);
  assert.ok(city.parcelSpatial.query(bounds).includes(a.id)); // AABB hit, but no overlap.
  assert.equal(outlinesOverlap(parcelOutline(a),parcelOutline(b)),false);
  const footprint=footprintBounds(city.entities.get(id));
  for(const box of [{...footprint,maxX:-64},{...footprint,minX:-64}]){
    assert.ok(city.queryFootprints(box).some(e=>e.id===id));
  }
  const bad=structuredClone(raw);
  bad.parcels.find(p=>p.id===b.id).x-=.01;
  assert.throws(()=>new City(bad),/地块与其他地块重叠/);
});

test('roads can clear a rotated corner and yard props collide with the actual building', () => {
  const raw=new City().snapshot(),lot={id:'diamond',x:-80,z:-32,width:12,depth:12,angle:45};
  raw.parcels=[lot];
  raw.entities=[{id:1,type:'cottage',color:0,parcelId:lot.id,offsetX:0,offsetZ:0,angle:0}];
  const city=new City(raw);
  assert.ok(city.place('road',-18,-6)); // Within the AABB's corner, clear of the parcel.
  assert.equal(city.place('road',-19,-7),false);
  assert.ok(city.place('flowers',-18,-8));
  assert.equal(city.place('flowers',-20,-8),false);
  assert.deepEqual(new City(city.snapshot()).snapshot(),city.snapshot());
  raw.entities.unshift({id:3,type:'road',color:0,x:-19,z:-7,rotation:0});
  assert.throws(()=>new City(raw),/这里已有地块/);
});

test('bank strips allow a tangent lot and catch water intrusion on both terrains', () => {
  for(const terrain of ['meander','legacy']){
    const raw=new City().snapshot(),west=riverBanks(0,terrain)[0];
    const radians=Math.atan((riverBanks(2,terrain)[0]-west)/2);
    const lot={id:'bank',x:west-2/Math.cos(radians)-.25,z:0,width:4,depth:8,angle:radians*180/Math.PI};
    raw.terrain=terrain;raw.parcels=[lot];
    assert.ok(outlineBounds(parcelOutline(lot)).maxX>west);
    assert.doesNotThrow(()=>new City(raw));
    lot.x+=.65;
    assert.throws(()=>new City(raw),/地块侵入水域/);
  }
  const raw=new City().snapshot(),lot={id:'border',x:-254,z:-30,width:8,depth:6,angle:0};
  raw.parcels=[lot];
  assert.doesNotThrow(()=>new City(raw)); // x=-258 is the inclusive world edge.
  lot.angle=13;
  assert.throws(()=>new City(raw),/地块超出可建边界/);
});

test('parcel resize is atomic and successful resizing supports undo and redo', () => {
  const {city:raw}=createScene('T01'),city=new City(raw),id='t01-cottage';
  const building=[...city.entities.values()].find(e=>e.pose?.parcel.id===id);
  assert.ok(city.recolor(building.id));
  assert.ok(city.undo());
  const before=city.snapshot(),index=city.parcelSpatial,oldBounds=index.bounds.get(id);
  const {width,depth}=city.parcels.get(id);
  assert.equal(city.resizeParcel(id,8,depth),false);
  assert.equal(city.resizeParcel(id,width+1,depth),false); // Would cross the neighbor's edge.
  assert.deepEqual(city.snapshot(),before);
  assert.equal(city.undoStack.length,0);
  assert.equal(city.redoStack.length,1);
  assert.equal(index.bounds.get(id),oldBounds);
  assert.ok(city.resizeParcel(id,width-1,depth));
  assert.equal(city.redoStack.length,0);
  assert.deepEqual(footprintOutline(city.entities.get(building.id)),footprintOutline(building));
  assert.equal(city.entities.get(building.id).pose.parcel,city.parcels.get(id));
  assert.notDeepEqual(index.bounds.get(id),oldBounds);
  assert.ok(city.undo());
  assert.equal(city.parcels.get(id).width,width);
  assert.deepEqual(index.bounds.get(id),oldBounds);
  assert.ok(city.redo());
  assert.equal(city.parcels.get(id).width,width-1);
  assert.deepEqual(new City(city.snapshot()).snapshot(),city.snapshot());
});
