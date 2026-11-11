import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { City, footprintBounds } from '../src/core.js';
import { createBaseline, createLegacyBaseline, createScene } from '../src/baseline.js';
import { buildWalkNetwork } from '../src/walk-network.js';
import { CITY_VERSION } from '../src/city-format.js';
import { isRoad, ROAD_PROFILES, roadCarriageway } from '../src/road-network.js';
import { outlineContains } from '../src/outline.js';
import { placementAnchor } from '../src/parcel.js';
import { createAlignmentMesh } from '../src/roads.js';
import { getTemplate, vehicle } from '../src/models.js';
import { VEHICLE_ENVELOPES, ROAD_DIRECTIONS } from '../src/road-junction.js';

test('directed lanes meet across curve, grid and junction seams on the shared carriageway',()=>{
  for(const id of ['T02','T03']){
    const city=new City(createScene(id).city),{segments,laneGraph,revision}=city.roadNetwork;
    assert.equal(laneGraph.revision,revision);
    for(const edge of laneGraph.edges.values()){
      const a=laneGraph.nodes.get(edge.from),b=laneGraph.nodes.get(edge.to);
      assert.ok(a.outgoing.includes(edge.id));
      for(const [point,node] of [[edge.points[0],a],[edge.points.at(-1),b]]){
        assert.ok(Math.hypot(...point.map((value,i)=>value-node.point[i]))<1e-8);
      }
      const surface=roadCarriageway(segments.get(edge.roadId));
      assert.ok(edge.points.every(([x,,z])=>surface.some(polygon=>outlineContains(polygon,x,z))),edge.id);
      assert.ok(edge.distance.every((value,i)=>!i||value>edge.distance[i-1]));
    }
    if(id==='T02'){
      const tee=city.at(-27,-14),curve=segments.get(tee.id).ports.find(port=>port.side===3).neighborId;
      assert.ok(laneGraph.nodes.get(`${tee.id}>${curve}`).outgoing.some(id=>laneGraph.edges.get(id).roadId===curve));
      assert.ok(laneGraph.nodes.get(`${curve}>${tee.id}`).outgoing.some(id=>laneGraph.edges.get(id).roadId===tee.id));
    }
  }
});

test('T05 rotated entrances connect to public paths and the quay until the last link is removed',()=>{
  const city=new City(createScene('T05').city),waterfront=city.at(-1,7);
  const check=(reachable)=>{
    const graph=buildWalkNetwork(city);
    for(const e of city.entities.values())if(e.pose){
      const n=graph.destinations.find(node=>node.entityId===e.id);
      const anchor=getTemplate(e.type,e.color).userData.anchors?.entrance??[0,.14,4.35];
      assert.deepEqual([n.x,n.y,n.z],placementAnchor(e,anchor));
      const group=graph.components.find(group=>group.includes(n));
      assert.ok(group.some(node=>node.kind==='path')&&group.some(node=>node.kind==='sidewalk'));
      assert.equal(group.some(node=>node.kind==='quay'),reachable);
    }
  };
  check(true);
  assert.ok(city.remove(waterfront.id));check(false);
  assert.ok(city.undo());check(true);
});

test('T03 junction turns match the lane ends and gate movements by the actual vehicle models',()=>{
  const city=new City(createScene('T03').city),e=city.at(-24,0),segment=city.roadNetwork.segments.get(e.id);
  const {junction,profile}=segment;
  assert.equal(junction.kind,'cross');
  assert.equal(junction.movements.filter(route=>route.vehicles.includes('car')).length,12);
  assert.equal(junction.movements.filter(route=>route.vehicles.includes('bus')).length,8);
  assert.ok(junction.movements.filter(route=>route.kind==='left').every(route=>!route.vehicles.includes('bus')));
  for(let i=0;i<5;i++){
    const model=vehicle(i),dimensions=new Box3().setFromObject(model).getSize(new Vector3()),bounds=VEHICLE_ENVELOPES[i===3?'bus':'car'];
    assert.ok(dimensions.x<=bounds.width&&dimensions.z<=bounds.length&&bounds.width<=profile.lanes[1].width);
    model.traverse(mesh=>mesh.geometry?.dispose());
  }
  for(const {from,to,samples} of junction.movements){
    assert.notEqual(from,to);
    assert.ok(samples[0].direction.every((v,i)=>v===-ROAD_DIRECTIONS[from][i]));
    assert.ok(samples.at(-1).direction.every((v,i)=>v===ROAD_DIRECTIONS[to][i]));
  }
  const walk=buildWalkNetwork(city),[x,,z]=segment.center;
  assert.equal(junction.paint.length,32);
  for(const crossing of junction.crossings){
    assert.ok(crossing.distance<crossing.stopDistance&&crossing.stopDistance<2);
    const [a,b]=crossing.ends.map(([u,v])=>[x+u,profile.walkY,z+v].map(n=>n.toFixed(3)).join(','));
    assert.equal(walk.nodes.get(a).edges.get(b),'crossing');
  }
});

test('T02 attaches a continuous arm to a tee and reconstructs its routes after history and reload',()=>{
  const city=new City(createScene('T02').city),tee=city.at(-27,-14),terminal=city.at(-24,13);
  const segment=()=>city.roadNetwork.segments.get(tee.id);
  const {junction}=segment();
  assert.equal(junction.kind,'tee');
  assert.equal(junction.crossings.length,3);
  const port=segment().ports.find(p=>p.side===3),arm=city.roadNetwork.segments.get(port.neighborId);
  assert.deepEqual(port.point,[-108,.04,-58]);
  assert.equal(arm.ports[0].neighborId,tee.id);
  assert.ok(junction.movements.some(m=>m.to===port.side||m.from===port.side));
  for(const walk of arm.sidewalks){
    const edge=walk.points[0].map(n=>n.toFixed(3)).join(',');
    assert.ok(buildWalkNetwork(city).nodes.get(edge).edges.size>=2);
  }
  const dead=city.roadNetwork.segments.get(terminal.id).junction;
  assert.equal(dead.kind,'terminal');
  assert.equal(dead.crossings.length,0);
  assert.equal(dead.movements.length,2);
  assert.ok(dead.movements.every(route=>route.kind==='stop'&&route.to===null));
  assert.ok(city.remove(arm.id));assert.equal(segment().junction,undefined);
  assert.ok(city.undo());assert.deepEqual(segment().junction,junction);
  assert.deepEqual(new City(city.snapshot()).roadNetwork,city.roadNetwork);
});

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
  const city=new City(createScene('T02').city),roads=[...city.roadNetwork.segments.values()].filter(s=>s.geometry).slice(0,4);
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
  assert.deepEqual(seam.point,[-62,.04,0]);
  assert.equal(seam.walkY,back.walkY);
  assert.deepEqual(segment.centerlines[0][0],seam.point);
  assert.deepEqual(segment.centerlines[0].at(-1),segment.ports.find(port=>port.neighborId===south.id).point);
  assert.equal(segment.profile.width,4);
  assert.equal(segment.profile.lanes.length,2);
  assert.ok(segment.profile.lanes.every(lane=>Math.abs(lane.offset)+lane.width/2<=segment.profile.carriageway/2));
  assert.deepEqual(segment.profile.sidewalks.map(walk=>walk.offset),[-1.82,1.82]);
  assert.deepEqual(network.segments.get(trail.id).ports.map(port=>port.neighborId),[nextTrail.id]);
  assert.deepEqual(network.segments.get(trail.id).profile.lanes,[]);
  const offset=ROAD_PROFILES.road.sidewalks[1].offset;
  const walk=buildWalkNetwork(city),edge=walk.nodes.get(`${seam.point[0].toFixed(3)},${seam.walkY.toFixed(3)},${offset.toFixed(3)}`);
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
