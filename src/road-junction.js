import { CELL } from './catalog.js';

export const ROAD_DIRECTIONS = Object.freeze([[1,0],[-1,0],[0,1],[0,-1]].map(Object.freeze));
export const VEHICLE_ENVELOPES = Object.freeze({
  car: Object.freeze({width:1.52,length:2.56}),
  bus: Object.freeze({width:1.52,length:3.96}),
});

const edge=CELL/2;
const cross=([x,z],[u,v])=>x*v-z*u;
const minus=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const square=(left,back,right,front)=>[[left,back],[right,back],[right,front],[left,front]];
const area=polygon=>polygon.reduce((sum,p,i)=>sum+cross(p,polygon[(i+1)%polygon.length]),0)/2;
const ccw=polygon=>area(polygon)<0?polygon.reverse():polygon;
export const sidePoint=(side,distance,offset=0)=>{
  const [x,z]=ROAD_DIRECTIONS[side];
  return [x*distance-z*offset,z*distance+x*offset];
};

const layoutCache=new Map();
export function junctionLayout(mask,profile){
  const key=`${mask}:${profile.carriageway}`;
  if(layoutCache.has(key))return layoutCache.get(key);
  const half=profile.carriageway/2,asphalt=[square(-half,-half,half,half)],pavement=[],paint=[];
  const sides=ROAD_DIRECTIONS.flatMap((_,side)=>mask&(1<<side)?[side]:[]);
  const kind=({1:'terminal',3:'tee',4:'cross'})[sides.length];
  const strip=(side,from,to,left,right)=>ccw([[from,left],[to,left],[to,right],[from,right]].map(([d,l])=>sidePoint(side,d,l)));
  for(let side=0;side<4;side++){
    const target=sides.includes(side)?asphalt:pavement;
    target.push(strip(side,half,edge,-half,half));
  }
  for(const x of [-1,1])for(const z of [-1,1]){
    const corner=points=>ccw(points.map(([a,b])=>[x*a,z*b]));
    if(sides.includes(x>0?0:1)&&sides.includes(z>0?2:3)){
      asphalt.push(corner([[half,half],[edge,half],[half,edge]]));
      pavement.push(corner([[edge,edge],[half,edge],[edge,half]]));
    }else pavement.push(corner(square(half,half,edge,edge)));
  }
  const crossings=[];
  if(kind==='tee'||kind==='cross')for(const side of sides){
    const distance=1.8,stopDistance=1.96;
    const {offset,width}=profile.lanes[1];
    paint.push(strip(side,stopDistance-.026,stopDistance+.026,-offset-width/2,-offset+width/2));
    for(let i=-3;i<=3;i++)paint.push(strip(side,distance-.095,distance+.095,i*.44-.108,i*.44+.108));
    crossings.push({side,distance,stopDistance,ends:[-1,1].map(sign=>sidePoint(side,distance,sign*1.9))});
  }
  if(kind==='terminal'){
    const side=sides[0],{offset,width}=profile.lanes[1];
    paint.push(strip(side,-half+.12,-half+.18,-offset-width/2,-offset+width/2));
    paint.push(strip(side,-.22,1.22,-.025,.025));
  }
  if(mask===3||mask===12||mask===0)paint.push(strip(mask===12?2:0,-.65,.65,-.027,.027));
  const layout={kind,asphalt,pavement,paint,crossings};
  layoutCache.set(key,layout);
  return layout;
}

function clip(subject,polygon){
  let result=subject;
  for(const [i,a] of polygon.entries()){
    if(!result.length)break;
    const tangent=minus(polygon[(i+1)%polygon.length],a);
    const input=result;result=[];
    let prev=input.at(-1),before=cross(tangent,minus(prev,a));
    for(const p of input){
      const after=cross(tangent,minus(p,a));
      if((after>=0)!==(before>=0))result.push(prev.map((n,k)=>n+(p[k]-n)*before/(before-after)));
      if(after>=0)result.push(p);
      prev=p;before=after;
    }
  }
  return result;
}

export function vehicleOutline({point:[x,z],direction:[dx,dz]},envelope,padding=0){
  const w=envelope.width/2+padding,l=envelope.length/2+padding;
  return square(-l,-w,l,w).map(([s,t])=>[x+s*dx-t*dz,z+s*dz+t*dx]);
}

function bounds(points){
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
  return [Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];
}

function covered(outline,patches){
  const [x,z,u,v]=bounds(outline);
  const size=patches.reduce((sum,{polygon,bounds:[l,b,r,f]})=>
    sum+(x<r&&u>l&&z<f&&v>b?area(clip(outline,polygon)):0),0);
  return area(outline)-size<1e-7;
}

function movement(from,to,offset){
  const a=sidePoint(from,edge,-offset),d=sidePoint(to,edge,offset);
  const entry=sidePoint(from,-1),exit=sidePoint(to,1),angle=cross(entry,exit);
  const kind=angle>0?'right':angle<0?'left':'straight';
  // A left turn keeps the vehicle aligned while its rear crosses the entry seam.
  const handle=kind==='left'?2.76:kind==='right'?.92:CELL/3;
  const b=a.map((n,i)=>n+entry[i]*handle),c=d.map((n,i)=>n-exit[i]*handle);
  const samples=[];let length=0;
  for(let i=0;i<=128;i++){
    const t=i/128,u=1-t;
    const point=a.map((n,k)=>u**3*n+3*u*u*t*b[k]+3*u*t*t*c[k]+t**3*d[k]);
    const velocity=a.map((n,k)=>u*u*(b[k]-n)+2*u*t*(c[k]-b[k])+t*t*(d[k]-c[k]));
    const speed=Math.hypot(...velocity);
    if(i)length+=Math.hypot(...minus(point,samples.at(-1).point));
    samples.push({point,direction:velocity.map(n=>n/speed),distance:length});
  }
  return {from,to,kind,samples,length};
}

// Surrounding patches are in junction-local metres, with disjoint tile interiors.
export function buildJunction(mask,profile,approaches){
  const layout=junctionLayout(mask,profile);
  if(!layout.kind)return null;
  const {offset,width}=profile.lanes[1],sides=[...approaches.keys()];
  const patches=[...layout.asphalt,...[...approaches.values()].flat()]
    .map(polygon=>({polygon,bounds:bounds(polygon)}));
  const movements=[];
  if(layout.kind==='terminal'&&sides.length){
    const from=sides[0],direction=sidePoint(from,-1);
    for(const [vehicle,envelope] of Object.entries(VEHICLE_ENVELOPES)){
      const start=sidePoint(from,edge,-offset),end=sidePoint(from,envelope.length/2-profile.carriageway/2+.22,-offset);
      const length=Math.hypot(...minus(end,start));
      const samples=[{point:start,direction,distance:0},{point:end,direction,distance:length}];
      if(envelope.width<=width&&samples.every(sample=>covered(vehicleOutline(sample,envelope,.02),patches))){
        movements.push({from,to:null,kind:'stop',samples,length,vehicles:[vehicle]});
      }
    }
  }else for(const from of sides)for(const to of sides)if(from!==to){
    const route=movement(from,to,offset);
    const vehicles=Object.entries(VEHICLE_ENVELOPES).filter(([,size])=>size.width<=width&&
      route.samples.every(sample=>covered(vehicleOutline(sample,size,.02),patches))).map(([name])=>name);
    if(vehicles.length)movements.push({...route,vehicles});
  }
  return {...layout,movements};
}

export function arcAsphalt(corner,profile,point){
  const [sx,sz]=corner,half=profile.carriageway/2;
  const pairs=Array.from({length:25},(_,i)=>[edge-half,edge+half].map(radius=>point(sx,sz,radius,i*Math.PI/48)));
  return pairs.slice(1).map((pair,i)=>ccw([...pairs[i],...pair.slice().reverse()]));
}
