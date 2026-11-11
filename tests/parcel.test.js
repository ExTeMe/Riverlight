import test from 'node:test';
import assert from 'node:assert/strict';
import { City, footprintBounds } from '../src/core.js';
import { createBaseline, createLegacyBaseline, createScene } from '../src/baseline.js';
import { footprintOutline, PARCEL_EDGES, parcelOutline, parcelPoint, placementAnchor, placementOf, resizeParcelEdge, usesParcel } from '../src/parcel.js';
import { outlineBounds, outlinesOverlap, transformOutline } from '../src/outline.js';
import { legacyPlacement, riverBanks } from '../src/space.js';
import { Matrix4, Scene, Vector3 } from 'three';
import { World } from '../src/world.js';
import { getTemplate } from '../src/models.js';
import { buildWalkNetwork } from '../src/walk-network.js';
import { CITY_VERSION } from '../src/city-format.js';

test('each edge of a rotated lot moves independently and preserves an occupied lot building pose',()=>{
  const city=new City(createScene('T01').city),lot=city.parcels.get('t01-cottage'),building=city.parcelOwner(lot);
  const compare=(a,b)=>assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8,`${a} differs from ${b}`);
  for(const [key,{axis,index,sign}] of Object.entries(PARCEL_EDGES)){
    const point=(p,side)=>{const v=[0,0];v[index]=side*p[axis]/2;return parcelPoint(p,...v);};
    for(const distance of [2.5,-1.5]){
      const result=resizeParcelEdge(lot,key,sign*distance),next=result.parcel;
      compare(point(lot,-sign),point(next,-sign));
      assert.equal(next[axis],lot[axis]+distance);
      assert.equal(next[index===0?'depth':'width'],lot[index===0?'depth':'width']);
      const pose=placementOf({...building,pose:{...building.pose,parcel:next,
        offsetX:building.pose.offsetX-result.shift[0],offsetZ:building.pose.offsetZ-result.shift[1]}});
      const before=placementOf(building);
      compare([pose.x,pose.z],[before.x,before.z]);assert.equal(pose.radians,before.radians);
    }
  }
});

test('v1 and v2 baselines retain original grid occupancy, model transforms and river after migration', () => {
  for (const fixture of [createLegacyBaseline(), createBaseline()]) {
    const before = new City(fixture.city), snapshot = before.snapshot();
    const after = new City(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(snapshot.version, CITY_VERSION);
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
  raw.entities.unshift({id:3,type:'road',color:0,center:[-76,.04,-28],rotation:0});
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

test('empty lots, attachment and moving an occupied lot share one reversible validation path', () => {
  const city=new City(),parcel={id:'yard',x:-100,z:48,width:16,depth:16,angle:20};
  assert.ok(city.editParcel(parcel).changed);
  assert.equal(city.parcelAt(-100,48).id,parcel.id);
  const building={type:'cottage',color:1,offsetX:.75,offsetZ:-.5,angle:17.5};
  const attached=city.editParcel(parcel,building);
  assert.ok(attached.changed);
  const before=city.snapshot(),oldId=attached.entity.id;
  assert.equal(city.editParcel(parcel,{...building,offsetX:12}).error,'建筑超出地块边界');
  assert.equal(city.editParcel({...parcel,x:0},building).error,'地块侵入水域');
  assert.deepEqual(city.snapshot(),before);
  const moved=city.editParcel({...parcel,x:-104,z:45,angle:32.6});
  assert.ok(moved.changed);
  assert.equal(moved.entity.id,oldId);
  assert.equal(moved.entity.pose.angle,17.5);
  assert.equal(moved.entity.pose.offsetX,.75);
  assert.ok(city.undo());
  assert.deepEqual(city.snapshot(),before);
  assert.ok(city.undo());
  assert.equal(city.parcelOwner(city.parcels.get(parcel.id)),undefined);
  assert.ok(city.redo());
  assert.equal(city.parcelOwner(city.parcels.get(parcel.id)).id,oldId);
});

test('the same building pose drives preview, mesh, selection and connected entrance', () => {
  const city=new City(),world=new World(new Scene(),city);
  const parcel={id:'yard',x:-100,z:48,width:12,depth:12,angle:20};
  const building={type:'cottage',color:1,offsetX:.75,offsetZ:-.5,angle:17.5};
  const plan=city.planParcelEdit(parcel,building);
  assert.equal(plan.error,undefined);
  world.showParcelPreview(plan);
  const {x,z,radians}=placementOf(plan.entity);
  assert.deepEqual([world.preview.position.x,world.preview.position.z,world.preview.rotation.y],[x,z,radians]);
  const preview=world.previewFootprint.geometry.attributes.position.array;
  const {entity}=city.editParcel(parcel,building);
  assert.ok(city.place('path',-24,14));assert.ok(city.place('path',-24,15));
  world.sync(true);world.select(entity.id,parcel.id);
  const picked=world.pickables.find(mesh=>mesh.userData.entityIds?.includes(entity.id));
  assert.ok(picked);
  const matrix=new Matrix4();picked.getMatrixAt(picked.userData.entityIds.indexOf(entity.id),matrix);
  const location=new Vector3().setFromMatrixPosition(matrix);
  assert.ok(Math.hypot(location.x-x,location.z-z)<1e-5);
  const selection=world.selection.geometry.attributes.position.array;
  assert.deepEqual([selection[0],selection[2],selection[3],selection[5]],[preview[0],preview[2],preview[3],preview[5]]);
  const anchor=getTemplate(entity.type,entity.color).userData.anchors?.entrance??[0,.14,4.35];
  const [entryX,,entryZ]=placementAnchor(entity,anchor);
  assert.ok(buildWalkNetwork(city).destinations.some(n=>Math.hypot(n.x-entryX,n.z-entryZ)<1e-8));
});
