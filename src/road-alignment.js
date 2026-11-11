import { CELL } from './catalog.js';
import { boundsContain, outlineBounds, outlineContains, outlinesOverlap } from './outline.js';

const MIN_LENGTH = 6;
const MAX_LENGTH = 120;
const MIN_RADIUS = 6;
export const MAX_ROAD_HEIGHT = 8;
export const MAX_ELEVATED_ROAD_HEIGHT = 32;
export const MAX_ROAD_GRADE = .12;
const HALF_WIDTH = CELL / 2;
const cache = new WeakMap();
const dot = ([x,z],[u,v]) => x*u+z*v;
const cross = ([x,z],[u,v]) => x*v-z*u;
const mid = (a,b) => a.map((v,i)=>(v+b[i])/2);
export const roadBearing = (a,b) => Math.atan2(b[2]-a[2],b[0]-a[0])*180/Math.PI;
export const normalBearing = angle => {const wrapped=angle%360;return wrapped<0?wrapped+360:wrapped||0;};

export function matchingRoadEnds(a,i,b,j) {
  if(a[1]!==b[1])return false;
  const angle=normalBearing(a[3]-b[3]+(i===j?180:0));
  return Math.min(angle,360-angle)<1e-10;
}

export function readAlignment(raw) {
  if(raw?.elevated!==undefined&&typeof raw.elevated!=='boolean')throw new Error('高架道路标记无效');
  const maxHeight=raw?.elevated?MAX_ELEVATED_ROAD_HEIGHT:MAX_ROAD_HEIGHT;
  const read = point => {
    if(!Array.isArray(point)||point.length!==4||!point.every(Number.isFinite)
      ||Math.abs(point[0])>20000||Math.abs(point[2])>20000||point[1]<0||point[1]>maxHeight){
      throw new Error(`道路端点无效，高度须为 0–${maxHeight} 米`);
    }
    const [x,y,z,bearing]=point;
    return Object.freeze([x,y,z,normalBearing(bearing)]);
  };
  return Object.freeze({start:read(raw?.start),end:read(raw?.end),...(raw.elevated?{elevated:true}:{})});
}

// Bound curvature and grade over the whole cubic. The derivative is a
// quadratic Bézier and its acceleration is linear on each subdivided interval.
function limits(velocity,forward,rise,start=0,end=1,depth=0) {
  const speed=Math.min(...velocity.map(v=>dot(v,forward)));
  const acceleration=velocity.slice(1).map((v,i)=>v.map((n,k)=>2*(n-velocity[i][k])/(end-start)));
  const crossProducts=velocity.flatMap(v=>acceleration.map(a=>Math.abs(cross(v,a))));
  const curvature=Math.max(...crossProducts)/speed**3;
  const peak=Math.max(start,Math.min(.5,end));
  const grade=6*rise*peak*(1-peak)/speed;
  const safeRadius=curvature<=1/MIN_RADIUS+1e-10,safeGrade=grade<=MAX_ROAD_GRADE+1e-10;
  if(safeRadius&&safeGrade)return null;
  if(depth===8)return safeRadius?'坡度超过 12%，请拉长道路或减小高差':'弯曲半径不足 6 米，请拉长道路或减小转角';
  const [a,b,c]=velocity,ab=mid(a,b),bc=mid(b,c),m=mid(ab,bc),t=(start+end)/2;
  return limits([a,ab,m],forward,rise,start,t,depth+1)??limits([m,bc,c],forward,rise,t,end,depth+1);
}

export function offsetRoadSample(sample,offset,height=0) {
  const {point:[x,y,z],direction:[dx,dz]}=sample;
  return [x-dz*offset,y+height,z+dx*offset];
}

function horizontalAlignment([x,,z,a],[u,,w,b]){
  const length=Math.hypot(u-x,w-z);
  if(length<MIN_LENGTH||length>MAX_LENGTH)return {error:`端点距离须为 ${MIN_LENGTH}–${MAX_LENGTH} 米`};
  const unit=angle=>{
    angle=normalBearing(angle);
    const radians=(angle%180)*Math.PI/180,sign=angle>=180?-1:1;
    return [sign*Math.cos(radians),sign*Math.sin(radians)];
  };
  const forward=[(u-x)/length,(w-z)/length], first=unit(a),last=unit(b);
  if(Math.min(dot(first,forward),dot(last,forward))<.5)return {error:'端点方向与连线最多可偏转 60°'};
  const velocity=[first,forward.map((n,i)=>3*n-first[i]-last[i]),last].map(p=>p.map(n=>n*length));
  return {length,first,last,forward,velocity};
}

// Use the same full-curve grade check as placement. Round down to centimetres
// so a height offered by the editor can pass the grade check.
export function maxRoadRise(start,end){
  const {forward,velocity,error}=horizontalAlignment(start,end);
  if(error||limits(velocity,forward,0))return null;
  let low=0,high=MAX_ELEVATED_ROAD_HEIGHT*100;
  while(low<high){
    const mid=Math.ceil((low+high)/2);
    if(limits(velocity,forward,mid/100))high=mid-1;
    else low=mid;
  }
  return low/100;
}

export function alignmentGeometry(alignment) {
  if(cache.has(alignment))return cache.get(alignment);
  const {start:[x,y,z],end:[u,v,w]}=alignment;
  const {length,first,last,forward,velocity,error}=horizontalAlignment(alignment.start,alignment.end);
  if(error)return {error};
  const [p,q,r]=velocity;
  const segments=Math.ceil(length/.5),samples=[];
  let minRadius=Infinity,maxGrade=0;
  for(let i=0;i<=segments;i++){
    const t=i/segments,s=1-t;
    const direction=p.map((n,k)=>s*s*n+2*s*t*q[k]+t*t*r[k]);
    const speed=Math.hypot(...direction);
    const accel=p.map((n,k)=>2*(s*(q[k]-n)+t*(r[k]-q[k])));
    const curve=Math.abs(cross(direction,accel))/speed**3;
    if(curve>1e-10)minRadius=Math.min(minRadius,1/curve);
    maxGrade=Math.max(maxGrade,6*Math.abs(v-y)*s*t/speed);
    const point=i===segments?[u,v,w]:[x+s*s*t*p[0]+3*s*t*t*(u-x-r[0]/3)+t**3*(u-x),
      y+(v-y)*t*t*(3-2*t),z+s*s*t*p[1]+3*s*t*t*(w-z-r[1]/3)+t**3*(w-z)];
    samples.push({point,direction:i===0?first:i===segments?last:direction.map(n=>n/speed)});
  }
  const edges=offset=>samples.map(sample=>{const [px,,pz]=offsetRoadSample(sample,offset);return [px,pz];});
  const left=edges(-HALF_WIDTH),right=edges(HALF_WIDTH);
  const sections=left.slice(1).map((p,i)=>{
    const outline=[left[i],right[i],right[i+1],p];
    const y=samples[i].point[1],nextY=samples[i+1].point[1];
    return {outline,bounds:outlineBounds(outline),minY:Math.min(y,nextY),maxY:Math.max(y,nextY)};
  });
  const geometry={samples,sections,bounds:outlineBounds([...left,...right]),minRadius,maxGrade,
    error:limits(velocity,forward,Math.abs(v-y))};
  if(!geometry.error&&sections.some((a,i)=>sections.slice(i+2).some(b=>sectionsOverlap(a,b)))){
    geometry.error='道路边缘自交，请拉长道路或减小转角';
  }
  cache.set(alignment,geometry);
  return geometry;
}

export function roadOverlaps(alignment,outline,other) {
  const sections=alignmentGeometry(alignment).sections;
  const candidates=other?alignmentGeometry(other).sections:[{outline,bounds:outlineBounds(outline)}];
  return sections.some(a=>candidates.some(b=>sectionsOverlap(a,b)));
}

export function sectionsOverlap(a,b) {
  const u=a.bounds,v=b.bounds;
  return u.maxX>v.minX&&v.maxX>u.minX&&u.maxZ>v.minZ&&v.maxZ>u.minZ&&outlinesOverlap(a.outline,b.outline);
}

export function roadContains(alignment,x,z) {
  const point={minX:x,maxX:x,minZ:z,maxZ:z};
  return alignmentGeometry(alignment).sections.some(s=>boundsContain(s.bounds,point)&&outlineContains(s.outline,x,z));
}
