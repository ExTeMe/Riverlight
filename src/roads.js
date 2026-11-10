import * as T from 'three';
import { ROAD_PROFILES, gridRoadSurface, roadCorner } from './road-network.js';
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
  const {bedY:y,width,vehicleY,walkY}=ROAD_PROFILES[type];
  if(path){b.box(width,walkY,width,0,walkY/2,0,material('#cbc1a6','ground'));return b.finish();}
  const asphalt=material('#677378','road'),paving=material('#c9c9bd','ground'),paint=material('#e8dfbc','road');
  const corner=!bridge&&roadCorner(mask),layout=gridRoadSurface(type,mask);
  if(!corner)b.box(width,.14,width,0,y-.07,0,paving);
  for(const [polygons,height,m] of [[layout.asphalt,vehicleY,asphalt],[layout.pavement,walkY,paving],[layout.paint,vehicleY+.006,paint]]){
    const vertices=[];
    for(const [first,...rest] of polygons)for(let i=1;i<rest.length;i++){
      for(const [x,z] of [first,rest[i],rest[i-1]])vertices.push(x,height,z);
    }
    if(!vertices.length)continue;
    const buffer=new T.BufferGeometry();buffer.setAttribute('position',new T.Float32BufferAttribute(vertices,3));buffer.computeVertexNormals();b.geo(buffer,m);
  }
  if(bridge){const horizontal=mask!==12;for(const side of [-1,1]){
      b.box(horizontal?4:.12,.12,horizontal?.12:4,horizontal?0:side*1.8,y+1,horizontal?side*1.8:0,paving);
      for(const p of [-1.6,0,1.6])b.box(.09,.85,.09,horizontal?p:side*1.8,y+.5,horizontal?side*1.8:p,paving);
    }b.box(.6,1.9,.6,0,-.55,0,paving);
  }
  const result=b.finish();if(corner)result.userData.roadShape='arc';return result;
}
