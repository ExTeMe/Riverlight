import test from 'node:test';
import assert from 'node:assert/strict';
import { City, footprintBounds } from '../src/core.js';
import { createBaseline, createLegacyBaseline, createScene } from '../src/baseline.js';
import { buildWalkNetwork } from '../src/walk-network.js';
import { CITY_VERSION } from '../src/city-format.js';
import { isRoad } from '../src/road-network.js';
import { createAlignmentMesh } from '../src/roads.js';

test('v1–v4 grid roads migrate without moving roads, bridges, paths or parcels',()=>{
  const city=new City(createScene('T01').city);
  const fixtures=[createLegacyBaseline().city,createBaseline().city,city.snapshot(3),city.snapshot(4)];
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

test('T02 alignment joins share position, tangent, grade and sidewalk edges across chunks',()=>{
  const city=new City(createScene('T02').city),roads=[...city.roadNetwork.segments.values()].filter(s=>s.geometry);
  assert.equal(roads.length,4);
  const [straight,left,right,ramp]=roads;
  assert.equal(straight.geometry.minRadius,Infinity);
  assert.ok(left.geometry.minRadius<Infinity&&right.geometry.minRadius<Infinity);
  assert.ok(ramp.geometry.maxGrade>0&&ramp.geometry.maxGrade<.12);
  assert.ok(ramp.geometry.bounds.minX< -66&&ramp.geometry.bounds.maxX> -66);
  const walk=buildWalkNetwork(city);
  const alignment=city.entities.get(ramp.id).alignment;
  assert.match(city.editRoadAlignment({...alignment,start:[-82,.25,-95,15]},ramp.id).error,/共用高度与切线/);
  for(const [i,road] of roads.entries()){
    const mesh=createAlignmentMesh(road.geometry,road.ports,()=>undefined);
    assert.ok(mesh.children[0].geometry.attributes.normal.array.filter((_,i)=>i%3===1).every(y=>y>.98));
    for(const {points} of road.lanes)assert.ok(points.every(([,y],j)=>Math.abs(y-road.centerlines[0][j][1]-.03)<1e-9));
    for(const child of mesh.children){child.geometry.dispose();child.material.dispose();}
    if(!i)continue;
    const previous=roads[i-1],a=previous.geometry.samples.at(-1),b=road.geometry.samples[0];
    assert.deepEqual(a.point,b.point);
    assert.deepEqual(a.direction,b.direction);
    assert.equal(previous.ports.find(p=>p.end===1).neighborId,road.id);
    for(const [side,{points}] of road.sidewalks.entries()){
      assert.deepEqual(previous.sidewalks[side].points.at(-1),points[0]);
      assert.ok(walk.nodes.get(points[0].map(n=>n.toFixed(3)).join(',')).edges.size>=2);
    }
  }
});

test('alignment edits reject invalid geometry and occupied footprints and survive undo and import',()=>{
  const city=new City();
  const start=[-110,0,-100,0],end=[-78,1,-100,0],raw={start,end};
  const first=city.editRoadAlignment(raw);
  assert.ok(first.changed);
  assert.equal(city.nativeAt(-94,-100).id,first.entity.id);
  assert.equal(city.place('road',-24,-25),false);
  assert.ok(city.place('road',-24,-27));
  const before=city.snapshot(),network=city.roadNetwork;
  for(const bad of [
    {...raw,end:[-78,8,-100,0]},
    {start:[-110,0,-100,59],end:[-103,0,-100,59]},
    {start:[-94,0,-106,90],end:[-94,0,-94,90]},
    {start:[-7,0,0,0],end:[20,0,0,0]},
  ])assert.ok(city.editRoadAlignment(bad).error);
  assert.equal(city.editRoadAlignment(raw,first.entity.id).changed,false);
  assert.deepEqual(city.snapshot(),before);
  assert.equal(city.roadNetwork,network);
  const invalid=structuredClone(before);invalid.entities[0].alignment.end[1]=8;
  assert.throws(()=>city.restore(invalid),/坡度/);
  assert.deepEqual(city.snapshot(),before);
  assert.throws(()=>city.snapshot(4));
  const changed=city.editRoadAlignment({...raw,end:[-78,1.5,-100,0]},first.entity.id);
  assert.equal(changed.entity.id,first.entity.id);
  assert.ok(city.undo());assert.deepEqual(city.entities.get(first.entity.id).alignment,first.entity.alignment);
  assert.ok(city.redo());assert.deepEqual(city.entities.get(first.entity.id).alignment,changed.entity.alignment);
  assert.deepEqual(new City(JSON.parse(JSON.stringify(city.snapshot()))).snapshot(),city.snapshot());
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
