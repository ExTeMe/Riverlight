import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_PROFILES, gridRoadSurface, roadCorner } from './road-network.js';
import { offsetRoadSample } from './road-alignment.js';
import { bridgeRise, DECK_DEPTH, PIER_BASE } from './bridges.js';
import { ROAD_DECK_BOTTOM, ROAD_RAIL_TOP, roadSupports } from './elevated-roads.js';

function tileSurface(polygons,point){
  const vertices=[];
  for(const [first,...rest] of polygons)for(let i=1;i<rest.length;i++){
    vertices.push(...point(...first),...point(...rest[i]),...point(...rest[i-1]));
  }
  if(!vertices.length)return null;
  const buffer=new T.BufferGeometry();
  buffer.setAttribute('position',new T.Float32BufferAttribute(vertices,3));buffer.computeVertexNormals();
  return buffer;
}

export function createBridgeRoad(segment,rotation,material){
  const {kind,center:[x,,z],profile:{width,carriageway,vehicleY,walkY},surface,grade,bridge,mask}=segment;
  const group=new T.Group(),batches=new Map(),paving=material('#c9c9bd','ground'),structure=material('#9ca3a0','ground');
  const rise=px=>bridgeRise(grade,px);
  const add=(geometry,mat)=>{
    if(!batches.has(mat))batches.set(mat,[]);
    batches.get(mat).push(geometry);
  };
  const box=(px,pz,w,d,bottom,top,mat)=>{
    const indexed=new T.BoxGeometry(w,1,d),geometry=indexed.toNonIndexed(),position=geometry.attributes.position;
    indexed.dispose();geometry.deleteAttribute('uv');
    for(let i=0;i<position.count;i++){
      const u=px+position.getX(i),y=position.getY(i)<0?bottom(u):top(u);
      position.setXYZ(i,u,y,pz+position.getZ(i));
    }
    geometry.computeVertexNormals();add(geometry,mat);
  };
  const slabTop=u=>vehicleY+rise(u)-.002;
  const slabBottom=bridge?()=>bridge.bottomY:kind==='bridge'||grade
    ?u=>vehicleY+rise(u)-DECK_DEPTH:()=>-.08;
  box(x,z,width,width,slabBottom,slabTop,structure);
  for(const [polygons,height,mat] of [[surface.asphalt,vehicleY,material('#677378','road')],
    [surface.pavement,walkY,paving],[surface.paint,vehicleY+.006,material('#e8dfbc','road')]]){
    const geometry=tileSurface(polygons,(u,v)=>[x+u,height+rise(x+u),z+v]);
    if(geometry)add(geometry,mat);
  }
  const alongX=mask?!!(mask&3):rotation%2===0;
  if(mask===3||mask===12){
    const curb=(width-carriageway)/2;
    for(const side of [-1,1]){
      const offset=side*(width-curb)/2;
      box(x+(alongX?0:offset),z+(alongX?offset:0),alongX?width:curb,alongX?curb:width,slabTop,u=>walkY+rise(u)-.002,paving);
    }
  }
  if(kind==='bridge'){
    for(const side of [-1,1]){
      const exit=alongX?(side>0?4:8):(side>0?1:2);
      if(mask&exit)continue;
      const offset=side*(width/2-.06),railX=alongX?x:x+offset,railZ=alongX?z+offset:z;
      const height=u=>walkY+rise(u);
      box(railX,railZ,alongX?width:.12,alongX?.12:width,u=>height(u)+.8,u=>height(u)+.92,paving);
      for(const post of [-1.6,0,1.6])box(railX+(alongX?post:0),railZ+(alongX?0:post),.09,.09,height,u=>height(u)+.8,paving);
    }
    const pier=bridge?.piers.find(p=>p.x===x&&p.z===z);
    if(pier)box(x,z,pier.width,pier.width,()=>PIER_BASE,slabBottom,structure);
  }
  if(grade&&!bridge){
    const distance=Math.max(grade.minX-x,x-grade.maxX);
    if(distance===6&&slabBottom(x)>.25)box(x,z,.65,.65,()=>0,slabBottom,structure);
  }
  for(const [mat,parts] of batches){
    const geometry=parts.length===1?parts[0]:mergeGeometries(parts);
    if(parts.length>1)for(const part of parts)part.dispose();
    const mesh=new T.Mesh(geometry,mat);mesh.receiveShadow=true;mesh.castShadow=mat===structure;group.add(mesh);
  }
  return group;
}

export function createAlignmentMesh(geometry,ports,material,structure=null,terrain='meander'){
  const group=new T.Group(),asphalt=[],paving=[],marks=[],deck=[],rails=[];
  const {width,carriageway,bedY,vehicleY,walkY}=ROAD_PROFILES.road;
  const half=width/2,edge=carriageway/2,road=vehicleY-bedY,walk=walkY-bedY;
  const {samples}=geometry;
  const floor=()=>ROAD_DECK_BOTTOM;
  const quad=(out,a,b,c,d)=>out.push(...a,...b,...c,...a,...c,...d);
  const surface=(out,a,b,left,right,height)=>quad(out,offsetRoadSample(a,right,height),
    offsetRoadSample(b,right,height),offsetRoadSample(b,left,height),offsetRoadSample(a,left,height));
  const wall=(out,a,b,offset,top,bottom)=>quad(out,offsetRoadSample(a,offset,top),
    offsetRoadSample(a,offset,bottom(a)),offsetRoadSample(b,offset,bottom(b)),offsetRoadSample(b,offset,top));
  const posts=[];
  let distance=0,nextPost=.6;
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i];
    surface(asphalt,a,b,-edge,edge,road);
    surface(paving,a,b,-half,-edge,walk);
    surface(paving,a,b,edge,half,walk);
    wall(deck,b,a,-half,walk,floor);
    wall(deck,a,b,half,walk,floor);
    wall(paving,a,b,-edge,walk,()=>road);
    wall(paving,b,a,edge,walk,()=>road);
    const step=Math.hypot(b.point[0]-a.point[0],b.point[2]-a.point[2]);
    if((distance+step/2)%5<1.5)surface(marks,a,b,-.035,.035,road+.008);
    surface(deck,b,a,-half,half,ROAD_DECK_BOTTOM);
    if(Math.min(a.point[1],b.point[1])>.6){
      for(const [left,right] of [[-half,-half+.10],[half-.10,half]]){
        const underside=()=>ROAD_RAIL_TOP-.09;
        surface(rails,a,b,left,right,ROAD_RAIL_TOP);
        surface(rails,b,a,left,right,underside());
        wall(rails,b,a,left,ROAD_RAIL_TOP,underside);
        wall(rails,a,b,right,ROAD_RAIL_TOP,underside);
      }
    }
    if(distance+step>=nextPost){
      if(Math.min(a.point[1],b.point[1])>.6){
        for(const side of [-1,1])posts.push(offsetRoadSample(b,side*(half-.05),(walk+ROAD_RAIL_TOP)/2));
      }
      nextPost+=2;
    }
    distance+=step;
  }
  for(const [end,sample] of [[0,samples[0]],[1,samples.at(-1)]])if(!ports.some(port=>port.end===end)){
    for(const [left,right,top] of [[-half,-edge,walk],[-edge,edge,road],[edge,half,walk]]){
      const [a,b]=end?[right,left]:[left,right];
      quad(deck,offsetRoadSample(sample,a,top),offsetRoadSample(sample,a,floor(sample)),
        offsetRoadSample(sample,b,floor(sample)),offsetRoadSample(sample,b,top));
    }
  }
  for(const [points,color,role] of [[asphalt,'#677378','road'],[paving,'#c9c9bd','ground'],[marks,'#e8dfbc','road'],[deck,'#a5ada6','ground'],[rails,'#657972','ground']]){
    if(!points.length)continue;
    const buffer=new T.BufferGeometry();
    buffer.setAttribute('position',new T.Float32BufferAttribute(points,3));buffer.computeVertexNormals();
    const mesh=new T.Mesh(buffer,material(color,role));mesh.receiveShadow=true;mesh.castShadow=role==='ground';group.add(mesh);
  }
  for(const [parts,color] of [
    [(structure?.piers??roadSupports(samples,terrain)).map(({x,z,width,base,top})=>
      new T.BoxGeometry(width,top-base,width).translate(x,(top+base)/2,z)),'#9ca3a0'],
    [posts.map(([x,y,z])=>new T.BoxGeometry(.09,ROAD_RAIL_TOP-walk,.09).translate(x,y,z)),'#657972'],
  ]){
    if(!parts.length)continue;
    const geometry=mergeGeometries(parts);
    for(const part of parts)part.dispose();
    const supports=new T.Mesh(geometry,material(color,'ground'));supports.castShadow=true;supports.receiveShadow=true;group.add(supports);
  }
  return group;
}

export function roadSelectionBands(segment){
  const {geometry,center:[x,,z],profile:{width,walkY,bedY},grade}=segment;
  const half=width/2,band=.24,points=[];
  const quad=(a,b,c,d)=>points.push(...a,...b,...c,...a,...c,...d);
  if(geometry){
    const {samples}=geometry;
    const point=(sample,offset)=>offsetRoadSample(sample,offset,walkY-bedY+.04);
    for(let i=1;i<samples.length;i++){
      const a=samples[i-1],b=samples[i];
      for(const [left,right] of [[-half,-half+band],[-band,band],[half-band,half]]){
        quad(point(a,left),point(a,right),point(b,right),point(b,left));
      }
    }
    for(const [a,b] of [[samples[0],samples[1]],[samples.at(-1),samples.at(-2)]]){
      const inner=offset=>{
        const start=point(a,offset),next=point(b,offset);
        const distance=Math.hypot(next[0]-start[0],next[2]-start[2]);
        return start.map((value,i)=>value+(next[i]-value)*Math.min(1,band/distance));
      };
      quad(point(a,-half),point(a,half),inner(half),inner(-half));
    }
  }else{
    const point=(u,v)=>[x+u,walkY+bridgeRise(grade,x+u)+.04,z+v];
    for(const [x0,z0,x1,z1] of [[-half,-half,half,-half+band],[-half,half-band,half,half],
      [-half,-half+band,-half+band,half-band],[half-band,-half+band,half,half-band]]){
      quad(point(x0,z0),point(x1,z0),point(x1,z1),point(x0,z1));
    }
    const alongX=grade||segment.mask!==12;
    const [u,v]=alongX?[half-band,band]:[band,half-band];
    quad(point(-u,-v),point(u,-v),point(u,v),point(-u,v));
  }
  return points;
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
    const buffer=tileSurface(polygons,(x,z)=>[x,height,z]);
    if(buffer)b.geo(buffer,m);
  }
  if(bridge){const horizontal=mask!==12;for(const side of [-1,1]){
      b.box(horizontal?4:.12,.12,horizontal?.12:4,horizontal?0:side*1.8,y+1,horizontal?side*1.8:0,paving);
      for(const p of [-1.6,0,1.6])b.box(.09,.85,.09,horizontal?p:side*1.8,y+.5,horizontal?side*1.8:p,paving);
    }b.box(.6,1.9,.6,0,-.55,0,paving);
  }
  const result=b.finish();if(corner)result.userData.roadShape='arc';return result;
}
