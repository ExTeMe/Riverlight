import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Raycaster, Scene, Vector3 } from 'three';
import { City, gridLine } from '../src/core.js';
import { createScene } from '../src/baseline.js';
import { bridgeRise, REQUIRED_UNDERSIDE } from '../src/bridges.js';
import { riverWaterGeometry } from '../src/environment.js';
import { boat } from '../src/models.js';
import { WATER_Y, PROTOTYPE_HULL, PROTOTYPE_RADIUS, riverBanks, sailingCenter, waterAt } from '../src/river.js';
import { BOAT_SPEED, navigationTrack, pointOnTrack } from '../src/navigation.js';
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
  const car=world.traffic.cars.find(car=>bridge.deckIds.every(id=>car.trip.route.some(edge=>edge.roadId===id)));
  assert.ok(car);
  const from=segments.get(bridge.approachIds[1]);
  const route=sidewalk.filter(n=>n.kind==='sidewalk'&&n.x>=-28&&n.x<=0&&n.z===1.82).sort((a,b)=>a.x-b.x);
  for(let i=1;i<route.length;i++)assert.ok(route[i-1].edges.has(route[i].id));
  const [walker]=world.traffic.people.walkers;
  Object.assign(walker,{route,index:0,t:0,wait:0,speed:1.4});
  const initial=from.profile.vehicleY;
  let previous=null,previousWalk=null,peak=0;
  for(let step=0;step<480;step++){
    world.traffic.step(1/30,step/30);
    const {x,y}=car.mesh.position;
    close(y,initial+bridgeRise(bridge.bounds,x));
    if(previous!==null)assert.ok(Math.abs(previous-y)<.013);
    previous=y;
    peak=Math.max(peak,y);
    close(walker.y,from.profile.walkY+bridgeRise(bridge.bounds,walker.x));
    if(previousWalk!==null)assert.ok(Math.abs(previousWalk-walker.y)<.006);
    previousWalk=walker.y;
  }
  assert.ok(peak>1.5);
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
  world.clear();world.horizon.geometry.dispose();world.quay.geometry.dispose();
});

test('the reference route leaves the largest hull room to turn in both river layouts',()=>{
  for(const terrain of ['legacy','meander']){
    const track=navigationTrack(new City().worldBounds(),terrain);
    assert.equal(track.segments.length,210);
    assert.ok(track.segments.every(segment=>segment.safe));
  }
});

test('the largest vessel clears two bridges, waits short of a low bridge, and turns without jumping',()=>{
  const city=new City(createScene('T04').city);
  assert.ok(city.paint('bridge',gridLine([-7,2],[9,2])));
  const world=new World(new Scene(),city),traffic=world.traffic;
  const [vessel]=traffic.boats,mesh=vessel.mesh,box=new Box3();
  const blocker=city.place('bridge',Math.round(sailingCenter(28,city.terrain,PROTOTYPE_RADIUS)/4),7);
  assert.ok(blocker);world.sync(true);
  const open=city.roadNetwork.bridges.crossings.filter(bridge=>bridge.passable);
  assert.equal(open.length,2);assert.equal(traffic.routes.length,2);
  const crossed=new Set();let wait=0,turned=false,testedEdit=false;
  const dt=.05;
  for(let i=0;i<1000;i++){
    const before=mesh.position.clone(),yaw=mesh.rotation.y;
    traffic.step(dt,i*dt);
    const {x,y,z}=mesh.position;
    assert.ok(Math.hypot(x-before.x,z-before.z)<=BOAT_SPEED*dt+1e-6);
    assert.ok(Math.abs(mesh.rotation.y-yaw)<=1.5*dt+1e-6);
    assert.ok(z<=26-PROTOTYPE_RADIUS);
    for(const bridge of open)if(z+PROTOTYPE_RADIUS>=bridge.bounds.minZ&&z-PROTOTYPE_RADIUS<=bridge.bounds.maxZ){
      crossed.add(bridge);
      for(const bob of [-PROTOTYPE_HULL.bob,PROTOTYPE_HULL.bob]){
        mesh.position.y=WATER_Y+PROTOTYPE_HULL.originAboveWater+bob;
        box.setFromObject(mesh,true);
        assert.ok(box.max.y+.25<=bridge.bottomY&&box.min.y<WATER_Y);
        for(const pier of bridge.piers)assert.ok(box.max.x+.5<pier.x-pier.width/2||box.min.x-.5>pier.x+pier.width/2);
      }
      mesh.position.y=y;
    }
    if(!testedEdit&&Math.abs(z)<.2){
      const approach=open[0].approachIds[0],history=city.undoStack.length;
      assert.equal(city.remove(approach),false);
      assert.match(city.editError,/船只正在经过/);
      assert.equal(city.undoStack.length,history);assert.ok(city.entities.has(approach));
      testedEdit=true;
    }
    if(vessel.state==='waiting'){
      assert.equal(vessel.speed,0);wait+=dt;
    }
    if(vessel.state==='turning'){
      assert.ok(Math.hypot(x-before.x,z-before.z)<1e-8);turned=true;
    }
    if(turned&&vessel.direction===-1&&vessel.speed>0)break;
  }
  assert.equal(crossed.size,2);assert.ok(testedEdit&&turned&&wait>=2.95);
  const before=mesh.position.clone(),distance=vessel.distance;
  assert.ok(city.remove(blocker.id));world.sync(true);
  assert.equal(traffic.boats[0],vessel);assert.equal(vessel.distance,distance);assert.deepEqual(mesh.position,before);
  assert.equal(traffic.routes.length,1);
  assert.ok(city.undo());world.sync(true);assert.equal(vessel.distance,distance);
  assert.equal(traffic.routes.length,2);
  assert.ok(Math.abs(pointOnTrack(traffic.track,distance).z-before.z)<1e-8);
  world.clear();
});
