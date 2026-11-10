import { BY_ID, CELL, entityDimensions } from './catalog.js';

export const GROUND_Y = 0;
export const WATER_Y = -.4;

export const riverCenter = (z, terrain = 'meander') => terrain === 'legacy'
  ? Math.sin(z*.016)*11 + Math.sin(z*.004)*9
  : Math.sin(z*.025)*23 + Math.sin(z*.009)*10;
export const riverWidth = (z, terrain = 'meander') => terrain === 'legacy'
  ? 11.9 : 11.3 + 1.8*Math.sin(z*.033+.6) + 5*Math.exp(-(((z-30)/26)**2));

export function terrainSurfaceAt(x, z, terrain) {
  const water = Math.abs(x-riverCenter(z,terrain)) < riverWidth(z,terrain);
  return { groundY: water ? null : GROUND_Y, waterY: water ? WATER_Y : null };
}

// Legacy placement retains its original setback and grid sampling.
export function waterAt(x, z, terrain) {
  return Math.abs(x*CELL-riverCenter(z*CELL,terrain)) < riverWidth(z*CELL,terrain)-1.4;
}

export function legacyFootprintBounds(entity) {
  const [width, depth] = entityDimensions(entity);
  const minX = (entity.x-.5)*CELL, minZ = (entity.z-.5)*CELL;
  return { minX, minZ, maxX:minX+width*CELL, maxZ:minZ+depth*CELL };
}

export function legacyPlacement(entity) {
  const {minX,minZ,maxX,maxZ} = legacyFootprintBounds(entity);
  const item = BY_ID[entity.type];
  return {
    x:(minX+maxX)/2, z:(minZ+maxZ)/2, radians:entity.rotation*Math.PI/2,
    scaleX:entity.lot ? entity.lot[0]/item.w : 1,
    scaleZ:entity.lot ? entity.lot[1]/item.d : 1,
  };
}

export function worldBounds(radius) {
  const min = (-radius-.5)*CELL, max = (radius-.5)*CELL;
  return { minX:min, minZ:min, maxX:max, maxZ:max };
}

export function legacySnap(metres, step) {
  return Math.floor((metres+CELL/2)/(step*CELL))*step;
}

const overlaps = (a, b) => a.minX<b.maxX && a.maxX>b.minX && a.minZ<b.maxZ && a.maxZ>b.minZ;
const bucketKey = (x, z) => `${x}:${z}`;

// The index covers physical extents independently of the renderer's owner chunk.
export class SpatialIndex {
  constructor(bucketSize = 64) {
    this.bucketSize = bucketSize;
    this.bounds = new Map();
    this.buckets = new Map();
  }
  range(bounds) {
    const size = this.bucketSize;
    return [Math.floor(bounds.minX/size), Math.floor(bounds.minZ/size),
      Math.ceil(bounds.maxX/size)-1, Math.ceil(bounds.maxZ/size)-1];
  }
  insert(id, bounds) {
    this.bounds.set(id, bounds);
    const [x0,z0,x1,z1] = this.range(bounds);
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
      const key = bucketKey(x,z);
      if(!this.buckets.has(key))this.buckets.set(key,new Set());
      this.buckets.get(key).add(id);
    }
  }
  erase(id) {
    const bounds = this.bounds.get(id);
    if(!bounds)return;
    this.bounds.delete(id);
    const [x0,z0,x1,z1] = this.range(bounds);
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
      const key = bucketKey(x,z), bucket = this.buckets.get(key);
      bucket.delete(id);
      if(!bucket.size)this.buckets.delete(key);
    }
  }
  query(bounds) {
    const {minX,minZ,maxX,maxZ} = bounds;
    if(![minX,minZ,maxX,maxZ].every(Number.isFinite)||minX>=maxX||minZ>=maxZ)return [];
    const [x0,z0,x1,z1] = this.range(bounds);
    // A wide or far-away request should not walk empty space.
    let candidates = this.bounds.keys();
    if([x0,z0,x1,z1].every(Number.isSafeInteger)&&(x1-x0+1)*(z1-z0+1)<=this.buckets.size){
      const ids = new Set();
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
        for(const id of this.buckets.get(bucketKey(x,z))||[])ids.add(id);
      }
      candidates = ids;
    }
    return [...candidates].filter(id=>overlaps(this.bounds.get(id),bounds)).sort((a,b)=>a-b);
  }
}
