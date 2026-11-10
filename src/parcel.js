import { BY_ID, CELL } from './catalog.js';
import { legacyPlacement, riverCenter, riverWidth } from './space.js';

export const CITY_VERSION = 3;
export const supportedCityVersion = version => [1,2,CITY_VERSION].includes(version);
export const usesParcel = type => ['home','city','civic','park'].includes(BY_ID[type]?.category);

export function normalAngle(degrees) {
  const angle = degrees % 360;
  return (angle < 0 ? angle + 360 : angle) % 360 || 0;
}

function rectangleExtents(width,depth,radians) {
  const c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
  return [(width*c+depth*s)/2,(width*s+depth*c)/2];
}

function rectangleBounds(x,z,width,depth,radians) {
  const [halfX,halfZ]=rectangleExtents(width,depth,radians);
  return {minX:x-halfX,minZ:z-halfZ,maxX:x+halfX,maxZ:z+halfZ};
}

export function parcelBounds(parcel) {
  return rectangleBounds(parcel.x,parcel.z,parcel.width,parcel.depth,parcel.angle*Math.PI/180);
}

export function placementOf(entity) {
  if(!entity.pose)return legacyPlacement(entity);
  const {parcel,offsetX,offsetZ,angle}=entity.pose,r=parcel.angle*Math.PI/180;
  return {x:parcel.x+offsetX*Math.cos(r)+offsetZ*Math.sin(r),
    z:parcel.z-offsetX*Math.sin(r)+offsetZ*Math.cos(r),
    radians:normalAngle(parcel.angle+angle)*Math.PI/180,scaleX:1,scaleZ:1};
}

export function parcelBuildingBounds(entity) {
  const {x,z,radians}=placementOf(entity),item=BY_ID[entity.type];
  return rectangleBounds(x,z,item.w*CELL,item.d*CELL,radians);
}

export function fitsParcel(entity) {
  const {parcel,offsetX,offsetZ,angle}=entity.pose,item=BY_ID[entity.type];
  const [halfX,halfZ]=rectangleExtents(item.w*CELL,item.d*CELL,angle*Math.PI/180);
  return Math.abs(offsetX)+halfX<=parcel.width/2+1e-8 && Math.abs(offsetZ)+halfZ<=parcel.depth/2+1e-8;
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

// Use the same two-metre bank samples as the rendered terrain. Reserve the
// entire AABB until EDIT-02 supplies polygon and terrain intersection.
export function parcelOnLand(bounds,terrain) {
  let west=true,east=true;
  for(let z=Math.floor(bounds.minZ/2)*2;z<=Math.ceil(bounds.maxZ/2)*2;z+=2){
    const centre=riverCenter(z,terrain),width=riverWidth(z,terrain);
    west&&=bounds.maxX<=centre-width;
    east&&=bounds.minX>=centre+width;
    if(!west&&!east)return false;
  }
  return true;
}
