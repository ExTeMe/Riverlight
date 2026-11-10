import { CELL } from './catalog.js';

export const ROAD_LAYOUT = 'grid-v1';
export const ROAD_DIRECTIONS = Object.freeze([[1,0],[-1,0],[0,1],[0,-1]].map(Object.freeze));
const roadSides=Object.freeze([-1,1].map(side=>Object.freeze({side,offset:side*1.7,width:.44})));
const roadLanes=Object.freeze([-1,1].map(direction=>Object.freeze({direction,offset:direction*.65,width:1.3})));
export const ROAD_PROFILES=Object.freeze({
  road:Object.freeze({width:CELL,carriageway:2.96,bedY:.04,vehicleY:.07,walkY:.12,lanes:roadLanes,sidewalks:roadSides}),
  bridge:Object.freeze({width:CELL,carriageway:2.96,bedY:.45,vehicleY:.52,walkY:.57,lanes:roadLanes,sidewalks:roadSides}),
  path:Object.freeze({width:CELL,carriageway:0,bedY:.04,walkY:.19,lanes:Object.freeze([]),sidewalks:Object.freeze([Object.freeze({side:0,offset:0,width:CELL})])}),
});
export const isRoad = type => Object.hasOwn(ROAD_PROFILES,type);
export const hasTraffic = type => isRoad(type)&&ROAD_PROFILES[type].lanes.length>0;
export const nextRoadRevision = revision => (revision+1)%Number.MAX_SAFE_INTEGER;

export function roadHeader(revision){return {layout:ROAD_LAYOUT,revision};}

export function readRoadHeader(value){
  if(value?.layout!==ROAD_LAYOUT||!Number.isSafeInteger(value.revision)||value.revision<0||value.revision>=Number.MAX_SAFE_INTEGER){
    throw new Error('道路格式或拓扑版本无效');
  }
  return value.revision;
}

export function roadCenter(entity){return [entity.x*CELL,ROAD_PROFILES[entity.type].bedY,entity.z*CELL];}

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

// The old tile layer is projected once into a metre-based network. Road and
// bridge tiles share vehicle ports. Standalone paths have pedestrian ports only.
export function buildRoadNetwork(entities,revision){
  const roads=[...entities].filter(e=>isRoad(e.type));
  const at=new Map(roads.map(e=>[`${e.x},${e.z}`,e]));
  const segments=new Map();
  for(const e of roads){
    const center=roadCenter(e),profile=ROAD_PROFILES[e.type],ports=[];
    let mask=0;
    for(const [side,[dx,dz]] of ROAD_DIRECTIONS.entries()){
      const neighbor=at.get(`${e.x+dx},${e.z+dz}`);
      if(!neighbor||hasTraffic(e.type)!==hasTraffic(neighbor.type))continue;
      const other=ROAD_PROFILES[neighbor.type];
      ports.push({side,neighborId:neighbor.id,point:[center[0]+dx*CELL/2,(profile.bedY+other.bedY)/2,center[2]+dz*CELL/2],
        walkY:(profile.walkY+other.walkY)/2});
      mask|=1<<side;
    }
    const corner=e.type==='road'?roadCorner(mask):null;
    segments.set(e.id,{id:e.id,kind:e.type,center,profile,ports,mask,corner,centerlines:centerlines(center,ports,corner,e.rotation)});
  }
  return {revision,segments};
}
