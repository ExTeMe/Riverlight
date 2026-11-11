import { CELL } from './catalog.js';
import { boxOutline } from './outline.js';
import { ROAD_DIRECTIONS } from './road-junction.js';
import { PROTOTYPE_HULL, PROTOTYPE_RADIUS, WATER_Y, riverSections, waterOverlaps } from './river.js';

const HALF=CELL/2, APPROACH_TILES=3, DECK_RISE=1.44;
export const DECK_DEPTH=.28, PIER_WIDTH=.6, PIER_BASE=-1.5;
export const REQUIRED_UNDERSIDE=WATER_Y+PROTOTYPE_HULL.originAboveWater+PROTOTYPE_HULL.top+PROTOTYPE_HULL.bob+.25;
const tileKey=(x,z)=>`${x},${z}`;
const tileBounds=({x,z})=>({minX:x*CELL-HALF,maxX:x*CELL+HALF,minZ:z*CELL-HALF,maxZ:z*CELL+HALF});
const pierAt=({x,z})=>({x:x*CELL,z:z*CELL,width:PIER_WIDTH});

export function channelEnvelope(bounds,terrain){
  const r=PROTOTYPE_RADIUS;
  let westMin=Infinity,westMax=-Infinity,eastMin=Infinity,eastMax=-Infinity;
  for(const {a,b} of riverSections(bounds.minZ-2*r,bounds.maxZ+2*r,terrain)){
    westMin=Math.min(westMin,a[0],b[0]);westMax=Math.max(westMax,a[0],b[0]);
    eastMin=Math.min(eastMin,a[1],b[1]);eastMax=Math.max(eastMax,a[1],b[1]);
  }
  if(westMax+r>eastMin-r)return null;
  // The midpoint of any eroded cross-section lies within these extrema.
  return {minX:(westMin+eastMin)/2-r,maxX:(westMax+eastMax)/2+r,minZ:bounds.minZ,maxZ:bounds.maxZ};
}

export function bridgeRise(grade,x){
  return grade?DECK_RISE*Math.max(0,1-Math.max(grade.minX-x,0,x-grade.maxX)/(CELL*APPROACH_TILES)):0;
}

export function buildBridges(grid,alignmentMasks,terrain,vehicleY){
  const at=new Map(grid.map(e=>[tileKey(e.x,e.z),e])),wet=new Set();
  for(const tile of grid)if(tile.type==='bridge'){
    const bounds=tileBounds(tile);
    if(waterOverlaps(boxOutline(bounds),bounds,terrain))wet.add(tile.id);
  }
  const mask=tile=>ROAD_DIRECTIONS.reduce((bits,[dx,dz],side)=>bits|(at.has(tileKey(tile.x+dx,tile.z+dz))?1<<side:0),alignmentMasks.get(tile.id)??0);
  const approach=(edge,sign)=>{
    const tiles=[];
    for(let i=1;i<=APPROACH_TILES;i++){
      const tile=at.get(tileKey(edge.x+sign*i,edge.z)),inward=sign<0?1:2;
      if(!tile||wet.has(tile.id)||alignmentMasks.has(tile.id))return [];
      const bounds=tileBounds(tile),sides=mask(tile);
      if(waterOverlaps(boxOutline(bounds),bounds,terrain)||
        (sides!==3&&(i!==APPROACH_TILES||sides!==inward)))return [];
      tiles.push(tile);
    }
    return tiles;
  };
  const plans=[],grades=new Map(),byTile=new Map(),claims=new Map();
  for(const first of grid){
    if(!wet.has(first.id)||wet.has(at.get(tileKey(first.x-1,first.z))?.id))continue;
    const deck=[first];
    for(let tile=at.get(tileKey(first.x+1,first.z));wet.has(tile?.id);tile=at.get(tileKey(tile.x+1,tile.z)))deck.push(tile);
    const last=deck.at(-1),bounds={...tileBounds(first),maxX:tileBounds(last).maxX};
    const west=approach(first,-1),east=approach(last,1),channel=channelEnvelope(bounds,terrain);
    const piers=first===last?[pierAt(first)]:[pierAt(first),pierAt(last)];
    let reason=null;
    if(deck.some(tile=>mask(tile)!==3)||!west.length||!east.length)reason='approach';
    else if(!channel||piers.some(p=>p.x+PIER_WIDTH/2>channel.minX&&p.x-PIER_WIDTH/2<channel.maxX))reason='channel';
    else if(vehicleY+DECK_RISE-DECK_DEPTH<REQUIRED_UNDERSIDE)reason='height';
    const ramps=[...west,...east];
    plans.push({bounds,channel,reason,deck,ramps,piers});
    if(!reason)for(const tile of ramps)claims.set(tile.id,(claims.get(tile.id)??0)+1);
  }
  const crossings=plans.map(({bounds,channel,reason,deck,ramps,piers})=>{
    const obstruction=reason??(ramps.some(tile=>claims.get(tile.id)>1)?'approach':null);
    const passable=!obstruction;
    const definition={bounds,channel,reason:obstruction,passable,bottomY:vehicleY+(passable?DECK_RISE:0)-DECK_DEPTH,
      piers:passable?piers:deck.map(pierAt),deckIds:deck.map(tile=>tile.id),approachIds:passable?ramps.map(tile=>tile.id):[]};
    for(const tile of deck)byTile.set(tile.id,definition);
    if(passable)for(const tile of [...deck,...ramps])grades.set(tile.id,bounds);
    return definition;
  });
  return {grades,byTile,crossings};
}
