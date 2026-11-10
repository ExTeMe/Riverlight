import test from 'node:test';
import assert from 'node:assert/strict';
import { City, footprintBounds } from '../src/core.js';
import { createBaseline, createLegacyBaseline, createScene } from '../src/baseline.js';
import { buildWalkNetwork } from '../src/walk-network.js';
import { CITY_VERSION } from '../src/city-format.js';
import { isRoad } from '../src/road-network.js';

test('v1–v3 grid roads migrate without moving roads, bridges, paths or parcels',()=>{
  const fixtures=[createLegacyBaseline().city,createBaseline().city,new City(createScene('T01').city).snapshot(3)];
  for(const raw of fixtures){
    const before=new City(raw),data=before.snapshot();
    assert.equal(data.version,CITY_VERSION);
    assert.deepEqual(data.roads,{layout:'grid-v1',revision:0});
    const after=new City(JSON.parse(JSON.stringify(data)));
    assert.deepEqual(after.snapshot(),data);
    assert.deepEqual(after.entities,before.entities);
    assert.deepEqual(after.occupancy,before.occupancy);
    assert.deepEqual(after.parcels,before.parcels);
    assert.equal(after.terrain,before.terrain);
    assert.deepEqual(after.roadNetwork,before.roadNetwork);
    for(const e of before.entities.values())if(isRoad(e.type)){
      const saved=data.entities.find(row=>row.id===e.id);
      assert.equal('x' in saved||'z' in saved,false);
      assert.deepEqual(saved.center,[e.x*4,e.type==='bridge'?.45:.04,e.z*4]);
      assert.deepEqual(footprintBounds(after.entities.get(e.id)),footprintBounds(e));
    }
  }
});

test('road segments expose shared ports, usable profiles and matching bridge grades',()=>{
  const city=new City(),corner=city.place('road',-16,0),east=city.place('bridge',-15,0),south=city.place('road',-16,1);
  const trail=city.place('path',-17,0),nextTrail=city.place('path',-18,0);
  assert.ok(corner&&east&&south&&trail&&nextTrail);
  const network=city.roadNetwork,segment=network.segments.get(corner.id),bridge=network.segments.get(east.id);
  const seam=segment.ports.find(port=>port.neighborId===east.id),back=bridge.ports.find(port=>port.neighborId===corner.id);
  assert.deepEqual(seam.point,back.point);
  assert.deepEqual(seam.point,[-62,.245,0]);
  assert.equal(seam.walkY,back.walkY);
  assert.deepEqual(segment.centerlines[0][0],seam.point);
  assert.deepEqual(segment.centerlines[0].at(-1),segment.ports.find(port=>port.neighborId===south.id).point);
  assert.equal(segment.profile.width,4);
  assert.equal(segment.profile.lanes.length,2);
  assert.ok(segment.profile.lanes.every(lane=>Math.abs(lane.offset)+lane.width/2<=segment.profile.carriageway/2));
  assert.deepEqual(segment.profile.sidewalks.map(walk=>walk.offset),[-1.7,1.7]);
  assert.deepEqual(network.segments.get(trail.id).ports.map(port=>port.neighborId),[nextTrail.id]);
  assert.deepEqual(network.segments.get(trail.id).profile.lanes,[]);
  const walk=buildWalkNetwork(city),edge=walk.nodes.get(`${seam.point[0].toFixed(3)},${seam.walkY.toFixed(3)},1.700`);
  assert.equal(walk.revision,network.revision);
  assert.ok(edge.edges.size>=2);
});

test('road revision advances once per batch and on history, and ignores failed and unrelated edits',()=>{
  const city=new City(),empty=city.roadNetwork;
  assert.ok(city.paint('road',[[-18,-8],[-17,-8],[-16,-8]]));
  const painted=city.roadNetwork;
  assert.equal(painted.revision,empty.revision+1);
  assert.ok(city.place('tree',-20,-8));
  const centre=city.at(-17,-8);
  assert.ok(city.recolor(centre.id));
  assert.equal(city.place('road',-17,-8),false);
  assert.equal(city.move(centre.id,-16,-8,0),false);
  assert.equal(city.roadNetwork,painted);
  assert.ok(city.remove(centre.id));
  assert.equal(city.roadNetwork.revision,painted.revision+1);
  assert.equal(city.roadNeighbors(city.at(-18,-8)).length,0);
  assert.ok(city.undo());
  assert.equal(city.roadNetwork.revision,painted.revision+2);
  assert.equal(city.roadNeighbors(city.at(-18,-8))[0].id,centre.id);
  assert.ok(city.redo());
  assert.equal(city.roadNetwork.revision,painted.revision+3);
  assert.deepEqual(new City(city.snapshot()).roadNetwork,city.roadNetwork);
});

test('invalid road records cannot replace a city or change its revision',()=>{
  const city=new City(createScene('T04').city),before=city.snapshot(),network=city.roadNetwork;
  for(const corrupt of [
    data=>delete data.roads,
    data=>data.roads.layout='unknown',
    data=>data.roads.revision=-1,
    data=>data.entities.find(row=>row.type==='road').center[0]+=.25,
    data=>data.entities.find(row=>row.type==='bridge').center[1]=0,
    data=>data.entities.find(row=>row.type==='road').x=0,
    data=>data.entities.find(row=>row.type==='road').center[0]=1e12,
  ]){
    const bad=structuredClone(before);corrupt(bad);
    assert.throws(()=>city.restore(bad));
    assert.deepEqual(city.snapshot(),before);
    assert.equal(city.roadNetwork,network);
  }
});
