import { PROTOTYPE_RADIUS, navigableSpan, riverSections } from './river.js';
import { REQUIRED_UNDERSIDE } from './bridges.js';

const LIMIT=105, SAFETY=.05, MIN_ROUTE=1, TURN_SPEED=1.5;
export const BOAT_SPEED=3, BOAT_BRAKE=1.25;
const clamp=(x,min,max)=>Math.max(min,Math.min(x,max));

export function navigationTrack(bounds,terrain){
  const from=Math.ceil(Math.max(-LIMIT,bounds.minZ+PROTOTYPE_RADIUS));
  const to=Math.floor(Math.min(LIMIT,bounds.maxZ-PROTOTYPE_RADIUS));
  const points=[],segments=[];
  let length=0;
  for(let z=from;z<=to;z++){
    const span=navigableSpan(z,terrain,PROTOTYPE_RADIUS);
    const x=span?(span[0]+span[1])/2:0;
    const a=points.at(-1),step=a?Math.hypot(x-a.x,1):0,b={x,z,distance:length+step};
    if(a){
      const r=PROTOTYPE_RADIUS;
      let west=bounds.minX+r,east=bounds.maxX-r;
      for(const section of riverSections(a.z-r,b.z+r,terrain)){
        west=Math.max(west,section.a[0]+r,section.b[0]+r);
        east=Math.min(east,section.a[1]-r,section.b[1]-r);
      }
      segments.push({a,b,step,safe:!!span&&Math.min(a.x,x)>=west&&Math.max(a.x,x)<=east});
    }
    points.push(b);length+=step;
  }
  const r=PROTOTYPE_RADIUS+SAFETY;
  const area={minX:Math.min(...points.map(p=>p.x))-r,maxX:Math.max(...points.map(p=>p.x))+r,minZ:from-r,maxZ:to+r};
  return {points,segments,length,area};
}

export function pointOnTrack(track,distance){
  const {points,segments}=track;
  let lo=0,hi=segments.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(points[mid+1].distance<distance)lo=mid+1;else hi=mid;}
  const {a,b,step}=segments[lo],t=clamp((distance-a.distance)/step,0,1);
  return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
}

function distanceAtZ(track,z){
  const start=track.points[0].z,segment=track.segments[clamp(Math.floor(z-start),0,track.segments.length-1)];
  return segment.a.distance+clamp(z-segment.a.z,0,1)*segment.step;
}

export function bridgeObstacles(crossings){
  return crossings.flatMap(({bounds,bottomY,piers})=>[
    ...(bottomY<REQUIRED_UNDERSIDE?[bounds]:[]),
    ...piers.map(({x,z,width})=>({minX:x-width/2,maxX:x+width/2,minZ:z-width/2,maxZ:z+width/2})),
  ]);
}

export function navigationRoutes(track,obstacles){
  const r=PROTOTYPE_RADIUS+SAFETY,blocked=[];
  for(const {a,b,step,safe} of track.segments){
    if(!safe){blocked.push([a.distance,b.distance]);continue;}
    for(const box of obstacles){
      let from=Math.max(0,box.minZ-r-a.z),to=Math.min(1,box.maxZ+r-a.z);
      if(from>to||Math.max(a.x,b.x)<box.minX-r||Math.min(a.x,b.x)>box.maxX+r)continue;
      const dx=b.x-a.x;
      if(dx){
        const t=(box.minX-r-a.x)/dx,u=(box.maxX+r-a.x)/dx;
        from=Math.max(from,Math.min(t,u));to=Math.min(to,Math.max(t,u));
      }
      if(from<=to)blocked.push([a.distance+from*step,b.distance+to*step]);
    }
  }
  const routes=[];
  let start=0;
  for(const [from,to] of blocked.sort((a,b)=>a[0]-b[0])){
    if(from-start>=MIN_ROUTE)routes.push({from:start,to:from,blockedStart:start>0,blockedEnd:true});
    start=Math.max(start,to);
  }
  if(track.length-start>=MIN_ROUTE)routes.push({from:start,to:track.length,blockedStart:start>0,blockedEnd:false});
  return routes;
}

export function routeAt(routes,distance){return routes.find(({from,to})=>from<=distance&&distance<=to);}
const endpoint=(route,direction)=>direction>0?route.to:route.from;
const remaining=(vessel,route)=>Math.abs(endpoint(route,vessel.direction)-vessel.distance);
const heading=(track,distance,direction)=>{
  const a=pointOnTrack(track,Math.max(0,distance-.4)),b=pointOnTrack(track,Math.min(track.length,distance+.4));
  return Math.atan2(direction*(b.x-a.x),direction*(b.z-a.z));
};

export function launchVessel(track,routes){
  const route=routes.reduce((best,item)=>!best||item.to-item.from>best.to-best.from?item:best,null);
  if(!route)return null;
  const distance=clamp(distanceAtZ(track,-12),route.from+.5,route.to-.5),direction=distance<route.to-1?1:-1;
  return {distance,direction,yaw:heading(track,distance,direction),speed:0,state:'sailing',wait:0};
}

export function canKeepSailing(vessel,routes,previous){
  const route=routeAt(routes,vessel.distance);
  return !!route&&(previous&&remaining(vessel,route)>=remaining(vessel,previous)||remaining(vessel,route)+1e-6>=vessel.speed**2/(2*BOAT_BRAKE));
}

export function advanceVessel(vessel,track,route,dt){
  if(!route){vessel.speed=0;vessel.state='waiting';return;}
  const {distance,direction}=vessel,left=remaining(vessel,route);
  if(vessel.state==='waiting'){
    if(left>.05){vessel.state='sailing';return;}
    vessel.wait-=dt;
    if(vessel.wait<=0){vessel.direction=-direction;vessel.state='turning';}
    return;
  }
  const target=heading(track,distance,direction),delta=Math.atan2(Math.sin(target-vessel.yaw),Math.cos(target-vessel.yaw));
  vessel.yaw+=clamp(delta,-TURN_SPEED*dt,TURN_SPEED*dt);
  if(vessel.state==='turning'&&Math.abs(delta)>TURN_SPEED*dt)return;
  vessel.state='sailing';
  const speed=Math.min(BOAT_SPEED,vessel.speed+dt,Math.sqrt(2*BOAT_BRAKE*left));
  const step=Math.min(left,speed*dt);
  vessel.distance+=direction*step;vessel.speed=speed;
  if(left<=step+1e-8){
    vessel.distance=endpoint(route,direction);vessel.speed=0;vessel.state='waiting';
    vessel.wait=(direction>0?route.blockedEnd:route.blockedStart)?3:1;
  }
}
