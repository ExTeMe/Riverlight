import { CELL, BY_ID } from './catalog.js';
import { placementAnchor } from './parcel.js';
import { riverCenter, riverWidth } from './core.js';
import { getTemplate } from './models.js';
import { ROAD_DIRECTIONS, cornerHeight, cornerPoint, hasTraffic } from './road-network.js';

const length=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function buildWalkNetwork(city){
  const network=city.roadNetwork;
  const nodes=new Map(),connectors=[],roadNodes=new Set(),destinations=[];
  const node=(x,y,z,kind='sidewalk')=>{
    const id=`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    if(!nodes.has(id))nodes.set(id,{id,x,y,z,kind,edges:new Map()});
    return nodes.get(id);
  };
  const link=(a,b,kind='walk')=>{if(!a||!b||a===b)return;a.edges.set(b.id,kind);b.edges.set(a.id,kind);};
  const entityAt=(x,z)=>city.at(Math.floor((x/CELL+.5)*2)/2,Math.floor((z/CELL+.5)*2)/2)??city.nativeAt(x,z);
  const clear=(a,b,ignore)=>{
    const n=Math.ceil(length(a,b)/.5);
    for(let i=0;i<=n;i++){
      const t=i/Math.max(n,1),x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,e=entityAt(x,z);
      if(e&&e.id!==ignore&&(BY_ID[e.type].floors||e.type==='amusement'||e.type==='road'))return false;
      if(Math.abs(x-riverCenter(z,city.terrain))<riverWidth(z,city.terrain)-.15&&e?.type!=='bridge'&&e?.type!=='pier')return false;
    }return true;
  };
  for(const segment of network.segments.values())if(hasTraffic(segment.kind)){
    if(segment.sidewalks){
      for(const {points} of segment.sidewalks){
        let prev;
        for(const point of points){const n=node(...point);roadNodes.add(n);link(prev,n);prev=n;}
      }
      continue;
    }
    const {center:[x,,z],profile,ports,mask,corner}=segment,y=profile.walkY,offset=profile.sidewalks[1].offset;
    const add=(px,pz,py=y)=>{const n=node(x+px,py,z+pz);roadNodes.add(n);return n;};
    if(corner){
      const [sx,sz]=corner,half=profile.width/2;
      const start=ports.find(port=>ROAD_DIRECTIONS[port.side][0]===sx).walkY;
      const end=ports.find(port=>ROAD_DIRECTIONS[port.side][1]===sz).walkY;
      for(const radius of [half-offset,half+offset]){let prev;for(let i=0;i<=12;i++){
        const [dx,dz]=cornerPoint(sx,sz,radius,i*Math.PI/24);
        const n=add(dx,dz,cornerHeight(y,start,end,i/12));link(prev,n);prev=n;
      }}
    }else{
      const corners=[add(-offset,-offset),add(offset,-offset),add(offset,offset),add(-offset,offset)];
      // Each edge is pavement unless a road exits through it. Cross only at marked junctions.
      const edgeDirs=[3,0,2,1];
      for(let i=0;i<4;i++){
        const crosses=mask&(1<<edgeDirs[i]);
        if(!crosses||(!segment.junction&&ports.length!==2))link(corners[i],corners[(i+1)%4],crosses?'crossing':'walk');
      }
      for(const crossing of segment.junction?.crossings??[]){
        const i=edgeDirs.indexOf(crossing.side),a=corners[i],b=corners[(i+1)%4];
        const ends=crossing.ends.map(([u,v])=>add(u,v));
        if(length(a,ends[0])>length(a,ends[1]))ends.reverse();
        link(a,ends[0]);link(ends[0],ends[1],'crossing');link(ends[1],b);
      }
      for(const port of ports){
        const [dx,dz]=ROAD_DIRECTIONS[port.side];
        for(const side of [-1,1]){
          const end=node(port.point[0]-dz*side*offset,port.walkY,port.point[2]+dx*side*offset);
          roadNodes.add(end);
          const near=corners.reduce((best,n)=>length(n,end)<length(best,end)?n:best);link(near,end);
        }
      }
    }
  }
  // Arc endpoints share the neighbouring straight pavement's world coordinates.
  const roadList=[...roadNodes];
  const nearest=(n,candidates,max,ignore)=>{let best,dist=max;for(const candidate of candidates){const d=length(n,candidate);if(d>0.01&&d<dist&&clear(n,candidate,ignore)){best=candidate;dist=d;}}return best;};
  const connect=(n,candidates,max,ignore)=>{const to=nearest(n,candidates,max,ignore);if(to){link(n,to);connectors.push([n,to]);}return to;};
  const pathNodes=new Map();
  for(const s of network.segments.values())if(s.kind==='path')pathNodes.set(s.id,node(s.center[0],s.profile.walkY,s.center[2],'path'));
  const paths=[...pathNodes.values()];
  for(const [id,p] of pathNodes){
    for(const port of network.segments.get(id).ports){const q=pathNodes.get(port.neighborId);if(clear(p,q))link(p,q);}
    connect(p,roadList,4.8);
  }
  const quays=[];
  if(roadList.length||paths.length)for(const side of [-1,1]){
    let prev;
    for(let z=-108;z<=108;z+=2){
      const x=riverCenter(z,city.terrain)+side*(riverWidth(z,city.terrain)+1.7),e=entityAt(x,z);
      if(e&&(BY_ID[e.type].floors||hasTraffic(e.type)||e.type==='amusement')){prev=null;continue;}
      const n=node(x,.12,z,'quay');if(prev&&clear(prev,n))link(prev,n);prev=n;quays.push(n);
      connect(n,roadList,2.7);if(z%4===0)connect(n,paths,4);
    }
  }
  const walking=[...roadList,...paths,...quays];
  for(const e of city.entities.values())if(BY_ID[e.type].floors||['park','plaza','garden','amusement'].includes(e.type)){
    const anchor=e.pose&&getTemplate(e.type,e.color).userData.anchors?.entrance;
    const fallback=[0,.14,BY_ID[e.type].d*CELL/2+.35*(e.lot?BY_ID[e.type].d/e.lot[1]:1)];
    const [x,,z]=placementAnchor(e,anchor||fallback);
    const n=node(x,.14,z,'destination');if(connect(n,walking,7,e.id))destinations.push(n);
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
