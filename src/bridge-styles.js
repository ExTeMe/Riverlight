import { BY_ID, CELL } from './catalog.js';
import { bridgeRise } from './bridges.js';
import { waterOverlaps } from './river.js';
import { alignmentGeometry } from './road-alignment.js';

export const BRIDGE_STYLES = {
  timber: {name:'林间木桥', railing:'#8c593d', pier:'#827062', deck:'#a38768', paving:'#c4a078'},
  stone: {name:'石栏桥', railing:'#e1cfaa', pier:'#a9a18c', deck:'#aa9d86', paving:'#d6c7aa'},
  girder: {name:'钢梁桥', railing:'#4b777a', pier:'#929d97', deck:'#546a70', paving:'#b5c3c2'},
  arch: {name:'钢拱桥', railing:'#4e707d', pier:'#9ca6a2', deck:'#637883', paving:'#c4cdca'},
};

function setting(nearby) {
  let buildings=0, tall=0, green=0;
  for(const {type} of nearby){
    const item=BY_ID[type];
    if(item.floors)buildings++;
    if(item.floors>=4)tall++;
    if(item.category==='park'||['tree','pine','cherry'].includes(type))green++;
  }
  return {urban:tall>=2||buildings>=6,green:green>=3&&green>buildings};
}

export function chooseBridgeStyle({span,straight,complete,passable},nearby=[]) {
  const {urban,green}=setting(nearby);
  if(passable&&complete&&straight&&span>=44)return 'arch';
  if(span>=34||urban)return 'girder';
  if(span<=26&&green)return 'timber';
  return 'stone';
}

function siteAround(bounds,query) {
  const margin=30;
  return query({minX:bounds.minX-margin,maxX:bounds.maxX+margin,
    minZ:bounds.minZ-margin,maxZ:bounds.maxZ+margin});
}

function hasRoadAbove(bounds,lowest,highest,query) {
  return query(bounds).some(entity=>entity.alignment?.elevated
    &&alignmentGeometry(entity.alignment).sections.some(({bounds:section,minY,maxY})=>
      section.minX<bounds.maxX&&section.maxX>bounds.minX&&section.minZ<bounds.maxZ&&section.maxZ>bounds.minZ
      &&maxY>lowest+.6&&minY<highest+8));
}

export function gridBridgeAppearance(crossing,query) {
  const {bounds,passable}=crossing;
  const span=bounds.maxX-bounds.minX;
  const straight=span<44||!hasRoadAbove(bounds,crossing.bottomY,crossing.bottomY+.4,query);
  return {key:chooseBridgeStyle({span,straight,complete:passable,passable},siteAround(bounds,query)),span};
}

export function continuousBridgeAppearance(geometry,structure,terrain,query,id) {
  if(!structure?.waterRange)return null;
  const [from,to]=structure.waterRange;
  const {samples}=geometry;
  const [x,,z]=samples[from].point,[u,,v]=samples[to].point;
  const span=Math.hypot(u-x,v-z);
  let deviation=0,highest=structure.bottomY;
  for(let i=from;i<=to;i++){
    const [px,y,pz]=samples[i].point;
    highest=Math.max(highest,y);
    deviation=Math.max(deviation,Math.abs((px-x)*(v-z)-(pz-z)*(u-x))/Math.max(span,.001));
  }
  const complete=!waterOverlaps(geometry.sections[0].outline,geometry.sections[0].bounds,terrain)
    &&!waterOverlaps(geometry.sections.at(-1).outline,geometry.sections.at(-1).bounds,terrain);
  const bounds={minX:Math.min(x,u),maxX:Math.max(x,u),minZ:Math.min(z,v),maxZ:Math.max(z,v)};
  const area={minX:bounds.minX-2,maxX:bounds.maxX+2,minZ:bounds.minZ-2,maxZ:bounds.maxZ+2};
  const straight=deviation<Math.min(1.25,.035*span)&&
    (span<44||!hasRoadAbove(area,structure.bottomY,highest,b=>query(b).filter(e=>e.id!==id)));
  const key=chooseBridgeStyle({span,straight,complete,passable:true},siteAround(bounds,query));
  return {key,span,from,to};
}

// Appearance is derived from the current bridge and city. All tiles of one
// grid crossing share a style, including when the crossing spans chunks.
export function bridgeAppearances(network,terrain,query) {
  const result=new Map();
  for(const crossing of network.bridges.crossings){
    const first=network.segments.get(crossing.deckIds[0]);
    if(first.geometry){
      const appearance=continuousBridgeAppearance(first.geometry,first.structure,terrain,query,first.id);
      if(appearance)result.set(first.id,appearance);
      continue;
    }
    const appearance=gridBridgeAppearance(crossing,query);
    for(const id of crossing.deckIds){
      const {center:[x,,z],grade,profile:{walkY}}=network.segments.get(id);
      const left=x-CELL/2,right=x+CELL/2;
      result.set(id,{...appearance,offset:left-crossing.bounds.minX,
        ends:[[left,walkY+bridgeRise(grade,left),z],[right,walkY+bridgeRise(grade,right),z]]});
    }
  }
  return result;
}
