import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Raycaster, Scene, Vector3 } from 'three';
import { City, footprintBounds } from '../src/core.js';
import { riverWaterGeometry } from '../src/environment.js';
import { boat } from '../src/models.js';
import { footprintOutline } from '../src/parcel.js';
import { WATER_Y, PROTOTYPE_HULL, PROTOTYPE_RADIUS, navigableSpan, riverBanks, riverSections, sailingReaches, terrainSurfaceAt, waterAt, waterOverlaps } from '../src/river.js';
import { World } from '../src/world.js';
import { buildWalkNetwork } from '../src/walk-network.js';

test('terrain queries and reflective mesh share interpolated banks at chunk seams',()=>{
  for(const terrain of ['legacy','meander']){
    const city=new City();city.terrain=terrain;
    const world=new World(new Scene(),city),land=[...world.loaded.values()].map(c=>c.land);
    world.scene.updateMatrixWorld(true);
    const ray=new Raycaster(),down=new Vector3(0,-1,0);
    for(let z=19.25;z<65;z+=1.7){
      const [west,east]=riverBanks(z,terrain);
      for(const x of [west-.05,west+.05,east-.05,east+.05]){
        const wet=x>west&&x<east;
        assert.deepEqual(city.surfaceAt(x,z),wet?{groundY:null,waterY:WATER_Y}:{groundY:0,waterY:null});
        ray.set(new Vector3(x,4,z),down);
        assert.equal(ray.intersectObjects(land,true).some(hit=>Math.abs(hit.point.y)<1e-6),!wet);
      }
    }
    const geometry=riverWaterGeometry(terrain),{position,normal}=geometry.attributes;
    for(let i=0;i<position.count;i+=7){
      const [west,east]=riverBanks(-position.getY(i),terrain),x=position.getX(i);
      assert.ok(Math.min(Math.abs(x-west),Math.abs(x-east))<2e-5);
      assert.ok(normal.getZ(i)>.999);
    }
    geometry.dispose();world.clear();world.horizon.geometry.dispose();world.quay.geometry.dispose();
  }
});

test('historic shore placements roundtrip while new grid edits use the full bank footprint',()=>{
  const city=new City(),raw=city.snapshot(2);
  raw.entities.push({id:1,type:'road',x:-4,z:0,rotation:0,color:0});raw.nextId=2;
  assert.equal(waterAt(-4,0),false);
  assert.equal(city.place('road',-4,0),false);
  const restored=new City(raw);
  assert.deepEqual(restored.snapshot(2),raw);
  assert.deepEqual(new City(restored.snapshot()).snapshot(),restored.snapshot());
  assert.ok(restored.move(1,-5,0,0));assert.ok(restored.undo());
  assert.equal(restored.entities.get(1).x,-4);
  assert.throws(()=>new City({...raw,entities:[{...raw.entities[0],x:0}]}),/水面/);
});

test('occupied shore sections leave both the quay mesh and walking graph and return on undo',()=>{
  const city=new City();assert.ok(city.place('path',-8,0));
  const before=city.waterfront,cottage=city.place('cottage',-5.5,0);
  assert.ok(cottage);
  const after=city.waterfront;
  assert.ok(after.length<before.length);
  const world=new World(new Scene(),city);
  assert.equal(world.quay.geometry.attributes.position.count,after.length*6);
  const graph=buildWalkNetwork(city),id=([x,y,z])=>[x,y,z].map(n=>n.toFixed(3)).join(',');
  for(const section of before){
    const [a,b]=section.points.map(id);
    assert.equal(graph.nodes.get(a)?.edges.has(b)??false,
      after.some(item=>item.side===section.side&&item.from===section.from));
  }
  assert.ok(city.undo());assert.deepEqual(city.waterfront,before);
  world.sync(true);assert.equal(world.quay.geometry.attributes.position.count,before.length*6);
  world.clear();world.quay.geometry.dispose();world.horizon.geometry.dispose();
});

test('prototype hull envelope stays inside water and its reaches keep bridges clear',()=>{
  const model=boat(),hull=new Box3().setFromObject(model),{x,z}=hull.getSize(new Vector3());
  assert.ok(Math.hypot(x/2,z/2)<PROTOTYPE_RADIUS);
  assert.ok(hull.min.y+PROTOTYPE_HULL.originAboveWater+.035<0);
  const city=new City(),bridge=city.place('bridge',0,0),obstacles=[footprintBounds(bridge)];
  assert.ok(waterOverlaps(footprintOutline(bridge),obstacles[0],city.terrain));
  const reaches=sailingReaches(city.worldBounds(),obstacles);
  assert.equal(reaches.length,2);
  for(const [from,to] of reaches){
    assert.ok(to+PROTOTYPE_RADIUS<=obstacles[0].minZ||from-PROTOTYPE_RADIUS>=obstacles[0].maxZ);
    for(let z=from;z<to;z+=1.3){
      const [west,east]=navigableSpan(z,city.terrain,PROTOTYPE_RADIUS);
      for(const {a,b} of riverSections(z-PROTOTYPE_RADIUS,z+PROTOTYPE_RADIUS,city.terrain)){
        assert.ok(west-PROTOTYPE_RADIUS>=Math.max(a[0],b[0])-1e-8);
        assert.ok(east+PROTOTYPE_RADIUS<=Math.min(a[1],b[1])+1e-8);
      }
      assert.equal(terrainSurfaceAt((west+east)/2,z,city.terrain).waterY,WATER_Y);
    }
  }
  model.traverse(o=>o.geometry?.dispose());
});
