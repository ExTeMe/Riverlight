import { CELL } from './catalog.js';
import { ROAD_DIRECTIONS, sidePoint, VEHICLE_ENVELOPES, vehiclePathFits } from './road-junction.js';

const asLine=(points,kind='walk')=>({points,kind});
const length=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
const atHeight=(point,y)=>[point[0],y,point[2]];
const shift=([x,,z],[u,v],y)=>[x+u,y,z+v];
const vehicles=Object.keys(VEHICLE_ENVELOPES);

function portPoint(port,offset,height){
  return shift(port.point,sidePoint(port.side,0,offset),port[height]);
}

export function buildRoadPaths(segment,cornerPoint,cornerHeight){
  const {center,profile,ports,geometry,corner,surface,junction}=segment;
  const {vehicleY,walkY}=profile;
  const waypoints=(ports,points,directions)=>({from:ports[0],to:ports[1],points,directions,vehicles});
  if(geometry){
    const lanePaths=segment.lanes.map(({direction,points})=>{
      const start=direction===1?0:1;
      const tangents=geometry.samples.map(sample=>sample.direction.map(n=>n*direction));
      return waypoints([ports.find(p=>p.end===start),ports.find(p=>p.end!==start)],
        direction===1?points:points.slice().reverse(),direction===1?tangents:tangents.reverse());
    });
    return {lanePaths,walkways:segment.sidewalks.map(({points})=>asLine(points))};
  }
  if(!profile.lanes.length)return {lanePaths:[],walkways:ports.map(port=>asLine([atHeight(center,walkY),atHeight(port.point,port.walkY)],'path'))};
  const lane=profile.lanes[1].offset,offset=profile.sidewalks[1].offset;
  if(corner){
    const [sx,sz]=corner;
    const from=ports.find(port=>ROAD_DIRECTIONS[port.side][0]===sx),to=ports.find(port=>ROAD_DIRECTIONS[port.side][1]===sz);
    const arc=(radius,y,field)=>Array.from({length:25},(_,i)=>shift(center,cornerPoint(sx,sz,radius,i*Math.PI/48),
      cornerHeight(y,from[field],to[field],i/24)));
    const tangents=Array.from({length:25},(_,i)=>[-sx*Math.cos(i*Math.PI/48),sz*Math.sin(i*Math.PI/48)]);
    return {lanePaths:[waypoints([from,to],arc(profile.width/2+sx*sz*lane,vehicleY,'vehicleY'),tangents),
      waypoints([to,from],arc(profile.width/2-sx*sz*lane,vehicleY,'vehicleY').reverse(),
        tangents.slice().reverse().map(direction=>direction.map(n=>-n)))],
    walkways:[-1,1].map(sign=>asLine(arc(profile.width/2+sign*offset,walkY,'walkY')))};
  }
  const lanePaths=[];
  if(junction){
    for(const {from,to,samples,vehicles,kind} of junction.movements){
      const incoming=ports.find(p=>p.side===from),outgoing=ports.find(p=>p.side===to);
      const points=samples.map(({point},i)=>shift(center,point,
        i===0?incoming.vehicleY:i===samples.length-1&&outgoing?outgoing.vehicleY:vehicleY));
      const crossing=junction.crossings.find(crossing=>crossing.side===from);
      const stopLine=crossing&&CELL/2-crossing.stopDistance;
      lanePaths.push({from:incoming,to:outgoing,points,directions:samples.map(sample=>sample.direction),vehicles,kind,stopLine});
      if(kind==='stop'){
        // Mirror the checked stopping path across the centreline for departures.
        const direction=ROAD_DIRECTIONS[from],offset=sidePoint(from,0,2*lane);
        const start=shift(points.at(-1),offset,points.at(-1)[1]);
        lanePaths.push({to:incoming,points:[start,portPoint(incoming,lane,'vehicleY')],
          directions:[direction,direction],vehicles,kind:'entry'});
      }
    }
  }else if(ports.length===2&&(ports[0].side>>1)===(ports[1].side>>1)){
    for(const [from,to] of [ports,ports.slice().reverse()])lanePaths.push(waypoints([from,to],[
      portPoint(from,-lane,'vehicleY'),shift(center,sidePoint(to.side,0,lane),vehicleY),portPoint(to,lane,'vehicleY'),
    ]));
  }
  const walkways=[],corners=[[-offset,-offset],[offset,-offset],[offset,offset],[-offset,offset]].map(p=>shift(center,p,walkY));
  for(const [i,side] of [3,0,2,1].entries()){
    const a=corners[i],b=corners[(i+1)%4],port=ports.find(p=>p.side===side);
    if(!port){walkways.push(asLine([a,b]));continue;}
    const crossing=surface?.crossings?.find(item=>item.side===side);
    if(crossing){
      const ends=crossing.ends.map(p=>shift(center,p,walkY));
      if(length(a,ends[0])>length(a,ends[1]))ends.reverse();
      walkways.push(asLine([a,ends[0]]),asLine(ends,'crossing'),asLine([ends[1],b]));
    }
    for(const sign of [-1,1]){
      const end=portPoint(port,sign*offset,'walkY');
      walkways.push(asLine([length(a,end)<length(b,end)?a:b,end]));
    }
  }
  return {lanePaths,walkways};
}

export function buildLaneGraph(segments,revision,carriageway){
  const nodes=new Map(),edges=new Map();
  const node=(id,point)=>{
    if(!nodes.has(id))nodes.set(id,{id,point,outgoing:[]});
    return nodes.get(id);
  };
  for(const segment of segments.values())for(const [i,path] of segment.lanePaths.entries()){
    const {from,to,points,directions,kind,stopLine}=path,id=`${segment.id}:${i}`;
    const start=node(from?`${from.neighborId}>${segment.id}`:`${id}:start`,points[0]);
    const end=node(to?`${segment.id}>${to.neighborId}`:`${id}:end`,points.at(-1));
    const distance=[0];
    for(let j=1;j<points.length;j++)distance.push(distance.at(-1)+length(points[j-1],points[j]));
    let {vehicles}=path;
    if(segment.corner||segment.geometry&&Number.isFinite(segment.geometry.minRadius)){
      const neighbors=segment.ports.map(port=>segments.get(port.neighborId));
      const surfaces=[...carriageway(segment),...neighbors.flatMap(road=>carriageway(road))];
      const samples=points.map(([x,,z],j)=>({point:[x,z],direction:directions[j]}));
      vehicles=vehicles.filter(type=>{
        const half=VEHICLE_ENVELOPES[type].length/2;
        const usable=samples.filter((_,j)=>(from||distance[j]>=half)&&(to||distance.at(-1)-distance[j]>=half));
        return usable.length>0&&vehiclePathFits(usable,VEHICLE_ENVELOPES[type],surfaces);
      });
    }
    edges.set(id,{id,roadId:segment.id,from:start.id,to:end.id,points,directions,distance,length:distance.at(-1),
      vehicles,kind:kind??'lane',entry:!from,exit:!to,stopLine});
    start.outgoing.push(id);
  }
  return {revision,nodes,edges};
}
