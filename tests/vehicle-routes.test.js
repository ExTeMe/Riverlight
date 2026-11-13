import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { createScene } from '../src/baseline.js';
import { City } from '../src/core.js';
import { SimulationClock } from '../src/simulation-clock.js';
import { VEHICLE_ENVELOPES } from '../src/road-junction.js';
import { advanceVehicle, planVehicleTrip, sampleLane, shortestLaneRoute, vehicleOrigins } from '../src/vehicle-routes.js';
import { World } from '../src/world.js';

test('A* chooses the shortest directed route allowed for each vehicle type',()=>{
  const nodes=new Map([
    ['entry',{point:[0,0,0],outgoing:['turn','straight']}],
    ['detour',{point:[2,0,4],outgoing:['return']}],
    ['exit',{point:[4,0,0],outgoing:[]}],
  ]);
  const edges=new Map([
    ['turn',{id:'turn',to:'exit',from:'entry',length:4,vehicles:['car']}],
    ['straight',{id:'straight',to:'detour',from:'entry',length:5,vehicles:['car','bus']}],
    ['return',{id:'return',to:'exit',from:'detour',length:5,vehicles:['car','bus']}],
  ]);
  const graph={nodes,edges};
  assert.deepEqual(shortestLaneRoute(graph,'entry','exit','car').map(edge=>edge.id),['turn']);
  assert.deepEqual(shortestLaneRoute(graph,'entry','exit','bus').map(edge=>edge.id),['straight','return']);
  assert.equal(shortestLaneRoute(graph,'exit','entry','car'),null);
});

test('terminal entries and exits stay inside the road and isolated alignments inset by half a vehicle',()=>{
  const city=new City();
  assert.ok(city.paint('road',[[-22,0],[-21,0],[-20,0]]));
  assert.ok(city.editRoadAlignment({start:[-88,0,20,0],end:[-68,0,20,0]}).changed);
  const graph=city.roadNetwork.laneGraph;
  for(const type of ['car','bus']){
    const origins=vehicleOrigins(graph,type);
    const terminal=origins.find(edge=>edge.kind==='entry');
    const trip=planVehicleTrip(graph,terminal,type,()=>0);
    assert.deepEqual(trip.route.map(edge=>edge.kind),['entry','lane','stop']);
    assert.equal(trip.start,0);
    assert.equal(trip.end,trip.route.at(-1).length);
    for(const edge of origins.filter(edge=>edge.entry&&edge.exit)){
      const open=planVehicleTrip(graph,edge,type,()=>0);
      const halfLength=VEHICLE_ENVELOPES[type].length/2;
      assert.deepEqual(open.route,[edge]);
      assert.equal(open.start,halfLength);
      assert.equal(open.end,edge.length-halfLength);
    }
  }
});

test('fixed steps cross grid and curve seams by distance and retire only at the destination',()=>{
  const scene=createScene('T02'),city=new City(scene.city),network=city.roadNetwork;
  const graph=network.laneGraph,tee=network.segments.get(city.at(-27,-14).id);
  const arm=tee.ports.find(port=>port.side===3).neighborId;
  const type='bus';
  const entry=vehicleOrigins(graph,type).find(edge=>edge.roadId===arm&&edge.to===`${arm}>${tee.id}`);
  const trip=planVehicleTrip(graph,entry,type,()=>0);
  assert.ok(trip.route.some(edge=>edge.roadId===tee.id));
  assert.ok(trip.route.every(edge=>edge.vehicles.includes(type)));
  for(let i=1;i<trip.route.length;i++){
    const previous=trip.route[i-1],next=trip.route[i];
    assert.equal(previous.to,next.from);
    const a=sampleLane(previous,previous.length),b=sampleLane(next,0);
    assert.ok(Math.hypot(...a.point.map((value,k)=>value-b.point[k]))<1e-8);
    assert.ok(Math.abs(Math.sin((a.yaw-b.yaw)/2))<1e-8);
  }
  const run=fps=>{
    const clock=new SimulationClock(),car={trip,distance:trip.start,edgeIndex:0};
    for(let frame=0;frame<fps*2;frame++)clock.advance(1/fps,dt=>assert.equal(advanceVehicle(car,2.6*dt),false));
    return car;
  };
  const car=run(30);
  assert.deepEqual(run(15),car);
  assert.deepEqual(run(144),car);
  assert.equal(advanceVehicle(car,trip.length),true);
  assert.equal(car.edgeIndex,trip.route.length-1);
  assert.equal(car.distance,trip.end);
});

test('city traffic removes a completed vehicle and launches a new trip on the fixed clock',()=>{
  const scene=createScene('T03'),world=new World(new Scene(),new City(scene.city),scene.seed);
  const traffic=world.traffic,clock=new SimulationClock(),initial=[...traffic.cars];
  for(let frame=0;frame<60*12;frame++)clock.advance(1/60,(dt,time)=>world.step(dt,time));
  assert.equal(traffic.vehicleStatus.arrived,0);
  for(let frame=0;frame<60*40;frame++)clock.advance(1/60,(dt,time)=>world.step(dt,time));
  assert.ok(traffic.vehicleStatus.arrived>=initial.length);
  assert.ok(initial.every(car=>!car.mesh.parent));
  assert.ok(traffic.cars.some(car=>car.id>initial.length&&car.mesh.parent));
});
