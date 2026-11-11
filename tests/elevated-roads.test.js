import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { City } from '../src/core.js';
import { CATALOG } from '../src/catalog.js';
import { obstacleHeight } from '../src/elevated-roads.js';
import { getTemplate, material } from '../src/models.js';
import { createAlignmentMesh } from '../src/roads.js';
import { bridgeObstacles, navigationRoutes, navigationTrack } from '../src/navigation.js';
import { buildWalkNetwork } from '../src/walk-network.js';
import { riverBanks } from '../src/river.js';

const span=(start,end)=>({start,end,elevated:true});

test('elevated continuation shares 3D ports through ascent, water crossing and descent',()=>{
  const city=new City(),start=[-124,0,0,0],approach=[-34,7.2,0,0],up=[-10,9.12,0,0],level=[45,9.12,0,0],end=[165,0,0,0];
  const old=city.editRoadAlignment({start,end:approach});
  assert.ok(old.changed);
  const legacy=new City(city.snapshot(5));
  assert.deepEqual(legacy.entities.get(old.entity.id).alignment,{start,end:approach});
  assert.match(city.planRoadAlignment(span([-32,1,8,0],[40,1,8,0])).error,/跨水桥底净空不足/);
  const results=[span(approach,up),span(up,level),span(level,end)].map(raw=>city.editRoadAlignment(raw));
  for(const result of results)assert.ok(result.changed,result.error);
  const {segments,laneGraph,bridges}=city.roadNetwork;
  const walk=buildWalkNetwork(city);
  const ids=[old,...results].map(r=>r.entity.id);
  for(const [i,id] of ids.slice(1).entries()){
    const previous=ids[i],segment=segments.get(id);
    assert.equal(segment.ports.find(p=>p.end===0).neighborId,previous);
    assert.ok(laneGraph.nodes.get(`${previous}>${id}`).outgoing.length);
    for(const {points} of segment.walkways)assert.equal(walk.nodes.get(points[0].map(v=>v.toFixed(3)).join(',')).edges.size,2);
  }
  assert.equal(bridges.crossings.length,2);
  assert.ok(bridges.crossings.every(crossing=>crossing.passable));
  const track=navigationTrack(city.worldBounds(),city.terrain);
  assert.deepEqual(navigationRoutes(track,bridgeObstacles(bridges.crossings)),[{from:0,to:track.length,blockedStart:false,blockedEnd:false}]);
  const deck=segments.get(ids[2]),mesh=createAlignmentMesh(deck.geometry,deck.ports,material,deck.structure);
  mesh.updateMatrixWorld(true);
  const ray=new Raycaster(new Vector3(0,0,0),new Vector3(0,1,0));
  assert.ok(Math.abs(ray.intersectObject(mesh,true)[0].point.y-(up[1]-.25))<1e-6);
  for(const child of mesh.children)child.geometry.dispose();
  const before=city.snapshot();
  assert.equal(before.version,6);
  assert.throws(()=>city.snapshot(5),/无法导出/);
  assert.deepEqual(new City(before).snapshot(),before);
  assert.ok(city.undo());assert.ok(city.redo());
  assert.deepEqual(city.snapshot().entities,before.entities);
  const diagonal=new City(),a=[-35,6,-5,30],b=[42,6,39,30];
  const angled=diagonal.editRoadAlignment(span(a,b));
  assert.ok(angled.changed,angled.error);
  const diagonalTrack=navigationTrack(diagonal.worldBounds(),diagonal.terrain);
  assert.equal(navigationRoutes(diagonalTrack,bridgeObstacles(diagonal.roadNetwork.bridges.crossings))[0].to,diagonalTrack.length);
});

test('elevated roads clear shorter buildings and keep crossing layers unconnected',()=>{
  const high=span([-110,10,12,0],[-38,10,12,0]),low=span([-110,6,12,0],[-38,6,12,0]);
  const city=new City();
  assert.ok(city.place('cottage',-19,3));
  assert.match(city.planRoadAlignment(low).error,/河畔小屋上方桥底净空不足/);
  assert.ok(city.editRoadAlignment(high).changed);
  assert.deepEqual(new City(city.snapshot()).snapshot(),city.snapshot());
  const reverse=new City();
  assert.ok(reverse.editRoadAlignment(high).changed);
  assert.equal(reverse.place('cottage',-17,3),false); // pier, even with enough height
  assert.equal(reverse.place('glass-tower',-19,3),false);
  assert.ok(reverse.place('cottage',-19,3));
  assert.deepEqual(new City(reverse.snapshot()).snapshot(),reverse.snapshot());
  const crossing=new City(),ground=crossing.editRoadAlignment({start:[-74,0,-28,90],end:[-74,0,45,90]});
  const deck=crossing.editRoadAlignment(high);
  assert.ok(ground.changed&&deck.changed);
  assert.deepEqual(crossing.roadNeighbors(ground.entity),[]);
  assert.deepEqual(crossing.roadNeighbors(deck.entity),[]);
  const walk=buildWalkNetwork(crossing);
  assert.equal(walk.components.filter(group=>group.some(n=>n.kind==='sidewalk')).length,4);
  assert.ok(walk.components.every(group=>group.every(node=>(node.y>5)===(group[0].y>5))));
});

test('two supported spans meet over a strait wider than a single road and leave the sea lane clear',()=>{
  const city=new City();city.terrain='strait';
  const [west,east]=riverBanks(0,city.terrain);
  assert.ok(east-west>160);
  const joint=[0,7,0,0];
  const first=city.editRoadAlignment(span([-100,7,0,0],joint)),second=city.editRoadAlignment(span(joint,[100,7,0,0]));
  assert.ok(first.changed&&second.changed);
  assert.equal(city.roadNetwork.segments.get(first.entity.id).ports[0].neighborId,second.entity.id);
  const {crossings}=city.roadNetwork.bridges;
  assert.equal(crossings.length,2);
  assert.ok(crossings.every(bridge=>bridge.passable&&bridge.piers.length>1));
  const track=navigationTrack(city.worldBounds(),city.terrain);
  assert.deepEqual(navigationRoutes(track,bridgeObstacles(crossings)),[{from:0,to:track.length,blockedStart:false,blockedEnd:false}]);
  const saved=city.snapshot();
  assert.equal(saved.terrain,'strait');
  assert.deepEqual(new City(saved).snapshot(),saved);
  assert.throws(()=>new City({...saved,version:5}),/未知地形/);
});

test('bridge clearance bounds cover authored, distant and fallback model heights',async()=>{
  const loader=new GLTFLoader();
  for(const {id,category} of CATALOG){
    if(category==='road')continue;
    const stem=id==='mall'?'shopping-gallery':id,limit=obstacleHeight({type:id});
    assert.ok(new Box3().setFromObject(getTemplate(id),true).max.y<limit,id);
    for(const suffix of ['','_lod']){
      const bytes=await readFile(new URL(`../public/models/${stem}${suffix}.glb`,import.meta.url));
      const {scene}=await loader.parseAsync(Uint8Array.from(bytes).buffer,'');
      assert.ok(new Box3().setFromObject(scene,true).max.y<limit,`${stem}${suffix}`);
    }
  }
});
