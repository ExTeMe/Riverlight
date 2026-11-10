import { BY_ID, CELL } from './catalog.js';
import { BANK_STEP, legacyFootprintBounds, legacyPlacement, riverBanks } from './space.js';
import { EDGE_EPSILON, boundsContain, boxOutline, outlineBounds, outlinesOverlap, transformOutline } from './outline.js';

export const CITY_VERSION = 3;
export const supportedCityVersion = version => [1,2,CITY_VERSION].includes(version);
export const usesParcel = type => ['home','city','civic','park'].includes(BY_ID[type]?.category);

export function normalAngle(degrees) {
  const angle = degrees % 360;
  return (angle < 0 ? angle + 360 : angle) % 360 || 0;
}

function rectangle(width,depth) {
  return boxOutline({minX:-width/2,minZ:-depth/2,maxX:width/2,maxZ:depth/2});
}

function buildingOutline(type) {
  const item=BY_ID[type];
  return item.outline??rectangle(item.w*CELL,item.d*CELL);
}

export function parcelOutline(parcel) {
  return transformOutline(rectangle(parcel.width,parcel.depth),parcel.x,parcel.z,parcel.angle*Math.PI/180);
}

export function placementOf(entity) {
  if(!entity.pose)return legacyPlacement(entity);
  const {parcel,offsetX,offsetZ,angle}=entity.pose,r=parcel.angle*Math.PI/180;
  return {x:parcel.x+offsetX*Math.cos(r)+offsetZ*Math.sin(r),
    z:parcel.z-offsetX*Math.sin(r)+offsetZ*Math.cos(r),
    radians:normalAngle(parcel.angle+angle)*Math.PI/180,scaleX:1,scaleZ:1};
}

export function footprintOutline(entity) {
  if(!entity.pose)return boxOutline(legacyFootprintBounds(entity));
  const {x,z,radians}=placementOf(entity);
  return transformOutline(buildingOutline(entity.type),x,z,radians);
}

export function fitsParcel(entity) {
  const {parcel,offsetX,offsetZ,angle}=entity.pose;
  const local=transformOutline(buildingOutline(entity.type),offsetX,offsetZ,angle*Math.PI/180);
  return boundsContain({minX:-parcel.width/2,minZ:-parcel.depth/2,maxX:parcel.width/2,maxZ:parcel.depth/2},outlineBounds(local),EDGE_EPSILON);
}

export function normalizeParcel(raw) {
  if(!raw||typeof raw.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(raw.id)
    ||![raw.x,raw.z,raw.angle,raw.width,raw.depth].every(Number.isFinite)||raw.width<=0||raw.depth<=0
    ||(raw.grid!==undefined&&raw.grid!==true)||raw.id.startsWith('legacy-')!==(raw.grid===true)){
    throw new Error('存档包含无效地块');
  }
  return {id:raw.id,x:raw.x,z:raw.z,width:raw.width,depth:raw.depth,angle:normalAngle(raw.angle),...(raw.grid?{grid:true}:{})};
}

export function legacyParcel(entity) {
  const {x,z}=legacyPlacement(entity),item=BY_ID[entity.type],size=entity.lot||[item.w,item.d];
  return {id:`legacy-${entity.id}`,x,z,width:size[0]*CELL,depth:size[1]*CELL,angle:entity.rotation*90,grid:true};
}

export function readParcelEntity(raw,parcel) {
  if(!parcel||!usesParcel(raw.type)||![raw.offsetX,raw.offsetZ,raw.angle].every(Number.isFinite))throw new Error('建筑地块引用或局部姿态无效');
  const {id,type,color}=raw,angle=normalAngle(raw.angle);
  if(!parcel.grid){
    if(raw.lot!==undefined)throw new Error('自定义地块不支持旧占地缩放');
    return {id,type,color,pose:{parcel,offsetX:raw.offsetX,offsetZ:raw.offsetZ,angle}};
  }
  const item=BY_ID[type],size=raw.lot||[item.w,item.d],rotation=parcel.angle/90;
  if(parcel.id!==`legacy-${id}`||!Number.isInteger(rotation)||raw.offsetX!==0||raw.offsetZ!==0||angle!==0
    ||parcel.width!==size[0]*CELL||parcel.depth!==size[1]*CELL)throw new Error('旧占地与地块不一致');
  const [w,d]=rotation%2?[size[1],size[0]]:size;
  return {id,type,x:parcel.x/CELL-(w-1)/2,z:parcel.z/CELL-(d-1)/2,rotation,color,...(raw.lot?{lot:[...raw.lot]}:{})};
}

// Water between two sampled cross sections is a convex trapezoid.
export function parcelOnLand(outline,bounds,terrain) {
  let z=Math.floor(bounds.minZ/BANK_STEP)*BANK_STEP;
  let [west,east]=riverBanks(z,terrain);
  for(;z<bounds.maxZ;z+=BANK_STEP){
    const end=z+BANK_STEP,[nextWest,nextEast]=riverBanks(end,terrain);
    if(bounds.maxX>Math.min(west,nextWest)&&bounds.minX<Math.max(east,nextEast)
      &&outlinesOverlap(outline,[[west,z],[east,z],[nextEast,end],[nextWest,end]]))return false;
    west=nextWest;east=nextEast;
  }
  return true;
}
