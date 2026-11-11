import { CELL } from './catalog.js';
import { alignmentGeometry, matchingRoadEnds, offsetRoadSample } from './road-alignment.js';
import { ROAD_DIRECTIONS, arcSurface, buildJunction, junctionLayout } from './road-junction.js';
import { buildLaneGraph, buildRoadPaths } from './road-paths.js';
import { bridgeRise, buildBridges } from './bridges.js';
import { elevatedCrossing, elevatedStructure } from './elevated-roads.js';
export { ROAD_DIRECTIONS };

export const ROAD_LAYOUT = 'grid-v1';
export const MIXED_ROAD_LAYOUT = 'mixed-v1';
const roadSides=Object.freeze([-1,1].map(side=>Object.freeze({side,offset:side*1.82,width:.36})));
const roadLanes=Object.freeze([-1,1].map(direction=>Object.freeze({direction,offset:direction*.8,width:1.6})));
export const ROAD_PROFILES=Object.freeze({
  road:Object.freeze({width:CELL,carriageway:3.28,bedY:.04,vehicleY:.07,walkY:.12,lanes:roadLanes,sidewalks:roadSides}),
  bridge:Object.freeze({width:CELL,carriageway:3.28,bedY:.45,vehicleY:.52,walkY:.57,lanes:roadLanes,sidewalks:roadSides}),
  path:Object.freeze({width:CELL,carriageway:0,bedY:.04,walkY:.19,lanes:Object.freeze([]),sidewalks:Object.freeze([Object.freeze({side:0,offset:0,width:CELL})])}),
});
export const isRoad = type => Object.hasOwn(ROAD_PROFILES,type);
export const hasTraffic = type => isRoad(type)&&ROAD_PROFILES[type].lanes.length>0;
export const nextRoadRevision = revision => (revision+1)%Number.MAX_SAFE_INTEGER;

export function roadHeader(revision,mixed=false){return {layout:mixed?MIXED_ROAD_LAYOUT:ROAD_LAYOUT,revision};}

export function readRoadHeader(value,mixed=false){
  if(value?.layout!==(mixed?MIXED_ROAD_LAYOUT:ROAD_LAYOUT)||!Number.isSafeInteger(value.revision)||value.revision<0||value.revision>=Number.MAX_SAFE_INTEGER){
    throw new Error('道路格式或拓扑版本无效');
  }
  return value.revision;
}

export function roadCenter(entity){return [entity.x*CELL,ROAD_PROFILES[entity.type].bedY,entity.z*CELL];}

export function gridRoadEnd(segment,side){
  const [x,y,z]=segment.center,[dx,dz]=ROAD_DIRECTIONS[side];
  return [x+dx*CELL/2,y,z+dz*CELL/2,[0,180,90,270][side]];
}

export function readGridRoad(record){
  const point=record.center;
  if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite)||point[1]!==ROAD_PROFILES[record.type].bedY
    ||record.x!==undefined||record.z!==undefined||!Number.isInteger(point[0]/CELL)||!Number.isInteger(point[2]/CELL)){
    throw new Error('道路中心或高度与格网格式不符');
  }
  return {...record,x:point[0]/CELL,z:point[2]/CELL};
}

export function roadCorner(mask){
  const exits=ROAD_DIRECTIONS.filter((_,i)=>mask&(1<<i));
  if(exits.length!==2||exits[0][0]===-exits[1][0]||exits[0][1]===-exits[1][1])return null;
  return [exits.find(([x])=>x)[0],exits.find(([,z])=>z)[1]];
}

export function cornerPoint(sx,sz,radius,angle){
  return [sx*(CELL/2-radius*Math.sin(angle)),sz*(CELL/2-radius*Math.cos(angle))];
}

export function cornerHeight(center,start,end,t){
  return center+((t<.5?start:end)-center)*Math.abs(2*t-1);
}

const arcSurfaces=new Map();
export function gridRoadSurface(kind,mask){
  const profile=ROAD_PROFILES[kind],corner=kind==='road'&&roadCorner(mask);
  if(!corner)return junctionLayout(mask,profile);
  if(!arcSurfaces.has(mask))arcSurfaces.set(mask,arcSurface(corner,profile,cornerPoint));
  return arcSurfaces.get(mask);
}

export function roadCarriageway(segment){
  if(segment.geometry){
    const rows=segment.geometry.samples.map(sample=>[-1,1].map(sign=>{
      const [x,,z]=offsetRoadSample(sample,sign*segment.profile.carriageway/2);
      return [x,z];
    }));
    return rows.slice(1).map(([a,b],i)=>[rows[i][1],rows[i][0],a,b]);
  }
  const [x,,z]=segment.center;
  return segment.surface.asphalt.map(polygon=>polygon.map(([u,v])=>[u+x,v+z]));
}

function centerlines(center,ports,corner,rotation){
  const [x,y,z]=center,half=CELL/2;
  if(!ports.length)return rotation%2?[[[x,y,z-half],[x,y,z+half]]]:[[[x-half,y,z],[x+half,y,z]]];
  if(!corner)return ports.map(port=>[center,port.point]);
  const [sx,sz]=corner;
  const start=ports.find(port=>ROAD_DIRECTIONS[port.side][0]===sx).point;
  const end=ports.find(port=>ROAD_DIRECTIONS[port.side][1]===sz).point;
  const line=[start];
  for(let i=1;i<24;i++){
    const [dx,dz]=cornerPoint(sx,sz,half,i*Math.PI/48);
    line.push([x+dx,cornerHeight(y,start[1],end[1],i/24),z+dz]);
  }
  line.push(end);
  return [line];
}

function approachSurface(neighbor,junctionId,center){
  const [x,,z]=center;
  let polygons=roadCarriageway(neighbor);
  if(neighbor.geometry){
    const end=neighbor.ports.find(p=>p.neighborId===junctionId).end;
    polygons=end?polygons.slice(-11):polygons.slice(0,11);
  }
  return polygons.map(polygon=>polygon.map(([a,b])=>[a-x,b-z]));
}

// The old tile layer is projected once into a metre-based network. Road and
// bridge tiles share vehicle ports. Standalone paths have pedestrian ports only.
export function buildRoadNetwork(entities,revision,terrain){
  const roads=[...entities].filter(e=>isRoad(e.type));
  const grid=roads.filter(e=>!e.alignment);
  const at=new Map(grid.map(e=>[`${e.x},${e.z}`,e]));
  const segments=new Map(),ends=new Map(),alignmentMasks=new Map();
  for(const e of grid){
    const profile=ROAD_PROFILES[e.type==='bridge'?'road':e.type],center=[e.x*CELL,profile.bedY,e.z*CELL],ports=[];
    let mask=0;
    for(const [side,[dx,dz]] of ROAD_DIRECTIONS.entries()){
      const neighbor=at.get(`${e.x+dx},${e.z+dz}`);
      if(!neighbor||hasTraffic(e.type)!==hasTraffic(neighbor.type))continue;
      ports.push({side,neighborId:neighbor.id,point:[center[0]+dx*CELL/2,profile.bedY,center[2]+dz*CELL/2],
        walkY:profile.walkY,vehicleY:profile.vehicleY});
      mask|=1<<side;
    }
    segments.set(e.id,{id:e.id,kind:e.type,center,profile,ports,mask});
  }
  for(const e of roads)if(e.alignment){
    const geometry=alignmentGeometry(e.alignment),{samples}=geometry,profile=ROAD_PROFILES.road;
    const profileLines=(items,height)=>items.map(item=>({...item,points:samples.map(sample=>offsetRoadSample(sample,item.offset,height))}));
    const segment={id:e.id,kind:'road',profile,center:samples[Math.floor(samples.length/2)].point,
      centerlines:[samples.map(s=>s.point)],geometry,ports:[],
      lanes:profileLines(profile.lanes,profile.vehicleY-profile.bedY),
      sidewalks:profileLines(profile.sidewalks,profile.walkY-profile.bedY)};
    if(e.alignment.elevated)segment.structure=elevatedStructure(e.alignment,terrain);
    segments.set(e.id,segment);
    for(const [index,sample] of [[0,samples[0]],[1,samples.at(-1)]]){
      const key=sample.point.join(',');
      const endpoint=e.alignment[index?'end':'start'];
      const other=ends.get(key);
      if(other&&matchingRoadEnds(endpoint,index,other.endpoint,other.index)){
        const port={point:sample.point,walkY:sample.point[1]+(profile.walkY-profile.bedY),vehicleY:sample.point[1]+(profile.vehicleY-profile.bedY)};
        segment.ports.push({...port,end:index,neighborId:other.segment.id});
        other.segment.ports.push({...port,end:other.index,neighborId:e.id});
      }else {
        ends.set(key,{segment,index,endpoint});
        for(const [side,[dx,dz]] of ROAD_DIRECTIONS.entries()){
          const [x,y,z]=endpoint,gridTile=at.get(`${x/CELL-dx/2},${z/CELL-dz/2}`);
          if(gridTile?.type!=='road')continue;
          const neighbor=segments.get(gridTile.id);
          if(neighbor.mask&(1<<side)||!matchingRoadEnds(endpoint,index,gridRoadEnd(neighbor,side),1))continue;
          const port={point:sample.point,walkY:y+(profile.walkY-profile.bedY),vehicleY:y+(profile.vehicleY-profile.bedY)};
          segment.ports.push({...port,end:index,neighborId:neighbor.id});
          neighbor.ports.push({...port,side,neighborId:e.id});neighbor.mask|=1<<side;
          alignmentMasks.set(neighbor.id,(alignmentMasks.get(neighbor.id)??0)|(1<<side));
          ends.delete(key);break;
        }
      }
    }
  }
  const bridges=buildBridges(grid.filter(e=>hasTraffic(e.type)),alignmentMasks,terrain,ROAD_PROFILES.road.vehicleY);
  for(const e of roads)if(e.alignment?.elevated){
    const crossing=elevatedCrossing(e.alignment,terrain,e.id);
    if(crossing)bridges.crossings.push(crossing);
  }
  for(const e of grid){
    const segment=segments.get(e.id),{center,ports,mask}=segment;
    segment.grade=bridges.grades.get(e.id);
    segment.bridge=bridges.byTile.get(e.id);
    if(segment.grade){
      center[1]+=bridgeRise(segment.grade,center[0]);
      for(const port of ports){
        const rise=bridgeRise(segment.grade,port.point[0]);
        port.point=[port.point[0],port.point[1]+rise,port.point[2]];
        port.vehicleY+=rise;port.walkY+=rise;
      }
    }
    segment.corner=e.type==='road'?roadCorner(mask):null;
    segment.centerlines=centerlines(center,ports,segment.corner,e.rotation);
    if(hasTraffic(e.type))segment.surface=gridRoadSurface(e.type,mask);
  }
  const junctions=new Map();
  for(const e of grid){
    const segment=segments.get(e.id);
    if(e.type!=='road'||![1,3,4].includes(segment.ports.length))continue;
    const neighbors=segment.ports.map(port=>[port.side,segments.get(port.neighborId)]).filter(([,road])=>road.kind==='road');
    const key=neighbors.some(([,road])=>road.geometry)?null:`${segment.mask}:${neighbors.map(([side,road])=>`${side}/${road.mask}`).join(',')}`;
    if(key&&junctions.has(key))segment.junction=junctions.get(key);
    else{
      const approaches=new Map(neighbors.map(([side,road])=>[side,approachSurface(road,e.id,segment.center)]));
      segment.junction=buildJunction(segment.mask,segment.profile,approaches);
      if(key)junctions.set(key,segment.junction);
    }
  }
  for(const segment of segments.values()){
    const paths=buildRoadPaths(segment,cornerPoint,cornerHeight);
    if(segment.grade){
      const lift=(path,height)=>{path.points=path.points.map(([x,,z])=>[x,height+bridgeRise(segment.grade,x),z]);};
      for(const path of paths.lanePaths)lift(path,segment.profile.vehicleY);
      for(const path of paths.walkways)lift(path,segment.profile.walkY);
    }
    Object.assign(segment,paths);
  }
  return {revision,segments,alignmentMasks,bridges,laneGraph:buildLaneGraph(segments,revision)};
}
