import { alignmentGeometry, roadOverlaps, sectionsOverlap } from './road-alignment.js';
import { BY_ID } from './catalog.js';
import { channelEnvelope, DECK_DEPTH, PIER_BASE, REQUIRED_UNDERSIDE } from './bridges.js';
import { boxOutline, outlineBounds } from './outline.js';
import { waterOverlaps } from './river.js';

// Upper bounds in metres for the authored, LOD and fallback assets, with
// allowance for roof details and animation. Placement uses the same bounds on
// load and before the renderer has imported the assets.
const obstacleHeights={
  cottage:6.5,'sage-house':7,'rose-house':6,villa:7,townhouse:8.5,apartment:14,'mint-apartment':11.5,residence:21.5,
  cafe:6,bakery:8,bookshop:9.5,market:5,mall:10.5,office:27.5,'glass-tower':43.5,'terrace-tower':26,hotel:22.5,
  library:7,museum:7,school:6.5,clinic:7,clocktower:17.5,park:5,plaza:5,grove:6.5,garden:4.5,amusement:17.5,
  tree:6,pine:5.5,cherry:6,flowers:1.5,bench:2,lamp:4.5,pier:4,
  // Include the highest existing grid bridge grade as well as road traffic.
  road:5,bridge:5,path:2.4,
};
export const obstacleHeight=entity=>BY_ID[entity.type]?.obstacleHeight??obstacleHeights[entity.type];
export const ROAD_DECK_BOTTOM=.03-DECK_DEPTH;
export const ROAD_RAIL_TOP=.92;
const ROAD_HEADROOM=3.3;
const PIER_WIDTH=.8;
const structureCache=new WeakMap();

export function roadSupports(samples,terrain){
  const [x,,z]=samples[0].point,[u,,w]=samples.at(-1).point;
  const count=2*Math.ceil(Math.hypot(u-x,w-z)/36),piers=[];
  for(let i=0;i<count;i++){
    const [x,y,z]=samples[Math.round((samples.length-1)*(i+.5)/count)].point;
    const top=y+ROAD_DECK_BOTTOM;
    if(top<.25)continue;
    const half=PIER_WIDTH/2,bounds={minX:x-half,maxX:x+half,minZ:z-half,maxZ:z+half},outline=boxOutline(bounds);
    const wet=waterOverlaps(outline,bounds,terrain);
    if(wet){
      const channel=channelEnvelope(bounds,terrain);
      if(!channel||(bounds.maxX+.1>channel.minX&&bounds.minX-.1<channel.maxX))continue;
    }
    piers.push({x,z,width:PIER_WIDTH,base:wet?PIER_BASE:0,top,bounds,outline});
  }
  return piers;
}

export function elevatedStructure(alignment,terrain){
  if(!alignment.elevated)return null;
  const cached=structureCache.get(alignment);
  if(cached?.terrain===terrain)return cached.structure;
  const {bounds,samples,sections}=alignmentGeometry(alignment);
  if(!samples)return null;
  let bottomY=null,waterRange=null;
  for(const [i,section] of sections.entries()){
    if(!waterOverlaps(section.outline,section.bounds,terrain))continue;
    bottomY=Math.min(bottomY??Infinity,section.minY+ROAD_DECK_BOTTOM);
    waterRange=[waterRange?.[0]??i,i+1];
  }
  const structure={bounds,bottomY,waterRange,piers:roadSupports(samples,terrain)};
  structureCache.set(alignment,{terrain,structure});
  return structure;
}

export function elevatedCrossing(alignment,terrain,id){
  const structure=elevatedStructure(alignment,terrain);
  if(structure?.bottomY==null)return null;
  const {bounds,bottomY,piers}=structure,passable=bottomY>=REQUIRED_UNDERSIDE;
  return {bounds,bottomY,piers:piers.filter(pier=>pier.base<0).map(({x,z,width})=>({x,z,width})),
    passable,reason:passable?null:'height',deckIds:[id],approachIds:[]};
}

export function roadObstacleConflict(alignment,outline,height,terrain){
  if(!alignment.elevated)return roadOverlaps(alignment,outline)?'footprint':null;
  const obstacle={outline,bounds:outlineBounds(outline)};
  const {sections}=alignmentGeometry(alignment),structure=elevatedStructure(alignment,terrain);
  if(structure.piers.some(pier=>sectionsOverlap(pier,obstacle)))return 'pier';
  return sections.some(section=>section.minY+ROAD_DECK_BOTTOM<height&&sectionsOverlap(section,obstacle))?'height':null;
}
export const roadBlocksOutline=(...args)=>!!roadObstacleConflict(...args);

export function roadConflict(a,b,terrain){
  if(!a.elevated&&!b.elevated)return roadOverlaps(a,null,b);
  const {sections:first}=alignmentGeometry(a),{sections:second}=alignmentGeometry(b);
  for(const left of first)for(const right of second){
    if(a.elevated&&left.minY+ROAD_DECK_BOTTOM>=right.maxY+ROAD_HEADROOM)continue;
    if(b.elevated&&right.minY+ROAD_DECK_BOTTOM>=left.maxY+ROAD_HEADROOM)continue;
    if(sectionsOverlap(left,right))return true;
  }
  const supportsA=elevatedStructure(a,terrain)?.piers??[],supportsB=elevatedStructure(b,terrain)?.piers??[];
  return supportsA.some(pier=>second.some(section=>section.minY+ROAD_DECK_BOTTOM<pier.top&&sectionsOverlap(pier,section)))
    ||supportsB.some(pier=>first.some(section=>section.minY+ROAD_DECK_BOTTOM<pier.top&&sectionsOverlap(pier,section)))
    ||supportsA.some(pier=>supportsB.some(other=>sectionsOverlap(pier,other)));
}

export function roadEndsSeparated(a,b,y,otherY){
  return a.elevated&&y+ROAD_DECK_BOTTOM>=otherY+ROAD_HEADROOM
    ||b.elevated&&otherY+ROAD_DECK_BOTTOM>=y+ROAD_HEADROOM;
}
