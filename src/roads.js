import * as T from 'three';
import { ROAD_DIRECTIONS, ROAD_PROFILES, cornerPoint, roadCorner } from './road-network.js';
import { offsetRoadSample } from './road-alignment.js';

export function createAlignmentMesh(geometry,ports,material){
  const group=new T.Group(),asphalt=[],paving=[],marks=[];
  const {width,carriageway,bedY,vehicleY,walkY}=ROAD_PROFILES.road;
  const half=width/2,edge=carriageway/2,road=vehicleY-bedY,walk=walkY-bedY;
  const {samples}=geometry;
  const quad=(out,a,b,c,d)=>out.push(...a,...b,...c,...a,...c,...d);
  const surface=(out,a,b,left,right,height)=>quad(out,offsetRoadSample(a,right,height),
    offsetRoadSample(b,right,height),offsetRoadSample(b,left,height),offsetRoadSample(a,left,height));
  const wall=(a,b,offset,top,bottom)=>quad(paving,offsetRoadSample(a,offset,top),
    offsetRoadSample(a,offset,bottom(a)),offsetRoadSample(b,offset,bottom(b)),offsetRoadSample(b,offset,top));
  let distance=0;
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i];
    surface(asphalt,a,b,-edge,edge,road);
    surface(paving,a,b,-half,-edge,walk);
    surface(paving,a,b,edge,half,walk);
    wall(b,a,-half,walk,s=>-.03-s.point[1]);
    wall(a,b,half,walk,s=>-.03-s.point[1]);
    wall(a,b,-edge,walk,()=>road);
    wall(b,a,edge,walk,()=>road);
    const step=Math.hypot(b.point[0]-a.point[0],b.point[2]-a.point[2]);
    if((distance+step/2)%5<1.5)surface(marks,a,b,-.035,.035,road+.008);
    distance+=step;
  }
  for(const [end,sample] of [[0,samples[0]],[1,samples.at(-1)]])if(!ports.some(port=>port.end===end)){
    const floor=-.03-sample.point[1];
    for(const [left,right,top] of [[-half,-edge,walk],[-edge,edge,road],[edge,half,walk]]){
      const [a,b]=end?[right,left]:[left,right];
      quad(paving,offsetRoadSample(sample,a,top),offsetRoadSample(sample,a,floor),
        offsetRoadSample(sample,b,floor),offsetRoadSample(sample,b,top));
    }
  }
  for(const [points,color,role] of [[asphalt,'#677378','road'],[paving,'#c9c9bd','ground'],[marks,'#e8dfbc','road']]){
    if(!points.length)continue;
    const buffer=new T.BufferGeometry();
    buffer.setAttribute('position',new T.Float32BufferAttribute(points,3));buffer.computeVertexNormals();
    const mesh=new T.Mesh(buffer,material(color,role));mesh.receiveShadow=true;mesh.castShadow=role==='ground';group.add(mesh);
  }
  return group;
}

// A connected corner is an annular road, with tangent joins at the tile edges.
export function createRoad(type,mask,{Builder,material}){
  const b=new Builder(),bridge=type==='bridge',path=type==='path';
  const {bedY:y,width,carriageway}=ROAD_PROFILES[type],half=width/2;
  const asphalt=material('#677378','road'),paving=material('#c9c9bd','ground'),paint=material('#e8dfbc','road');
  const connected=ROAD_DIRECTIONS.filter((_,i)=>mask&(1<<i)),corner=roadCorner(mask);
  const strip=(sx,sz,inner,outer,height,m,start=0,end=Math.PI/2)=>{
    const p=[],n=24;
    for(let i=0;i<n;i++){
      const a=start+(end-start)*i/n,c=start+(end-start)*(i+1)/n;
      const v=(r,t)=>{const [x,z]=cornerPoint(sx,sz,r,t);return [x,height,z];};
      const vs=[...v(inner,a),...v(outer,a),...v(outer,c),...v(inner,a),...v(outer,c),...v(inner,c)];
      // Keep upward winding on every mirrored corner.
      if(sx*sz<0)for(let j=0;j<vs.length;j+=9){const first=vs.slice(j,j+3);vs.splice(j,3,...vs.slice(j+6,j+9));vs.splice(j+6,3,...first);}
      p.push(...vs);
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.computeVertexNormals();b.geo(g,m);
  };
  if(corner&&!bridge&&!path){
    const [sx,sz]=corner;
    strip(sx,sz,.08,width-.08,y+.04,paving);strip(sx,sz,half-carriageway/2,half+carriageway/2,y+.065,asphalt);
    for(let i=0;i<3;i++)strip(sx,sz,half-.03,half+.03,y+.07,paint,.14+i*.46,.35+i*.46);
    const result=b.finish();result.userData.roadShape='arc';return result;
  }
  b.box(width,.14,width,0,y-.07,0,path?material('#cbc1a6','ground'):paving);
  if(!path){
    b.box(carriageway,.02,carriageway,0,y+.02,0,asphalt);
    connected.forEach(([dx,dz])=>b.box(dx?.55:carriageway,.02,dz?.55:carriageway,dx*1.73,y+.02,dz*1.73,asphalt));
    if(mask===3||mask===12||mask===0)b.box(mask===12?.055:1.25,.01,mask===12?1.25:.055,0,y+.035,0,paint);
    if(connected.length!==2)for(const [dx,dz] of connected)for(let i=0;i<5;i++)b.box(dx?.48:.22,.008,dz?.48:.22,dx?dx*1.72:-.9+i*.45,y+.036,dz?dz*1.72:-.9+i*.45,paint);
    if(bridge){const horizontal=mask!==12;for(const side of [-1,1]){
      b.box(horizontal?4:.12,.12,horizontal?.12:4,horizontal?0:side*1.8,y+1,horizontal?side*1.8:0,paving);
      for(const p of [-1.6,0,1.6])b.box(.09,.85,.09,horizontal?p:side*1.8,y+.5,horizontal?side*1.8:p,paving);
    }b.box(.6,1.9,.6,0,-.55,0,paving);}
  }
  return b.finish();
}
