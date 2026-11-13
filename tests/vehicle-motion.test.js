import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { City } from '../src/core.js';
import { createScene } from '../src/baseline.js';
import { roadCarriageway } from '../src/road-network.js';
import { VEHICLE_ENVELOPES, vehiclePathFits } from '../src/road-junction.js';
import { SIMULATION_STEP } from '../src/simulation-clock.js';
import { MIN_VEHICLE_GAP, STOP_DURATION, STOP_LINE_GAP, stepVehicles } from '../src/vehicle-motion.js';
import { sampleLane } from '../src/vehicle-routes.js';
import { World } from '../src/world.js';

const dt=SIMULATION_STEP;
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('a car brakes for a bus across tile seams, queues, and resumes after the stop line clears',()=>{
  const city=new City(createScene('T03').city),{laneGraph:graph}=city.roadNetwork;
  const route=[];
  let edge=[...graph.edges.values()].find(edge=>edge.kind==='entry'&&edge.vehicles.includes('bus'));
  while(edge){
    route.push(edge);
    edge=graph.nodes.get(edge.to).outgoing.map(id=>graph.edges.get(id)).find(next=>next.vehicles.includes('bus'));
  }
  const junction=route.findIndex(edge=>edge.stopLine!==undefined);
  assert.ok(junction>=4);
  const make=(id,type,index,speed)=>{
    const start=2,end=route.at(-1).length;
    const path=route.slice(index);
    return {id,type,envelope:VEHICLE_ENVELOPES[type],trip:{route:path,start,end,
      length:path.slice(0,-1).reduce((sum,edge)=>sum+edge.length,0)+end-start},edgeIndex:0,distance:start,speed,travelled:0};
  };
  const bus=make(1,'bus',junction-2,2.6),car=make(2,'car',junction-4,3.2);
  const x=actor=>sampleLane(actor.trip.route[actor.edgeIndex],actor.distance).point[0];
  const sign=Math.sign(x(bus)-x(car));
  const bumpers=(bus.envelope.length+car.envelope.length)/2;
  const queue=()=>{
    for(let i=0;i<12/dt;i++){
      const before=car.speed;
      stepVehicles([car,bus],dt,()=>false);
      assert.ok((x(bus)-x(car))*sign-bumpers>=MIN_VEHICLE_GAP-1e-7);
      assert.ok(car.speed-before<=1.6*dt+1e-7);
      assert.ok(before-car.speed<=2.8*dt+1e-7,JSON.stringify({frame:i,before,speed:car.speed,following:car.following,bus:x(bus),car:x(car),waiting:bus.waitingAt}));
    }
  };
  queue();
  const entry=route[junction];
  close((entry.points[0][0]-x(bus))*sign+entry.stopLine-bus.envelope.length/2,STOP_LINE_GAP);
  assert.equal(bus.waitingAt,entry.roadId);
  assert.equal(bus.speed,0);
  assert.ok(bus.stopWait>=STOP_DURATION);
  assert.ok(car.speed<.01&&car.following.id===bus.id);
  const position=x(bus);
  for(let i=0;i<2/dt;i++)stepVehicles([bus,car],dt,()=>true);
  assert.ok((x(bus)-position)*sign>1&&car.speed>.5);
});

test('T02 curve traversal respects each admitted vehicle envelope on the rendered carriageway',()=>{
  const scene=createScene('T02'),city=new City(scene.city),world=new World(new Scene(),city,scene.seed);
  const {segments,laneGraph}=city.roadNetwork;
  let tested=0,rejected=0;
  for(const edge of laneGraph.edges.values()){
    const segment=segments.get(edge.roadId);
    if(!segment.corner)continue;
    if(!edge.vehicles.length){rejected++;continue;}
    const surfaces=[segment,...segment.ports.map(port=>segments.get(port.neighborId))].flatMap(roadCarriageway);
    for(const type of edge.vehicles){
      const samples=Array.from({length:101},(_,i)=>{
        const {point:[x,,z],yaw}=sampleLane(edge,edge.length*i/100);
        return {point:[x,z],direction:[Math.sin(yaw),Math.cos(yaw)]};
      });
      assert.ok(vehiclePathFits(samples,VEHICLE_ENVELOPES[type],surfaces),edge.id);
      tested++;
    }
  }
  assert.ok(tested>0&&rejected>0);
  let slowTurn=false;
  for(let frame=0;frame<30/dt;frame++){
    world.step(dt,frame*dt);
    for(const car of world.traffic.cars){
      const edge=car.trip.route[car.edgeIndex];
      assert.ok(edge.vehicles.includes(car.type));
      if(car.speed>.1&&['left','right'].includes(edge.kind)&&car.speed<2)slowTurn=true;
    }
  }
  assert.ok(slowTurn);
});
