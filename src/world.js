import * as T from 'three';
import { CELL, CHUNK, entityDimensions } from './catalog.js';
import { GROUND_Y, QUAY, WATER_Y, PROTOTYPE_HULL, PROTOTYPE_RADIUS, quayCenter, riverSections, waterOverlaps } from './river.js';
import { footprintOutline, parcelOutline, placementOf } from './parcel.js';
import { footprintBounds, key } from './core.js';
import { boxOutline, outlineBounds, transformOutline } from './outline.js';
import { getTemplate, getDistantTemplate, getQuayTemplate, material, vehicle, boat, person, animateImportedAssets } from './models.js';
import { animateArchitecture } from './architecture.js';
import { Pedestrians } from './pedestrians.js';
import { buildRoadNetwork, hasTraffic } from './road-network.js';
import { offsetRoadSample } from './road-alignment.js';
import { createAlignmentMesh, createBridgeRoad } from './roads.js';
import { bridgeRise } from './bridges.js';
import { JunctionPreview } from './junction-preview.js';
import { advanceVessel, BOAT_BRAKE, BOAT_SPEED, bridgeObstacles, canKeepSailing, launchVessel, navigationRoutes, navigationTrack, pointOnTrack, routeAt } from './navigation.js';

function quad(out,a,b,c,d){out.push(...a,...c,...b,...a,...d,...c);}
function clipX(polygon,edge,side){
  const out=[];let a=polygon.at(-1);
  for(const b of polygon){
    const inside=side*(b[0]-edge)>=0;
    if(inside!==(side*(a[0]-edge)>=0)){
      const t=(edge-a[0])/(b[0]-a[0]);
      out.push([edge,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]);
    }
    if(inside)out.push(b);
    a=b;
  }
  return out;
}
function clippedFace(out,polygon,minX,maxX){
  if(polygon.every(p=>p[0]<=minX)||polygon.every(p=>p[0]>=maxX))return;
  const points=clipX(clipX(polygon,minX,1),maxX,-1);
  for(let i=1;i+1<points.length;i++)out.push(...points[0],...points[i+1],...points[i]);
}
function surfaceGeometry(points){
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(points,3));geometry.computeVertexNormals();return geometry;
}
function outlineLines(outline,y){
  return outline.flatMap(([x,z],i)=>{const [u,v]=outline[(i+1)%outline.length];return [x,y,z,u,y,v];});
}
function updateLines(mesh,lines){
  const g=mesh.geometry,p=g.attributes.position;
  if(p?.array.length===lines.length){p.array.set(lines);p.needsUpdate=true;}
  else {if(p)g.dispose();g.setAttribute('position',new T.Float32BufferAttribute(lines,3));}
  g.computeBoundingSphere();
}
function alignmentLines(samples,offsets){
  const lines=[];
  for(const offset of offsets)for(let i=1;i<samples.length;i++){
    lines.push(...offsetRoadSample(samples[i-1],offset,.1),...offsetRoadSample(samples[i],offset,.1));
  }
  return lines;
}
function disposeChunkMeshes(group){group.traverse(o=>{if(o.isInstancedMesh)o.dispose();else if(o.userData.roadGeometry)o.geometry.dispose();});}
function lineLayer(scene,color,opacity=1){
  const layer=new T.LineSegments(new T.BufferGeometry(),new T.LineBasicMaterial({color,transparent:opacity<1,opacity}));
  layer.visible=false;scene.add(layer);return layer;
}
function landGeometry(cx,cz,terrain) {
  const grass=[],bank=[],edge=[],x0=(cx*CHUNK-.5)*CELL,x1=x0+CHUNK*CELL,z0=(cz*CHUNK-.5)*CELL;
  for(const {from:za,to:zb,a,b} of riverSections(z0,z0+CHUNK*CELL,terrain))for(const side of [-1,1]){
    const index=side<0?0:1,aa=a[index],ab=b[index];
    const outer=side<0?Math.min(x0,aa,ab):Math.max(x1,aa,ab);
    const land=[[outer,GROUND_Y,za],[aa,GROUND_Y,za],[ab,GROUND_Y,zb],[outer,GROUND_Y,zb]];
    clippedFace(grass,side<0?land:land.reverse(),x0,x1);
    const slope=[[aa,GROUND_Y,za],[aa-side*.25,WATER_Y-.4,za],[ab-side*.25,WATER_Y-.4,zb],[ab,GROUND_Y,zb]];
    clippedFace(bank,side<0?slope:slope.reverse(),x0,x1);
    const rim=[[aa,.012,za],[aa+side*.25,.012,za],[ab+side*.25,.012,zb],[ab,.012,zb]];
    clippedFace(edge,side>0?rim:rim.reverse(),x0,x1);
  }
  const group=new T.Group();
  for(const [p,m] of [[grass,material('#839e79','ground')],[bank,material('#8c9a99')],[edge,material('#d7cebb')]]){
    if(!p.length)continue;
    const mesh=new T.Mesh(surfaceGeometry(p),m);mesh.receiveShadow=true;group.add(mesh);
  }
  return group;
}
function horizonGeometry(focus,terrain){
  const points=[],x0=focus.x-4000,x1=focus.x+4000;
  for(const {from,to,a,b} of riverSections(focus.z-4000,focus.z+4000,terrain)){
    const [aw,ae]=a.map(x=>Math.max(x0,Math.min(x1,x))),[bw,be]=b.map(x=>Math.max(x0,Math.min(x1,x)));
    if(aw>x0||bw>x0)quad(points,[x0,-.06,from],[aw,-.06,from],[bw,-.06,to],[x0,-.06,to]);
    if(ae<x1||be<x1)quad(points,[ae,-.06,from],[x1,-.06,from],[x1,-.06,to],[be,-.06,to]);
  }
  return surfaceGeometry(points);
}
export class World {
  constructor(scene,city){
    this.scene=scene;this.city=city;this.loaded=new Map();this.pickables=[];this.lastRegion='';this.activeCenter=new T.Vector3();
    this.horizon=new T.Mesh(horizonGeometry(this.activeCenter,city.terrain),material('#839e79','ground'));this.horizonCenter=new T.Vector3();scene.add(this.horizon);
    this.quay=new T.Mesh(new T.BufferGeometry(),material('#c2b9a5','ground'));this.quay.receiveShadow=true;scene.add(this.quay);
    this.grid=new T.GridHelper(128,64,'#839785','#839785');this.grid.position.y=.055;this.grid.material.transparent=true;this.grid.material.opacity=.18;this.grid.visible=false;scene.add(this.grid);
    this.selection=lineLayer(scene,0xf2d38c);this.parcelSelection=lineLayer(scene,0x94e2d1);
    this.previewParcel=lineLayer(scene,0x94e2d1);this.previewFootprint=lineLayer(scene,0xffdc94);
    this.emptyParcels=lineLayer(scene,0xb7ded2,.65);
    this.laneOverlay=lineLayer(scene,0xffd68a);this.walkOverlay=lineLayer(scene,0x89e5d5);
    this.riverOverlay=lineLayer(scene,0xffd68a);
    this.hover=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({color:'#638b71',transparent:true,opacity:.3,depthWrite:false,side:T.DoubleSide}));this.hover.rotation.x=-Math.PI/2;this.hover.visible=false;scene.add(this.hover);
    this.preview=null;this.previewKey='';
    this.traffic=new Traffic(scene,city);this.junctionPreview=new JunctionPreview(scene);this.sync(true);
  }
  setCity(city){this.city=city;this.select(null);this.junctionPreview.clear();this.showMobility(false);this.showRiver(false);this.horizon.geometry.dispose();this.horizon.geometry=horizonGeometry(this.activeCenter,city.terrain);this.traffic.setCity(city);this.clear();this.sync(true);}
  clear(){for(const ck of [...this.loaded.keys()])this.unload(ck);this.lastRegion='';}
  unload(ck){const c=this.loaded.get(ck);if(!c)return;this.scene.remove(c.land,c.buildings);c.land.traverse(o=>{if(o.geometry)o.geometry.dispose();});disposeChunkMeshes(c.buildings);this.loaded.delete(ck);}
  sync(force=false,focus=this.activeCenter,distance=180){
    this.activeCenter.copy(focus);
    if(focus.distanceTo(this.horizonCenter)>500){this.horizon.geometry.dispose();this.horizon.geometry=horizonGeometry(focus,this.city.terrain);this.horizonCenter.copy(focus);}
    const cx=Math.floor(focus.x/(CELL*CHUNK)),cz=Math.floor(focus.z/(CELL*CHUNK));
    const r=Math.min(12,Math.max(2,Math.ceil(distance*.8/(CELL*CHUNK))+1));
    const state=`${cx}:${cz}:${r}:${this.city.radius}:${distance<420}`;
    if(!force&&state===this.lastRegion)return;
    this.lastRegion=state;
    const wanted=new Set();
    for(let x=cx-r;x<=cx+r;x++)for(let z=cz-r;z<=cz+r;z++){
      if(x*CHUNK>=this.city.radius || (x+1)*CHUNK<=-this.city.radius || z*CHUNK>=this.city.radius || (z+1)*CHUNK<=-this.city.radius)continue;
      const ck=key(x,z);wanted.add(ck);
      const detail=distance<420&&Math.hypot((x+.5)*CHUNK*CELL-focus.x,(z+.5)*CHUNK*CELL-focus.z)<210;
      if(!this.loaded.has(ck)){const land=landGeometry(x,z,this.city.terrain),buildings=new T.Group();this.scene.add(land,buildings);this.loaded.set(ck,{land,buildings,detail});this.buildChunk(ck,detail);}
      else if(force || this.loaded.get(ck).detail!==detail)this.buildChunk(ck,detail);
    }
    for(const ck of [...this.loaded.keys()])if(!wanted.has(ck))this.unload(ck);
    this.pickables=[];for(const c of this.loaded.values())this.pickables.push(...c.buildings.children);
    const span=CELL*CHUNK,bounds={minX:(cx-r)*span,minZ:(cz-r)*span,maxX:(cx+r+1)*span,maxZ:(cz+r+1)*span};
    const lines=this.city.parcelSpatial.query(bounds).flatMap(id=>{
      const parcel=this.city.parcels.get(id);
      return this.city.parcelOwner(parcel)?[]:outlineLines(parcelOutline(parcel),.09);
    });
    this.emptyParcels.visible=!!lines.length;
    if(lines.length)updateLines(this.emptyParcels,lines);
    if(force){
      if(this.quaySections!==this.city.waterfront){
        this.quaySections=this.city.waterfront;
        const points=[];for(const {outline} of this.quaySections)quad(points,...outline.map(([x,z])=>[x,QUAY.y,z]));
        this.quay.geometry.dispose();this.quay.geometry=surfaceGeometry(points);
      }
      this.traffic.rebuild();
      if(this.riverOverlay.visible)this.showRiver(true);
      const guide=this.junctionPreview;
      if(guide.id)this.showJunction(guide.id,guide.kind);
      if(this.walkOverlay.visible)this.showMobility(true,this.mobilityFocus);
    }
  }
  buildChunk(ck,detail){
    const c=this.loaded.get(ck);c.detail=detail;disposeChunkMeshes(c.buildings);c.buildings.clear();c.animations=[];
    const batches=new Map();
    const append=(model,matrix,id)=>{for(const mesh of model.children){
      if(mesh.userData.dynamic){const holder=new T.Group(),animated=mesh.clone(true);holder.applyMatrix4(matrix);holder.add(animated);holder.traverse(o=>{if(o.isMesh)o.userData.entityId=id;});c.buildings.add(holder);c.animations.push(holder);continue;}
      const k=mesh.geometry.uuid+mesh.material.uuid;if(!batches.has(k))batches.set(k,{mesh,matrices:[],ids:[]});const batch=batches.get(k);batch.matrices.push(matrix);batch.ids.push(id);
    }};
    for(const id of this.city.chunks.get(ck)||[]){
      const e=this.city.entities.get(id);
      if(!detail&&['bench','flowers','lamp'].includes(e.type))continue;
      const road=this.city.roadNetwork.segments.get(id),mask=hasTraffic(e.type)?road.mask:0;
      if(road?.geometry){
        const model=createAlignmentMesh(road.geometry,road.ports,material);
        model.userData.alignment=true;
        for(const mesh of model.children){mesh.userData.entityId=id;mesh.userData.roadGeometry=true;}
        c.buildings.add(model);continue;
      }
      if(road?.grade||e.type==='bridge'){
        const model=createBridgeRoad(road,e.rotation,material);
        for(const mesh of model.children){mesh.userData.entityId=id;mesh.userData.roadGeometry=true;mesh.castShadow&&=detail;}
        c.buildings.add(model);continue;
      }
      const model=(detail?getTemplate:getDistantTemplate)(e.type,e.color,mask),p=placementOf(e);
      if(road){
        p.x=road.center[0];p.z=road.center[2];
        // Connected masks use world directions. Stored rotation still orients an isolated tile.
        if(mask)p.radians=0;
      }
      const matrix=new T.Matrix4().compose(new T.Vector3(p.x,0,p.z),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),p.radians),new T.Vector3(p.scaleX,1,p.scaleZ));
      append(model,matrix,id);
      if(detail&&e.type==='road'&&!road.junction&&(e.x+e.z)%6===0)append(getTemplate('lamp'),new T.Matrix4().makeTranslation(e.x*CELL+1.8,.13,e.z*CELL+1.8),id);
    }
    const [cx,cz]=ck.split(',').map(Number);
    if(detail)for(let z=Math.ceil(cz*CHUNK*CELL/12)*12;z<(cz+1)*CHUNK*CELL;z+=12){if(Math.abs(z)>105)continue;for(const side of [-1,1]){
      const [center]=quayCenter(z,side,this.city.terrain),x=center+side*QUAY.width;
      if(Math.floor((x+CELL/2)/(CHUNK*CELL))!==cx)continue;
      if(!this.city.waterfront.some(section=>section.side===side&&section.from<=z&&z<section.to))continue;
      const angle=Math.atan2(quayCenter(z+1,side,this.city.terrain)[0]-quayCenter(z-1,side,this.city.terrain)[0],2)+(side<0?Math.PI:0);
      const model=getQuayTemplate(),{min,max}=new T.Box3().setFromObject(model);
      const outline=transformOutline(boxOutline({minX:min.x,maxX:max.x,minZ:min.z,maxZ:max.z}),x,z,angle);
      if(this.city.queryFootprints(outlineBounds(outline)).length||outline.some(([px,pz])=>side*(px-quayCenter(pz,side,this.city.terrain)[0])<QUAY.width/2))continue;
      append(model,new T.Matrix4().compose(new T.Vector3(x,0,z),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),angle),new T.Vector3(1,1,1)),null);
    }}
    for(const {mesh,matrices,ids} of batches.values()){
      const inst=new T.InstancedMesh(mesh.geometry,mesh.material,matrices.length);matrices.forEach((m,i)=>inst.setMatrixAt(i,m));inst.userData.entityIds=ids;inst.castShadow=detail&&mesh.castShadow;inst.receiveShadow=true;inst.computeBoundingSphere();c.buildings.add(inst);
    }
  }
  select(id,parcelId){
    const e=this.city.entities.get(id),parcel=e?.pose?.parcel??this.city.parcels.get(parcelId);
    this.parcelSelection.visible=!!parcel;
    if(parcel)updateLines(this.parcelSelection,outlineLines(parcelOutline(parcel),.13));
    if(!e){this.selection.visible=false;return;}
    if(e.alignment){
      const road=this.city.roadNetwork.segments.get(id);
      updateLines(this.selection,alignmentLines(road.geometry.samples,[-road.profile.width/2,road.profile.width/2]));
      this.selection.visible=true;return;
    }
    const road=this.city.roadNetwork.segments.get(id),outline=footprintOutline(e);
    const height=new T.Box3().setFromObject(getTemplate(e.type,e.color)).max.y+.3+bridgeRise(road?.grade,road?.center[0]);
    const lines=[];
    for(let i=0;i<outline.length;i++){
      const [x,z]=outline[i],[u,v]=outline[(i+1)%outline.length];
      lines.push(x,.12,z,u,.12,v,x,height,z,u,height,v,x,.12,z,x,height,z);
    }
    updateLines(this.selection,lines);this.selection.visible=true;
  }
  showParcelPreview({parcel,entity,error}){
    if(!parcel){this.clearPreview();return;}
    if(entity)this.showPreview(entity,!error);
    else this.clearPreview();
    updateLines(this.previewParcel,outlineLines(parcelOutline(parcel),.14));
    this.previewParcel.material.color.set(error?'#df8970':'#94e2d1');this.previewParcel.visible=true;
    this.previewFootprint.visible=!!entity;
    if(entity){
      updateLines(this.previewFootprint,outlineLines(footprintOutline(entity),.17));
      this.previewFootprint.material.color.set(error?'#df8970':'#ffdc94');
    }
  }
  showRoadPreview(geometry,error){
    this.showRoadPreviews(geometry?.samples?[geometry.samples]:[],error);
  }
  showRoadPreviews(profiles,error){
    this.clearPreview();
    if(!profiles.length)return;
    const points=[],lines=[];
    const edge=(sample,side)=>offsetRoadSample(sample,side*CELL/2,.1);
    for(const samples of profiles){
      for(let i=1;i<samples.length;i++){
        const a=samples[i-1],b=samples[i];
        quad(points,edge(a,-1),edge(b,-1),edge(b,1),edge(a,1));
      }
      lines.push(...alignmentLines(samples,[-CELL/2,0,CELL/2]));
      for(const sample of [samples[0],samples.at(-1)])lines.push(...edge(sample,-1),...edge(sample,1));
    }
    const buffer=new T.BufferGeometry();buffer.setAttribute('position',new T.Float32BufferAttribute(points,3));
    const tint=new T.MeshBasicMaterial({color:error?'#cb6856':'#5a9f79',transparent:true,opacity:.55,depthWrite:false,depthTest:false});
    this.preview=new T.Mesh(buffer,tint);this.preview.userData.roadPreview=true;this.preview.renderOrder=4;
    this.scene.add(this.preview);
    this.previewFootprint.material.color.set(error?'#f3a289':'#daffe0');
    this.previewFootprint.material.depthTest=false;this.previewFootprint.renderOrder=5;
    updateLines(this.previewFootprint,lines);
    this.previewFootprint.visible=true;
  }
  showPreview(e,valid){
    const [w,d]=entityDimensions(e);
    const k=`${e.type}:${e.color}`;
    if(this.previewKey!==k){this.clearPreview();this.preview=getTemplate(e.type,e.color).clone();this.preview.traverse(o=>{if(o.isMesh){const base=o.material.userData.base.clone();o.material=o.material.clone();o.material.userData.base=base;o.material.transparent=true;o.material.opacity=.55;o.material.depthWrite=false;o.castShadow=false;}});this.scene.add(this.preview);this.previewKey=k;}
    const p=placementOf(e);this.preview.position.set(p.x,.08,p.z);this.preview.scale.set(p.scaleX,1,p.scaleZ);this.preview.rotation.y=p.radians;this.preview.visible=true;
    this.preview.traverse(o=>{if(o.isMesh)o.material.color.copy(o.material.userData.base).lerp(new T.Color(valid?'#9fc0a4':'#d57762'),.3);});
    if(e.pose){this.hover.visible=false;this.grid.visible=false;return;}
    this.hover.scale.set(w*CELL,d*CELL,1);this.hover.position.set(this.preview.position.x,.06,this.preview.position.z);this.hover.material.color.set(valid?'#6d9975':'#c06a57');this.hover.visible=true;
    this.grid.visible=true;this.grid.position.x=Math.round(this.preview.position.x/32)*32;this.grid.position.z=Math.round(this.preview.position.z/32)*32;
  }
  clearPreview(){if(this.preview){this.scene.remove(this.preview);this.preview.traverse(o=>{if(o.isMesh){o.material.dispose();if(this.preview.userData.roadPreview)o.geometry.dispose();}});this.preview=null;}this.previewKey='';this.hover.visible=false;this.grid.visible=false;this.previewParcel.visible=false;this.previewFootprint.visible=false;this.previewFootprint.material.depthTest=true;this.previewFootprint.renderOrder=0;}
  showJunction(id,kind){this.junctionPreview.set(this.city.roadNetwork.segments.get(id),kind);}
  showRiver(visible){
    this.riverOverlay.visible=visible;
    if(!visible)return;
    const positions=[];
    const {track,routes}=this.traffic;
    const point=({x,z})=>[x,WATER_Y+.055,z];
    for(const route of routes){
      const ends=[pointOnTrack(track,route.from),pointOnTrack(track,route.to)];
      const points=[ends[0],...track.points.filter(p=>p.distance>route.from&&p.distance<route.to),ends[1]];
      for(let i=1;i<points.length;i++)positions.push(...point(points[i-1]),...point(points[i]));
      for(const [i,blocked] of [route.blockedStart,route.blockedEnd].entries())if(blocked){
        const {x,z}=ends[i];positions.push(...point({x:x-1,z}),...point({x:x+1,z}));
      }
    }
    updateLines(this.riverOverlay,positions);
  }
  showMobility(visible,focus=this.activeCenter){
    this.laneOverlay.visible=this.walkOverlay.visible=visible;
    if(!visible)return;
    this.mobilityFocus=focus.clone();
    const near=(x,z)=>Math.hypot(x-focus.x,z-focus.z)<115,lanes=[],walk=[];
    const append=(out,a,b)=>{if(near(a[0],a[2])||near(b[0],b[2]))out.push(a[0],a[1]+.035,a[2],b[0],b[1]+.035,b[2]);};
    for(const {points} of this.city.roadNetwork.laneGraph.edges.values())for(let i=1;i<points.length;i++)append(lanes,points[i-1],points[i]);
    const {nodes}=this.traffic.people.network;
    for(const a of nodes.values())for(const id of a.edges.keys())if(id>a.id){
      const b=nodes.get(id);append(walk,[a.x,a.y,a.z],[b.x,b.y,b.z]);
    }
    updateLines(this.laneOverlay,lanes);updateLines(this.walkOverlay,walk);
  }
  update(dt,time,focus,distance){this.sync(false,focus,distance);this.traffic.update(dt,time,focus,!!this.junctionPreview.active);this.junctionPreview.update(dt);for(const chunk of this.loaded.values())if(chunk.detail)for(const object of chunk.animations||[]){animateArchitecture(object,time);animateImportedAssets(object,time);}}
}
class Traffic {
  constructor(scene,city){this.scene=scene;this.cars=[];this.people=new Pedestrians(scene);this.boats=[];this.sailingTime=0;this.setCity(city);}
  setCity(city){
    if(this.city)this.city.editGuard=null;
    for(const vessel of this.boats)this.disposeActor(vessel);
    this.boats=[];this.city=city;
    this.track=navigationTrack(city.worldBounds(),city.terrain);
    city.editGuard=(changes,to)=>this.navigationEditError(changes,to);
  }
  disposeActor({mesh}){this.scene.remove(mesh);mesh.traverse(o=>o.geometry?.dispose());}
  get boatStatus(){
    const [vessel]=this.boats;
    if(!vessel)return null;
    const {mesh,state,speed,direction}=vessel,route=routeAt(this.routes,vessel.distance);
    return {point:mesh.position.toArray(),state,speed,direction,blocked:!route||(direction>0?route.blockedEnd:route.blockedStart)};
  }
  planRoutes(crossings,entities){
    const obstacles=bridgeObstacles(crossings);
    for(const entity of entities)if(entity.type!=='bridge'&&!entity.alignment){
      const bounds=footprintBounds(entity);
      if(waterOverlaps(footprintOutline(entity),bounds,this.city.terrain))obstacles.push(bounds);
    }
    return navigationRoutes(this.track,obstacles);
  }
  navigationEditError(changes,to){
    const [vessel]=this.boats;
    if(!vessel)return null;
    const {z}=pointOnTrack(this.track,vessel.distance),padding=CELL+PROTOTYPE_RADIUS+.1+BOAT_SPEED**2/(2*BOAT_BRAKE);
    const near=entity=>{
      if(!entity||(!hasTraffic(entity.type)&&entity.type!=='pier'))return false;
      const {minZ,maxZ}=footprintBounds(entity);
      return minZ<=z+padding&&maxZ>=z-padding;
    };
    if(!changes.some(c=>!c.parcel&&(near(c.before)||near(c.after))))return null;
    const proposed=new Map(this.city.entities);
    for(const c of changes)if(!c.parcel){
      const entity=c[to];
      if(entity)proposed.set(entity.id,entity);
      else proposed.delete((c.before??c.after).id);
    }
    const {terrain,roadRevision}=this.city,network=buildRoadNetwork(proposed.values(),roadRevision,terrain);
    const {minZ,maxZ,minX,maxX}=this.track.area;
    const candidates=[...proposed.values()].filter(entity=>{
      if(entity.type==='bridge'||entity.alignment)return false;
      const bounds=footprintBounds(entity);
      return bounds.minZ<=maxZ&&bounds.maxZ>=minZ&&bounds.minX<=maxX&&bounds.maxX>=minX;
    });
    const routes=this.planRoutes(network.bridges.crossings,candidates);
    return canKeepSailing(vessel,routes,routeAt(this.routes,vessel.distance))?null:'船只正在经过这里，请等船驶离后再修改航道';
  }
  rebuild(){
    for(const car of this.cars)this.disposeActor(car);
    this.cars=[];
    this.network=this.city.roadNetwork;
    const roads=[...this.network.segments.values()].filter(s=>hasTraffic(s.kind)&&!s.geometry&&this.gridPorts(s).length);
    for(let i=0;i<Math.min(46,Math.floor(roads.length/10));i++){
      const e=roads[Math.floor(i*roads.length/Math.max(1,Math.min(46,Math.floor(roads.length/10))))],mesh=vehicle(i%5);
      mesh.rotation.order='YXZ';this.scene.add(mesh);
      this.cars.push({mesh,from:e,to:this.network.segments.get(this.gridPorts(e)[0].neighborId),last:null,t:Math.random(),speed:2.3+(i%4)*.3,dwell:0,kind:i%5});
    }
    this.people.rebuild(this.city);
    this.routes=this.planRoutes(this.network.bridges.crossings,this.city.queryFootprints(this.track.area));
    const active=[...this.city.entities.values()].some(e=>e.type==='path'||e.type==='pier');
    if(active&&!this.boats.length){
      const vessel=launchVessel(this.track,this.routes);
      if(vessel){vessel.mesh=boat();this.scene.add(vessel.mesh);this.boats.push(vessel);this.positionBoat(vessel,this.sailingTime,0);}
    }
    this.followTarget=this.cars[0]?.mesh;
  }
  gridPorts(segment){return segment.ports.filter(port=>!this.network.segments.get(port.neighborId).geometry);}
  positionBoat(vessel,time,dt){
    if(dt)advanceVessel(vessel,this.track,routeAt(this.routes,vessel.distance),dt);
    const {x,z}=pointOnTrack(this.track,vessel.distance);
    vessel.mesh.rotation.y=vessel.yaw;
    vessel.mesh.position.set(x,WATER_Y+PROTOTYPE_HULL.originAboveWater+Math.sin(time)*PROTOTYPE_HULL.bob,z);
  }
  update(dt,time,focus,hideCars){
    for(const c of this.cars){
      if(c.dwell>0)c.dwell-=dt;else c.t+=dt*c.speed/CELL;
      if(c.t>=1){c.t-=1;c.last=c.from.id;c.from=c.to;const ports=this.gridPorts(c.from);let next=ports.filter(port=>port.neighborId!==c.last);if(!next.length)next=ports;const port=next[Math.floor(Math.random()*next.length)];c.to=port?this.network.segments.get(port.neighborId):c.from;if(c.kind===3&&c.from.id%31===0)c.dwell=2;}
      const prev=this.network.segments.get(c.last),t=Math.min(1,c.t),u=1-t;
      const [bx,,bz]=c.from.center,[tx,,tz]=c.to.center,[px,,pz]=prev?.center??[2*bx-tx,0,2*bz-tz];
      const ax=(px+bx)/2,az=(pz+bz)/2,cx=(bx+tx)/2,cz=(bz+tz)/2;
      const vx=2*u*(bx-ax)+2*t*(cx-bx),vz=2*u*(bz-az)+2*t*(cz-bz),len=Math.hypot(vx,vz)||1,dx=vx/len,dz=vz/len;
      const y=c.from.profile.vehicleY,lane=c.from.profile.lanes[1].offset;
      const x=u*u*ax+2*u*t*bx+t*t*cx-dz*lane,z=u*u*az+2*u*t*bz+t*t*cz+dx*lane;
      c.mesh.position.set(x,y+bridgeRise(c.from.grade,x),z);
      const grade=c.from.grade??c.to.grade??prev?.grade;
      c.mesh.rotation.x=-Math.atan2(bridgeRise(grade,x+dx)-bridgeRise(grade,x-dx),2);
      const target=Math.atan2(dx,dz),delta=T.MathUtils.euclideanModulo(target-c.mesh.rotation.y+Math.PI,Math.PI*2)-Math.PI;c.mesh.rotation.y+=delta*Math.min(1,dt*9);
      c.mesh.visible=!hideCars&&c.mesh.position.distanceTo(focus)<200;
    }
    this.people.update(dt,time,focus,hideCars?[]:this.cars);
    this.sailingTime=time;
    for(const vessel of this.boats)this.positionBoat(vessel,time,dt);
  }
}
