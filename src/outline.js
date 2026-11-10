// Metres. Use the same tolerance for edge contact and containment.
export const EDGE_EPSILON = 1e-8;

export function boxOutline({minX,minZ,maxX,maxZ}) {
  return [[minX,minZ],[maxX,minZ],[maxX,maxZ],[minX,maxZ]];
}

export function transformOutline(points,x,z,radians) {
  const c=Math.cos(radians),s=Math.sin(radians);
  return points.map(([u,v])=>[x+u*c+v*s,z-u*s+v*c]);
}

export function outlineBounds(points) {
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(const [x,z] of points){
    minX=Math.min(minX,x);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxZ=Math.max(maxZ,z);
  }
  return {minX,minZ,maxX,maxZ};
}

export function boundsContain(outer,inner,tolerance=0) {
  return inner.minX>=outer.minX-tolerance&&inner.minZ>=outer.minZ-tolerance
    &&inner.maxX<=outer.maxX+tolerance&&inner.maxZ<=outer.maxZ+tolerance;
}

function project(points,x,z) {
  let min=Infinity,max=-Infinity;
  for(const point of points){
    const p=point[0]*x+point[1]*z;
    min=Math.min(p,min);max=Math.max(p,max);
  }
  return [min,max];
}

// Separating axes of both convex outlines. A shared point or edge is legal.
export function outlinesOverlap(a,b) {
  for(const points of [a,b])for(let i=0;i<points.length;i++){
    const [x,z]=points[i], [u,v]=points[(i+1)%points.length];
    const length=Math.hypot(u-x,v-z);
    if(!length)continue;
    const nx=(v-z)/length,nz=(x-u)/length;
    const [a0,a1]=project(a,nx,nz),[b0,b1]=project(b,nx,nz);
    if(a1<=b0+EDGE_EPSILON||b1<=a0+EDGE_EPSILON)return false;
  }
  return true;
}

export function outlineContains(points,x,z) {
  let positive=false,negative=false;
  for(let i=0;i<points.length;i++){
    const [a,b]=points[i],[c,d]=points[(i+1)%points.length];
    const cross=(c-a)*(z-b)-(d-b)*(x-a);
    positive ||= cross>EDGE_EPSILON;
    negative ||= cross< -EDGE_EPSILON;
    if(positive&&negative)return false;
  }
  return true;
}
