import test from 'node:test';
import assert from 'node:assert/strict';
import { City } from '../src/core.js';
import { placementOf } from '../src/parcel.js';

test('a group can move through its previous footprints and rejects a collision as one operation',()=>{
  const city=new City();
  const a=city.place('tree',-40,-30);
  const b=city.place('bench',-39,-30);
  const blocker=city.place('tree',-37,-30);
  assert.ok(a&&b&&blocker);
  const ids=[a.id,b.id];
  const before=city.snapshot();
  assert.equal(city.transformGroup(ids,[-160,-120],8,0,0),false);
  assert.deepEqual(city.snapshot(),before);
  assert.ok(city.transformGroup(ids,[-160,-120],4,0,0));
  assert.equal(city.at(-39,-30).id,a.id);
  assert.equal(city.at(-38,-30).id,b.id);
  assert.ok(city.undo());
  assert.equal(city.at(-40,-30).id,a.id);
  assert.equal(city.at(-39,-30).id,b.id);
  assert.ok(city.redo());
  assert.ok(city.removeGroup(ids));
  assert.equal(city.entities.size,1);
  assert.ok(city.undo());
  assert.equal(city.entities.size,3);
});

test('a mixed group rotates around its pivot with the owned parcel and survives reload',()=>{
  const city=new City();
  const parcel={id:'home',x:-160,z:-120,width:10,depth:12,angle:15};
  const result=city.editParcel(parcel,{type:'cottage',color:0,offsetX:1,offsetZ:0,angle:0});
  assert.ok(result.changed,result.error);
  const house=result.entity,tree=city.place('tree',-36,-30);
  const ids=[house.id,tree.id];
  const delta=(a,b)=>[b.x-a.x,b.z-a.z];
  const previous=delta(placementOf(house),placementOf(tree));
  assert.ok(city.transformGroup(ids,[-152,-120],0,0,90),city.editError);
  const next=delta(...ids.map(id=>placementOf(city.entities.get(id))));
  assert.ok(Math.abs(next[0]-previous[1])<1e-8);
  assert.ok(Math.abs(next[1]+previous[0])<1e-8);
  assert.equal(city.parcels.get(parcel.id).angle,105);
  const save=city.snapshot();
  assert.deepEqual(new City(save).snapshot(),save);
  assert.ok(city.undo());
  assert.equal(city.parcels.get(parcel.id).angle,15);
});

test('rotating a grid tile and continuous road together keeps their shared port',()=>{
  const city=new City();
  const tile=city.place('road',-40,-30);
  const {entity:road,error}=city.editRoadAlignment({start:[-160,.04,-118,90],end:[-160,.04,-88,90]});
  assert.ok(road,error);
  assert.equal(city.roadNetwork.segments.get(road.id).ports[0].neighborId,tile.id);
  assert.ok(city.transformGroup([tile.id,road.id],[-160,0],120,0,90),city.editError);
  assert.equal(city.roadNetwork.segments.get(road.id).ports[0].neighborId,tile.id);
});
