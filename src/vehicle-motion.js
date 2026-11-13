import { VEHICLE_ENVELOPES } from './road-junction.js';
import { advanceVehicle, VEHICLE_SPEEDS } from './vehicle-routes.js';
import { SIMULATION_STEP } from './simulation-clock.js';

const ACCELERATION=1.6;
const BRAKING=2.8;
const HEADWAY=.5;
export const MIN_VEHICLE_GAP=.45;
export const STOP_LINE_GAP=.1;
export const STOP_DURATION=1;
const EPSILON=1e-7;
const curveLimits=new WeakMap();
const sharesApproach=edge=>edge.stopLine!==undefined||edge.kind==='stop';

function curveLimit(edge){
  if(curveLimits.has(edge))return curveLimits.get(edge);
  let limit=Infinity;
  for(let i=1;i<(edge.directions?.length??0);i++){
    const [x,z]=edge.directions[i-1],[u,v]=edge.directions[i];
    const angle=Math.abs(Math.atan2(x*v-z*u,x*u+z*v));
    if(angle<EPSILON)continue;
    const radius=Math.hypot(edge.points[i][0]-edge.points[i-1][0],edge.points[i][2]-edge.points[i-1][2])/angle;
    limit=Math.min(limit,Math.sqrt(1.35*radius));
  }
  curveLimits.set(edge,limit);
  return limit;
}

function speedBefore(speed,distance,dt){
  // Leave room for the fixed-step response while following a moving queue.
  const delay=BRAKING*dt*2;
  return Math.sqrt((speed+delay)**2+2*BRAKING*Math.max(0,distance))-delay;
}

export function canSpawnVehicle(cars,trip,type){
  const first=trip.route[0],half=VEHICLE_ENVELOPES[type].length/2;
  for(const car of cars){
    let offset=-car.distance;
    const required=half+car.envelope.length/2+MIN_VEHICLE_GAP+car.speed**2/(2*BRAKING)+car.speed*SIMULATION_STEP;
    for(let i=car.edgeIndex;i<car.trip.route.length&&offset<required;i++){
      const edge=car.trip.route[i];
      if(edge===first&&offset+trip.start>=0&&offset+trip.start<required)return false;
      offset+=edge.length;
    }
  }
  return true;
}

export function stepVehicles(cars,dt,canProceed=()=>true){
  const occupied=new Map(),departing=new Map(),plans=[];
  for(const car of cars){
    const edge=car.trip.route[car.edgeIndex];
    const lane=occupied.get(edge.id)??[];
    lane.push(car);occupied.set(edge.id,lane);
    if(sharesApproach(edge)&&car.distance<=Math.max(edge.stopLine??0,car.envelope.length/2)+EPSILON){
      const approach=departing.get(edge.from)??[];
      approach.push(car);departing.set(edge.from,approach);
    }
  }

  for(const car of cars){
    const {route}=car.trip,cruise=VEHICLE_SPEEDS[car.type],half=car.envelope.length/2;
    const horizon=cruise**2/(2*BRAKING)+cruise*(HEADWAY+dt)+half+VEHICLE_ENVELOPES.bus.length/2+MIN_VEHICLE_GAP;
    const remaining=Math.max(0,car.trip.length-car.travelled);
    let limit=Math.min(cruise,speedBefore(0,remaining,dt)),stop=null,leader=null,room=remaining;
    let offset=-car.distance;
    for(let i=car.edgeIndex;i<route.length&&offset<=horizon;i++){
      const edge=route[i];
      limit=Math.min(limit,speedBefore(curveLimit(edge),offset-half,dt));
      if(edge.stopLine!==undefined&&car.clearedStop!==i){
        const distance=offset+edge.stopLine-half-STOP_LINE_GAP;
        // Vehicles already past the line keep clearing the movement.
        if(distance>=-EPSILON){
          stop??={index:i,distance:Math.max(0,distance),edge};
          limit=Math.min(limit,speedBefore(0,stop.distance,dt));
          room=Math.min(room,stop.distance);
        }
      }
      const lanes=[occupied.get(edge.id)??[],departing.get(edge.from)??[]];
      for(const lane of lanes)for(const other of lane){
        if(other===car)continue;
        const distance=offset+other.distance;
        if(distance<=0)continue;
        const gap=distance-half-other.envelope.length/2;
        if(!leader||gap<leader.gap)leader={car:other,gap};
      }
      offset+=edge.length;
    }
    if(leader){
      const gap=leader.gap-MIN_VEHICLE_GAP;
      const followingSpeed=speedBefore(0,gap,dt);
      const desiredSpeed=Math.max(0,gap)/HEADWAY;
      limit=Math.min(limit,followingSpeed,desiredSpeed);
      room=Math.min(room,Math.max(0,gap));
    }
    const speed=Math.max(car.speed-BRAKING*dt,Math.min(limit,car.speed+ACCELERATION*dt));
    let metres=Math.min(room,(car.speed+speed)*dt/2);
    // Finish the last fraction of a terminal or stop-line approach at rest.
    if(!leader&&room<.001&&limit<.035)metres=room;
    plans.push({car,metres,speed:metres===room?0:speed,stop,leader});
  }

  const arrived=[];
  for(const {car,metres,speed,stop,leader} of plans){
    car.speed=speed;
    car.travelled+=metres;
    const reached=advanceVehicle(car,metres);
    if(reached||car.trip.length-car.travelled<=EPSILON){arrived.push(car);continue;}
    car.following=leader?{id:leader.car.id,gap:leader.gap}:null;
    car.waitingAt=null;
    if(stop&&stop.distance-metres<=EPSILON&&speed===0){
      car.waitingAt=stop.edge.roadId;
      car.stopWait=(car.stopWait??0)+dt;
      if(car.stopWait+EPSILON>=STOP_DURATION&&canProceed(car,stop.edge)){
        car.clearedStop=stop.index;
        car.stopWait=0;
      }
    }else car.stopWait=0;
  }
  return arrived;
}
