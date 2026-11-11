import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Raycaster, Scene, Vector3 } from 'three';
import { City, footprintBounds } from '../src/core.js';
import { createScene } from '../src/baseline.js';
import { bridgeRise, REQUIRED_UNDERSIDE } from '../src/bridges.js';
import { riverWaterGeometry } from '../src/environment.js';
import { boat } from '../src/models.js';
import { footprintOutline } from '../src/parcel.js';
import { WATER_Y, PROTOTYPE_HULL, PROTOTYPE_RADIUS, navigableSpan, riverBanks, riverSections, sailingCenter, sailingReaches, terrainSurfaceAt, waterAt, waterOverlaps } from '../src/river.js';
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

test('T04 bridge meshes, lanes and footways share their grade and leave room for the rotated hull',()=>{
  const city=new City(createScene('T04').city),{segments,bridges,laneGraph}=city.roadNetwork;
  const [bridge]=bridges.crossings;
  assert.equal(bridge.passable,true);assert.equal(bridge.approachIds.length,6);assert.equal(bridge.piers.length,2);
  const world=new World(new Scene(),city),ray=new Raycaster();
  world.scene.updateMatrixWorld(true);
  const roadMeshes=world.pickables.filter(object=>object.children.some(mesh=>bridges.grades.has(mesh.userData.entityId)));
  const hitY=(x,y,z,dy)=>{
    ray.set(new Vector3(x,y,z),new Vector3(0,dy,0));
    return ray.intersectObjects(roadMeshes,true)[0]?.point.y;
  };
  const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
  close(hitY(0,WATER_Y,0,1),bridge.bottomY);
  assert.ok(bridge.bottomY>=REQUIRED_UNDERSIDE);
  for(const pier of bridge.piers){
    assert.ok(pier.x>bridge.channel.maxX||pier.x<bridge.channel.minX);
    const facing=pier.x<0?1:-1;
    ray.set(new Vector3(0,WATER_Y,pier.z),new Vector3(-facing,0,0));
    close(ray.intersectObjects(roadMeshes,true)[0]?.point.x,pier.x+facing*pier.width/2);
  }
  const boatModel=boat(),box=new Box3().setFromObject(boatModel,true);
  close(box.max.y,PROTOTYPE_HULL.top);
  for(let z=bridge.bounds.minZ-PROTOTYPE_RADIUS;z<=bridge.bounds.maxZ+PROTOTYPE_RADIUS;z+=.125){
    const x=sailingCenter(z,city.terrain,PROTOTYPE_RADIUS);
    const heading=Math.atan2(sailingCenter(z+1,city.terrain,PROTOTYPE_RADIUS)-x,1);
    for(const yaw of [heading,heading+Math.PI,heading+Math.PI/2])for(const bob of [-PROTOTYPE_HULL.bob,PROTOTYPE_HULL.bob]){
      boatModel.position.set(x,WATER_Y+PROTOTYPE_HULL.originAboveWater+bob,z);boatModel.rotation.y=yaw;
      box.setFromObject(boatModel,true);
      assert.ok(box.max.y+.25<=bridge.bottomY&&box.min.y<WATER_Y);
      assert.ok(box.min.x>=bridge.channel.minX&&box.max.x<=bridge.channel.maxX);
    }
  }
  for(const id of [...bridge.deckIds,...bridge.approachIds]){
    const road=segments.get(id);
    for(const [x,y,z] of road.lanePaths.flatMap(p=>p.points))close(hitY(x,5,z,-1),y);
    for(const [x,y,z] of road.walkways.flatMap(p=>p.points))close(hitY(x,5,z,-1),y);
    for(const port of road.ports){
      const seam=segments.get(port.neighborId).ports.find(p=>p.neighborId===id);
      assert.deepEqual(port.point,seam.point);assert.equal(port.vehicleY,seam.vehicleY);assert.equal(port.walkY,seam.walkY);
    }
  }
  const sidewalk=world.traffic.people.network.components.find(nodes=>nodes.some(n=>n.kind==='sidewalk'&&n.x<-30&&n.z===1.82));
  assert.ok(sidewalk?.some(n=>n.kind==='sidewalk'&&n.x>30&&n.z===1.82));
  for(const edge of laneGraph.edges.values())if(bridges.grades.has(edge.roadId)){
    for(let i=1;i<edge.points.length;i++){
      const [a,b]=edge.points.slice(i-1,i+1);
      assert.ok(Math.abs(b[1]-a[1])<=.120001*Math.hypot(b[0]-a[0],b[2]-a[2]));
    }
  }
  const [car]=world.traffic.cars,from=segments.get(bridge.approachIds[1]);
  const fromId=from.ports.find(p=>p.side===1).neighborId;
  Object.assign(car,{from,last:fromId,to:segments.get(from.ports.find(p=>p.side===0).neighborId),t:0});
  const route=sidewalk.filter(n=>n.kind==='sidewalk'&&n.x>=-28&&n.x<=0&&n.z===1.82).sort((a,b)=>a.x-b.x);
  for(let i=1;i<route.length;i++)assert.ok(route[i-1].edges.has(route[i].id));
  const [walker]=world.traffic.people.walkers;
  Object.assign(walker,{route,index:0,t:0,wait:0,speed:1.4});
  const focus=new Vector3(),initial=from.profile.vehicleY;
  let previous=null,previousWalk=null;
  for(let step=0;step<650;step++){
    world.traffic.update(1/60,step/60,focus,false);
    const {x,y}=car.mesh.position;
    close(y,initial+bridgeRise(bridge.bounds,x));
    if(previous!==null)assert.ok(Math.abs(previous-y)<.01);
    previous=y;
    close(walker.y,from.profile.walkY+bridgeRise(bridge.bounds,walker.x));
    if(previousWalk!==null)assert.ok(Math.abs(previousWalk-walker.y)<.005);
    previousWalk=walker.y;
  }
  assert.ok(car.mesh.position.y>1.5);
  assert.ok(walker.y>1.55);
  boatModel.traverse(o=>o.geometry?.dispose());world.clear();
});

test('shortening an approach closes the bridge envelope and undo and reload rebuild it',()=>{
  const city=new City(createScene('T04').city),before=city.snapshot();
  const [bridge]=city.roadNetwork.bridges.crossings;
  assert.ok(city.remove(bridge.approachIds[2]));
  const [closed]=city.roadNetwork.bridges.crossings;
  assert.equal(closed.reason,'approach');assert.equal(closed.passable,false);
  assert.ok(closed.bottomY<REQUIRED_UNDERSIDE);assert.equal(city.roadNetwork.bridges.grades.size,0);
  assert.ok(city.undo());
  assert.deepEqual(city.snapshot().entities.sort((a,b)=>a.id-b.id),before.entities);
  assert.deepEqual(new City(city.snapshot()).roadNetwork.bridges.crossings,[bridge]);
  assert.ok(city.redo());assert.equal(city.roadNetwork.bridges.crossings[0].passable,false);
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
