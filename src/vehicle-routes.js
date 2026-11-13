import { VEHICLE_ENVELOPES } from './road-junction.js';

export const VEHICLE_SPEEDS = Object.freeze({car:3.2,bus:2.6});

const allows = (edge,type) => edge.vehicles.includes(type);
const separation = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

function walkLanes(graph,start,type,visit){
  const queue=[start],seen=new Set(queue);
  for(let i=0;i<queue.length;i++){
    for(const id of graph.nodes.get(queue[i]).outgoing){
      const edge=graph.edges.get(id);
      if(!allows(edge,type))continue;
      visit(edge);
      if(seen.has(edge.to))continue;
      seen.add(edge.to);queue.push(edge.to);
    }
  }
}

const canUseInterior = (edge,type) => edge.kind==='lane'&&edge.length>=VEHICLE_ENVELOPES[type].length;

export function vehicleOrigins(graph,type){
  const origins=[];
  for(const edge of graph.edges.values()){
    if(!allows(edge,type))continue;
    if(edge.kind==='entry'||canUseInterior(edge,type)&&(!edge.entry||!edge.exit||edge.length>VEHICLE_ENVELOPES[type].length))origins.push(edge);
  }
  return origins;
}

class LaneFrontier {
  items=[];
  push(item){
    const items=this.items;
    let i=items.length;
    while(i>0){
      const parent=(i-1)>>1;
      if(items[parent].estimate<=item.estimate)break;
      items[i]=items[parent];i=parent;
    }
    items[i]=item;
  }
  pop(){
    const items=this.items,first=items[0],last=items.pop();
    if(!items.length)return first;
    let i=0;
    while(i*2+1<items.length){
      let child=i*2+1;
      if(child+1<items.length&&items[child+1].estimate<items[child].estimate)child++;
      if(items[child].estimate>=last.estimate)break;
      items[i]=items[child];i=child;
    }
    items[i]=last;
    return first;
  }
}

export function shortestLaneRoute(graph,from,to,type){
  const target=graph.nodes.get(to)?.point,start=graph.nodes.get(from);
  if(!target||!start)return null;
  const frontier=new LaneFrontier(),costs=new Map([[from,0]]),parents=new Map();
  frontier.push({id:from,cost:0,estimate:separation(start.point,target)});
  for(let next=frontier.pop();next;next=frontier.pop()){
    if(next.cost!==costs.get(next.id))continue;
    if(next.id===to){
      const route=[];
      for(let node=to;node!==from;){
        const edge=parents.get(node);
        route.push(edge);node=edge.from;
      }
      return route.reverse();
    }
    for(const id of graph.nodes.get(next.id).outgoing){
      const edge=graph.edges.get(id),cost=next.cost+edge.length;
      if(!allows(edge,type)||cost>=(costs.get(edge.to)??Infinity))continue;
      costs.set(edge.to,cost);parents.set(edge.to,edge);
      frontier.push({id:edge.to,cost,estimate:cost+separation(graph.nodes.get(edge.to).point,target)});
    }
  }
  return null;
}

export function planVehicleTrip(graph,entry,type,random){
  const halfLength=VEHICLE_ENVELOPES[type].length/2;
  const start=entry.kind==='entry'?0:entry.entry?halfLength:entry.length/2;
  if(entry.exit){
    const end=entry.length-halfLength;
    return end>start?{route:[entry],start,end,length:end-start}:null;
  }
  const exits=[],interior=[];
  walkLanes(graph,entry.to,type,edge=>{
    if(edge.roadId===entry.roadId)return;
    if(edge.kind==='stop'||edge.exit&&canUseInterior(edge,type))exits.push(edge);
    else if(canUseInterior(edge,type))interior.push(edge);
  });
  const destinations=exits.length?exits:interior;
  if(!destinations.length)return null;
  const exit=destinations[Math.floor(random()*destinations.length)];
  const path=shortestLaneRoute(graph,entry.to,exit.from,type);
  if(!path)return null;
  const route=[entry,...path,exit];
  const end=exit.kind==='stop'?exit.length:exit.exit?exit.length-halfLength:exit.length/2;
  return {route,start,end,length:route.slice(0,-1).reduce((sum,edge)=>sum+edge.length,0)-start+end};
}

export function sampleLane(edge,distance){
  const {points,directions,distance:distances}=edge;
  let low=1,high=distances.length-1;
  while(low<high){
    const mid=(low+high)>>1;
    if(distances[mid]<distance)low=mid+1;
    else high=mid;
  }
  const a=points[low-1],b=points[low],t=(distance-distances[low-1])/(distances[low]-distances[low-1]);
  const delta=b.map((value,i)=>value-a[i]);
  const point=a.map((value,i)=>value+delta[i]*t);
  const [dx,dz]=directions?directions[low-1].map((value,i)=>value+(directions[low][i]-value)*t):[delta[0],delta[2]];
  return {point,yaw:Math.atan2(dx,dz),pitch:-Math.atan2(delta[1],Math.hypot(delta[0],delta[2]))};
}

export function advanceVehicle(car,metres){
  const {route,end}=car.trip,last=route.length-1;
  car.distance+=metres;
  while(car.edgeIndex<last&&car.distance>=route[car.edgeIndex].length){
    car.distance-=route[car.edgeIndex].length;
    car.edgeIndex++;
  }
  if(car.edgeIndex===last&&car.distance>=end){
    car.distance=end;
    return true;
  }
  return false;
}
