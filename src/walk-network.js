import { CELL, BY_ID } from './catalog.js';
import { footprintOutline, parcelOnLand, placementAnchor, placementOf } from './parcel.js';
import { boundsContain, outlineBounds, outlineContains, outlinesOverlap } from './outline.js';
import { SpatialIndex } from './space.js';
import { getTemplate } from './models.js';
import { hasTraffic, roadCarriageway } from './road-network.js';

export const WALK_LINK_HALF_WIDTH=.13;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const publicPlaces=new Set(['park','plaza','garden','amusement','pier']);

function searchNodes(nodes){
  const index=new SpatialIndex(8);
  nodes.forEach(({x,z},id)=>index.insert(id,{minX:x-.001,minZ:z-.001,maxX:x+.001,maxZ:z+.001}));
  return ({x,z},max)=>index.query({minX:x-max,minZ:z-max,maxX:x+max,maxZ:z+max}).map(id=>nodes[id]);
}

function strip(a,b){
  const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
  if(length<1e-8)return null;
  const x=-dz/length*WALK_LINK_HALF_WIDTH,z=dx/length*WALK_LINK_HALF_WIDTH;
  return [[a.x+x,a.z+z],[b.x+x,b.z+z],[b.x-x,b.z-z],[a.x-x,a.z-z]];
}

export function buildWalkNetwork(city){
  const network=city.roadNetwork,carriageways=new Map();
  const nodes=new Map(),connectors=[],roadNodes=new Set(),pathNodes=new Set(),destinations=[];
  const node=(x,y,z,kind='sidewalk')=>{
    const id=`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    if(!nodes.has(id))nodes.set(id,{id,x,y,z,kind,edges:new Map()});
    return nodes.get(id);
  };
  const link=(a,b,kind='walk')=>{if(!a||!b||a===b)return;a.edges.set(b.id,kind);b.edges.set(a.id,kind);};
  const clear=(a,b,owner)=>{
    const outline=strip(a,b);if(!outline)return false;
    const run=Math.hypot(a.x-b.x,a.z-b.z);
    if(Math.abs(a.y-b.y)>.12+run*.12)return false;
    const bounds=outlineBounds(outline);
    if(!boundsContain(city.worldBounds(),bounds)||!parcelOnLand(outline,bounds,city.terrain))return false;
    for(const entity of city.queryFootprints(bounds)){
      const segment=network.segments.get(entity.id);
      if(segment&&hasTraffic(entity.type)){
        if(!carriageways.has(entity.id))carriageways.set(entity.id,roadCarriageway(segment));
        if(carriageways.get(entity.id).some(surface=>outlinesOverlap(outline,surface)))return false;
        continue;
      }
      const blocks=BY_ID[entity.type].floors||publicPlaces.has(entity.type)||entity.type==='grove'||entity.type==='tree';
      if(!blocks)continue;
      const footprint=footprintOutline(entity);
      if(!outlinesOverlap(outline,footprint))continue;
      if(owner?.id===entity.id&&outlineContains(footprint,a.x,a.z)&&
        (b.x-a.x)*(a.x-owner.x)+(b.z-a.z)*(a.z-owner.z)>0)continue;
      return false;
    }
    return true;
  };
  for(const segment of network.segments.values()){
    const path=segment.kind==='path',list=path?pathNodes:roadNodes,kind=path?'path':'sidewalk';
    if(path){const [x,,z]=segment.center;list.add(node(x,segment.profile.walkY,z,kind));}
    for(const line of segment.walkways){
      let previous;
      for(const point of line.points){
        const current=node(...point,kind);list.add(current);
        if(previous&&(!path||clear(previous,current)))link(previous,current,line.kind);
        previous=current;
      }
    }
  }
  const connect=(a,search,max,owner)=>{
    let nearest,best=max;
    for(const b of search(a,max)){
      const d=distance(a,b);
      if(d>.015&&d<best&&clear(a,b,owner)){nearest=b;best=d;}
    }
    if(nearest){link(a,nearest);connectors.push([a,nearest]);}
    return nearest;
  };
  const roads=searchNodes([...roadNodes]),paths=searchNodes([...pathNodes]);
  for(const a of pathNodes)connect(a,roads,4.8);
  const quays=new Set();
  if(roadNodes.size||pathNodes.size)for(const {points} of city.waterfront){
    const [a,b]=points.map(p=>node(...p,'quay'));
    link(a,b);quays.add(a);quays.add(b);
  }
  for(const current of quays){
    connect(current,roads,2.7);if(current.z%4===0)connect(current,paths,4);
  }
  const walking=searchNodes([...roadNodes,...pathNodes,...quays].filter(n=>n.edges.size));
  for(const entity of city.entities.values())if(BY_ID[entity.type].floors||publicPlaces.has(entity.type)){
    const anchor=getTemplate(entity.type,entity.color).userData.anchors?.entrance;
    const fallback=[0,.14,BY_ID[entity.type].d*CELL/2+.35*(entity.lot?BY_ID[entity.type].d/entity.lot[1]:1)];
    const [x,y,z]=placementAnchor(entity,anchor||fallback),a=node(x,y,z,'destination');
    if(connect(a,walking,7,{...placementOf(entity),id:entity.id})){
      a.entityId=entity.id;destinations.push(a);
    }
  }
  // Disconnected points never produce people. Component membership bounds route choices.
  for(const [id,n] of nodes)if(!n.edges.size)nodes.delete(id);
  const components=[],seen=new Set();
  for(const n of nodes.values())if(!seen.has(n.id)){
    const group=[],queue=[n];seen.add(n.id);
    for(let i=0;i<queue.length;i++){const v=queue[i];group.push(v);for(const id of v.edges.keys())if(!seen.has(id)&&nodes.has(id)){seen.add(id);queue.push(nodes.get(id));}}
    if(group.length>6)components.push(group);
  }
  return {revision:network.revision,nodes,components,connectors,destinations};
}

export function walkingRoute(network,start,seed,steps=55){
  const route=[start];let previous=null,current=start,n=seed>>>0;
  for(let i=0;i<steps;i++){
    let options=[...current.edges.keys()].filter(id=>id!==previous&&network.nodes.has(id));
    if(!options.length)options=[...current.edges.keys()];if(!options.length)break;
    n=(Math.imul(n,1664525)+1013904223)>>>0;
    const next=network.nodes.get(options[n%options.length]);previous=current.id;route.push(next);current=next;
    if(current.kind==='destination'&&i>8)break;
  }return route;
}
