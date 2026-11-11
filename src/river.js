import { CELL } from './catalog.js';
import { outlinesOverlap } from './outline.js';

export const GROUND_Y = 0;
export const WATER_Y = -.4;
export const BANK_STEP = CELL/2;
export const QUAY = Object.freeze({width:3.4,minZ:-110,maxZ:112,y:.025});
export const PROTOTYPE_HULL = Object.freeze({width:2,length:4,margin:.5,originAboveWater:.035,top:1.215,bob:.035});
export const PROTOTYPE_RADIUS = Math.hypot(PROTOTYPE_HULL.width/2,PROTOTYPE_HULL.length/2)+PROTOTYPE_HULL.margin;

const sourceCenter = (z,terrain) => terrain==='legacy'
  ? Math.sin(z*.016)*11+Math.sin(z*.004)*9
  : Math.sin(z*.025)*23+Math.sin(z*.009)*10;
const sourceWidth = (z,terrain) => terrain==='legacy'
  ? 11.9 : 11.3+1.8*Math.sin(z*.033+.6)+5*Math.exp(-(((z-30)/26)**2));

function sampleBanks(z,terrain){
  const center=sourceCenter(z,terrain),width=sourceWidth(z,terrain);
  return [center-width,center+width];
}

export function riverBanks(z,terrain){
  const from=Math.floor(z/BANK_STEP)*BANK_STEP,t=(z-from)/BANK_STEP,a=sampleBanks(from,terrain);
  if(!t)return a;
  const b=sampleBanks(from+BANK_STEP,terrain);
  return a.map((x,i)=>x+(b[i]-x)*t);
}

export function riverCenter(z,terrain){const [a,b]=riverBanks(z,terrain);return (a+b)/2;}
export function riverWidth(z,terrain){const [a,b]=riverBanks(z,terrain);return (b-a)/2;}

export function* riverSections(minZ,maxZ,terrain){
  let from=minZ,a=riverBanks(from,terrain);
  while(from<maxZ){
    const to=Math.min(maxZ,(Math.floor(from/BANK_STEP)+1)*BANK_STEP),b=riverBanks(to,terrain);
    yield {from,to,a,b};
    from=to;a=b;
  }
}

export function terrainSurfaceAt(x,z,terrain){
  const [west,east]=riverBanks(z,terrain),water=x>west&&x<east;
  return {groundY:water?null:GROUND_Y,waterY:water?WATER_Y:null};
}

// Archived grid placements were validated at their grid points with a setback.
export function waterAt(x,z,terrain){
  return Math.abs(x*CELL-sourceCenter(z*CELL,terrain))<sourceWidth(z*CELL,terrain)-1.4;
}

export function waterOverlaps(outline,bounds,terrain){
  for(const {from,to,a:[west,east],b:[nextWest,nextEast]} of riverSections(bounds.minZ,bounds.maxZ,terrain)){
    if(bounds.maxX>Math.min(west,nextWest)&&bounds.minX<Math.max(east,nextEast)
      &&outlinesOverlap(outline,[[west,from],[east,from],[nextEast,to],[nextWest,to]]))return true;
  }
  return false;
}

export function quayCenter(z,side,terrain){
  return [riverBanks(z,terrain)[side<0?0:1]+side*QUAY.width/2,QUAY.y,z];
}

export function quaySection({from,to,a,b},side){
  const index=side<0?0:1,xa=a[index],xb=b[index],offset=side*QUAY.width;
  return {side,from,to,outline:[[Math.min(xa,xa+offset),from],[Math.max(xa,xa+offset),from],
    [Math.max(xb,xb+offset),to],[Math.min(xb,xb+offset),to]],
    points:[[xa+offset/2,QUAY.y,from],[xb+offset/2,QUAY.y,to]]};
}

// A circle enclosing the rotated hull stays inside both banks over its full length.
export function navigableSpan(z,terrain,radius){
  let [west,east]=riverBanks(z,terrain);
  for(const {a,b} of riverSections(z-radius,z+radius,terrain)){
    west=Math.max(west,a[0],b[0]);east=Math.min(east,a[1],b[1]);
  }
  return west+radius<=east-radius?[west+radius,east-radius]:null;
}

export function sailingCenter(z,terrain,radius){
  const span=navigableSpan(z,terrain,radius);
  return span?(span[0]+span[1])/2:null;
}
