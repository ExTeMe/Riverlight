import { BY_ID, CELL, CHUNK, SNAP, LEGACY_LOTS, entityDimensions } from './catalog.js';
import { SpatialIndex, legacyFootprintBounds, riverCenter, riverWidth, terrainSurfaceAt, waterAt, worldBounds } from './space.js';
import { ALIGNMENT_ROAD_VERSION, CITY_VERSION, ELEVATED_ROAD_VERSION, GRID_ROAD_VERSION, PARCEL_VERSION, supportedCityVersion } from './city-format.js';
import { usesParcel, parcelOutline, footprintOutline, parcelOnLand, fitsParcel, legacyParcel, normalizeParcel, normalAngle, readParcelEntity } from './parcel.js';
import { EDGE_EPSILON, boundsContain, outlineBounds, outlineContains, outlinesOverlap } from './outline.js';
import { buildRoadNetwork, hasTraffic, isRoad, nextRoadRevision, readGridRoad, readRoadHeader, roadCenter, roadHeader } from './road-network.js';
import { alignmentGeometry, matchingRoadEnds, readAlignment, roadContains } from './road-alignment.js';
import { elevatedStructure, obstacleHeight, roadBlocksOutline, roadConflict, roadEndsSeparated, roadObstacleConflict } from './elevated-roads.js';
import { REQUIRED_UNDERSIDE } from './bridges.js';
import { QUAY, quaySection, riverSections, waterOverlaps } from './river.js';
export { riverCenter, riverWidth, waterAt };
export const VERSION = CITY_VERSION;
export const MAX_ENTITIES = 100000;
export const key = (x, z) => `${x},${z}`;
export const chunkKey = (x, z) => key(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
export const footprintBounds = e => e.alignment ? alignmentGeometry(e.alignment).bounds : e.pose ? outlineBounds(footprintOutline(e)) : legacyFootprintBounds(e);
const entityChunk = e => {
  if(e.alignment){
    const {samples}=alignmentGeometry(e.alignment),[x,,z]=samples[Math.floor(samples.length/2)].point;
    return chunkKey((x+CELL/2)/CELL,(z+CELL/2)/CELL);
  }
  if(!e.pose)return chunkKey(e.x,e.z);
  const b=footprintBounds(e);
  return chunkKey(b.minX/CELL+.5,b.minZ/CELL+.5);
};
const reservesLand = e => BY_ID[e.type].category!=='detail'||e.type==='pier';
const aroundPoint = (x,z) => ({minX:x-EDGE_EPSILON,minZ:z-EDGE_EPSILON,maxX:x+EDGE_EPSILON,maxZ:z+EDGE_EPSILON});
const overlapsEntity = (outline,e,terrain,height=0) => e.alignment
  ? roadBlocksOutline(e.alignment,outline,height,terrain) : outlinesOverlap(outline,footprintOutline(e));
const colorOrPoseChanged = (before,after) => before.color!==after.color||['offsetX','offsetZ','angle'].some(key=>before.pose[key]!==after.pose[key]);
const roadChanged = ({before,after,parcel}) => !parcel&&(isRoad(before?.type)||isRoad(after?.type))
  &&['id','type','x','z','rotation','alignment'].some(key=>before?.[key]!==after?.[key]);
export function footprint(e) {
  const [w, d] = entityDimensions(e);
  const cells = [];
  for (let x = e.x; x < e.x + w; x+=SNAP) for (let z = e.z; z < e.z + d; z+=SNAP) cells.push([x, z]);
  return cells;
}
export function gridLine(a, b) {
  const cells = []; let [x, z] = a; const [tx, tz] = b;
  const dx = Math.abs(tx - x), dz = Math.abs(tz - z), sx = x < tx ? 1 : -1, sz = z < tz ? 1 : -1;
  let error = dx - dz;
  while (true) {
    cells.push([x, z]); if (x === tx && z === tz) break;
    const e = error * 2;
    if (e > -dz) { error -= dz; x += sx; }
    else if (e < dx) { error += dx; z += sz; }
  }
  return cells;
}
export class City {
  constructor(data) {
    this.name = '河光之城'; this.terrain='meander';this.radius = 64; this.entities = new Map(); this.occupancy = new Map(); this.chunks = new Map();this.spatial=new SpatialIndex();
    this.parcels=new Map();this.parcelSpatial=new SpatialIndex();this.meshRevisions=new Map();
    this.roadRevision=0;this._roadNetwork=null;this.alignmentCount=0;
    this.environment = { season: 'summer', weather: 'clear', hour: 16.5, playing: false, speed: 1, wind: 0.4, quality: 'high' };
    this.undoStack = []; this.redoStack = []; this.nextId = 1;
    if (data) this.restore(data);
  }
  at(x, z) {
    return this.entities.get(this.occupancy.get(key(Math.floor(x/SNAP)*SNAP,Math.floor(z/SNAP)*SNAP)));
  }
  worldBounds() { return worldBounds(this.radius); }
  surfaceAt(x,z) { return terrainSurfaceAt(x,z,this.terrain); }
  get waterfront(){
    const {terrain,radius}=this;
    if(this._waterfront?.terrain===terrain&&this._waterfront.radius===radius)return this._waterfront.sections;
    const world=this.worldBounds(),sections=[];
    for(const row of riverSections(Math.max(world.minZ,QUAY.minZ),Math.min(world.maxZ,QUAY.maxZ),terrain))for(const side of [-1,1]){
      const section=quaySection(row,side),bounds=outlineBounds(section.outline);
      if(boundsContain(world,bounds)&&!this.queryFootprints(bounds).some(e=>e.type!=='path'&&overlapsEntity(section.outline,e,terrain,2.4)))sections.push(section);
    }
    this._waterfront={terrain,radius,sections};return sections;
  }
  queryFootprints(bounds) { return this.spatial.query(bounds).map(id=>this.entities.get(id)); }
  parcelAt(x,z) {
    return this.parcelSpatial.query(aroundPoint(x,z)).map(id=>this.parcels.get(id)).find(p=>outlineContains(parcelOutline(p),x,z));
  }
  nativeAt(x,z) {
    if(!this.parcels.size&&!this.alignmentCount)return undefined;
    return this.queryFootprints(aroundPoint(x,z)).find(e=>e.alignment
      ?!e.alignment.elevated&&roadContains(e.alignment,x,z)
      :e.pose&&outlineContains(footprintOutline(e),x,z));
  }
  parcelOwner(parcel) {
    return this.queryFootprints(outlineBounds(parcelOutline(parcel))).find(e=>e.pose?.parcel.id===parcel.id);
  }
  parcelPlacementError(parcel,outline,bounds,ownerId) {
    if(bounds.maxX<=bounds.minX||bounds.maxZ<=bounds.minZ)return '地块尺寸无效';
    if(!boundsContain(this.worldBounds(),bounds,EDGE_EPSILON))return '地块超出可建边界';
    if(!parcelOnLand(outline,bounds,this.terrain))return '地块侵入水域';
    if(this.parcelSpatial.query(bounds).some(id=>id!==parcel.id&&outlinesOverlap(outline,parcelOutline(this.parcels.get(id)))))return '地块与其他地块重叠';
    if(this.queryFootprints(bounds).some(e=>e.id!==ownerId&&reservesLand(e)&&overlapsEntity(outline,e,this.terrain)))return '地块与道路或建筑重叠';
    return null;
  }
  canPlace(e, ignoreId, {allowHistoricBank=false}={}) {
    if (!BY_ID[e.type]) return '未知建筑';
    if(this.entities.size>=MAX_ENTITIES&&!ignoreId)return '当前城市物件已达到存档容量上限';
    if(e.alignment){
      const geometry=alignmentGeometry(e.alignment);
      if(geometry.error)return geometry.error;
      const {bounds,sections}=geometry;
      if(!boundsContain(this.worldBounds(),bounds,EDGE_EPSILON))return '道路超出可建边界';
      const structure=elevatedStructure(e.alignment,this.terrain);
      if(structure?.bottomY!=null&&structure.bottomY<REQUIRED_UNDERSIDE)return '跨水桥底净空不足，请在入水前抬高桥面';
      if(!structure&&sections.some(s=>!parcelOnLand(s.outline,s.bounds,this.terrain)))return '道路侵入水域，请使用高架道路或跨河桥梁';
      if(this.parcelSpatial.query(bounds).some(id=>roadBlocksOutline(e.alignment,parcelOutline(this.parcels.get(id)),0,this.terrain))){
        return structure?'桥墩或低位桥面占用地块，请调整走向':'道路与地块重叠';
      }
      for(const [i,point] of [e.alignment.start,e.alignment.end].entries()){
        const [x,y,z]=point;
        for(const other of this.queryFootprints(aroundPoint(x,z)))if(other.alignment&&other.id!==ignoreId){
          for(const [j,end] of [other.alignment.start,other.alignment.end].entries()){
            if(x===end[0]&&z===end[2]&&!matchingRoadEnds(point,i,end,j)&&!roadEndsSeparated(e.alignment,other.alignment,y,end[1])){
              return '相接端点须共用高度与切线，请在画布上吸附端点';
            }
          }
        }
      }
      for(const other of this.queryFootprints(bounds)){
        if(other.id===ignoreId)continue;
        if(other.alignment){
          if(roadConflict(e.alignment,other.alignment,this.terrain))return structure?'桥底净空不足或桥墩占用下层道路':'道路与其他物件重叠';
          continue;
        }
        const height=obstacleHeight(other),conflict=roadObstacleConflict(e.alignment,footprintOutline(other),height,this.terrain);
        if(conflict==='pier')return `桥墩占用${BY_ID[other.type].name}，请调整走向`;
        if(conflict==='height')return `${BY_ID[other.type].name}上方桥底净空不足，桥底须达到 ${height} 米`;
        if(conflict)return '道路与其他物件重叠';
      }
      return null;
    }
    if(e.pose){
      if(!fitsParcel(e))return '建筑超出地块边界';
      const outline=footprintOutline(e);
      return this.queryFootprints(outlineBounds(outline)).some(other=>other.id!==ignoreId&&overlapsEntity(outline,other,this.terrain,obstacleHeight(e)))?'这里已有建筑或摆件，或上方桥底净空不足':null;
    }
    if(!Number.isInteger(e.x/SNAP)||!Number.isInteger(e.z/SNAP))return '请对齐建造网格';
    if(isRoad(e.type)&&(!Number.isInteger(e.x)||!Number.isInteger(e.z)))return '道路请对齐主路网';
    const bounds=legacyFootprintBounds(e),world=this.worldBounds();
    if(!boundsContain(world,bounds))return '这里还未扩展，点击「扩展地图」';
    if(reservesLand(e)&&this.parcelSpatial.query(bounds).some(id=>outlinesOverlap(footprintOutline(e),parcelOutline(this.parcels.get(id)))))return '这里已有地块';
    if(this.queryFootprints(bounds).some(other=>other.id!==ignoreId&&(!other.pose&&!other.alignment||overlapsEntity(footprintOutline(e),other,this.terrain,obstacleHeight(e)))))return '这里已有建筑，或上方桥底净空不足';
    if(e.type==='bridge')return null;
    const pier=e.type==='pier',wet=waterOverlaps(footprintOutline(e),bounds,this.terrain);
    if(wet===pier)return null;
    if(allowHistoricBank&&footprint(e).some(([x,z])=>waterAt(!pier&&this.terrain==='legacy'?Math.floor(x):x,
      !pier&&this.terrain==='legacy'?Math.floor(z):z,this.terrain))===pier)return null;
    if(pier)return '码头需要接触水面';
    return e.type==='road'?'水面请使用桥梁工具':'请选择陆地区域';
  }
  touchMeshChunks(bounds,owner){
    // Waterfront furniture queries nearby entity footprints across chunk seams.
    const span=CELL*CHUNK,pad=QUAY.width+CELL,dirty=new Set([owner]);
    for(let x=Math.floor((bounds.minX-pad)/span);x<=Math.floor((bounds.maxX+pad)/span);x++){
      for(let z=Math.floor((bounds.minZ-pad)/span);z<=Math.floor((bounds.maxZ+pad)/span);z++)dirty.add(key(x,z));
    }
    for(const ck of dirty)this.meshRevisions.set(ck,(this.meshRevisions.get(ck)??0)+1);
  }
  insert(e) {
    this._waterfront=null;
    this.entities.set(e.id, { ...e });
    if(e.alignment)this.alignmentCount++;
    const bounds=footprintBounds(e);this.spatial.insert(e.id,bounds);
    if(!e.pose&&!e.alignment)for (const [x,z] of footprint(e)) this.occupancy.set(key(x,z), e.id);
    const ck = entityChunk(e); if (!this.chunks.has(ck)) this.chunks.set(ck,new Set()); this.chunks.get(ck).add(e.id);
    this.touchMeshChunks(bounds,ck);
  }
  erase(id) {
    const e = this.entities.get(id); if (!e) return;
    this._waterfront=null;
    if(e.alignment)this.alignmentCount--;
    this.spatial.erase(id);
    if(!e.pose&&!e.alignment)for (const [x,z] of footprint(e)) this.occupancy.delete(key(x,z));
    this.entities.delete(id); const ck = entityChunk(e); this.chunks.get(ck)?.delete(id); if (!this.chunks.get(ck)?.size) this.chunks.delete(ck);
    this.touchMeshChunks(footprintBounds(e),ck);
  }
  applyChanges(changes,from,to) {
    for(const c of changes)if(c[from]){
      if(c.parcel){this.parcels.delete(c[from].id);this.parcelSpatial.erase(c[from].id);}
      else this.erase(c[from].id);
    }
    for(const c of changes)if(c[to]){
      if(c.parcel)this.insertParcel(c[to]);
      else this.insert(c[to]);
    }
    if(changes.some(roadChanged)){
      this.roadRevision=nextRoadRevision(this.roadRevision);
      this._roadNetwork=null;
    }
  }
  insertParcel(parcel,bounds=outlineBounds(parcelOutline(parcel))) {
    this.parcels.set(parcel.id,parcel);
    this.parcelSpatial.insert(parcel.id,bounds);
  }
  guardEdit(changes,to){
    this.editError=changes?.length?this.editGuard?.(changes,to):null;
    return !!changes?.length&&!this.editError;
  }
  commit(changes) {
    if (!this.guardEdit(changes,'after')) return false;
    this.applyChanges(changes,'before','after');
    this.undoStack.push(changes); if (this.undoStack.length > 80) this.undoStack.shift(); this.redoStack = []; return true;
  }
  place(type,x,z,rotation=0,color=0) {
    this.editError=null;
    const e = { id: this.nextId, type, x, z, rotation, color };
    if (this.canPlace(e)) return false;
    if(!this.commit([{before:null,after:e}]))return false;
    this.nextId++;return e;
  }
  paintPlan(type,cells) {
    if(!BY_ID[type]||BY_ID[type].w!==1||BY_ID[type].d!==1)return [];
    const placements = [], visited = new Set();
    for (const [x,z] of cells) {
      if(this.entities.size+placements.length>=MAX_ENTITIES)break;
      if (visited.has(key(x,z))) continue; visited.add(key(x,z));
      const old = this.at(x,z);
      if (old?.type === type) continue;
      const e = {id:this.nextId+placements.length,type,x,z,rotation:0,color:0};
      if (this.canPlace(e)) continue;
      placements.push(e);
    }
    return placements;
  }
  paint(type,cells) {
    const placements=this.paintPlan(type,cells);
    if(!this.commit(placements.map(after=>({before:null,after}))))return false;
    this.nextId+=placements.length;
    return true;
  }
  move(id,x,z,rotation) {
    this.editError=null;
    const old = this.entities.get(id); if (!old||old.pose||old.alignment) return false;
    const e = {...old,x,z,rotation}; if (this.canPlace(e,id)) return false;
    return this.commit([{before:{...old},after:e}]);
  }
  planRoadAlignment(raw,id) {
    const before=id==null?null:this.entities.get(id);
    if(id!=null&&!before?.alignment)return {error:'请选择可编辑的曲线道路'};
    if(!before&&this.nextId>=Number.MAX_SAFE_INTEGER)return {error:'当前城市物件编号已达到上限'};
    let alignment;
    try{alignment=readAlignment(raw);}catch(error){return {error:error.message};}
    const entity={id:before?.id??this.nextId,type:'road',color:before?.color??0,alignment};
    return {entity,before,geometry:alignmentGeometry(alignment),structure:elevatedStructure(alignment,this.terrain),error:this.canPlace(entity,before?.id)};
  }
  editRoadAlignment(raw,id) {
    const {entity,before,error}=this.planRoadAlignment(raw,id);
    if(error)return {error,changed:false};
    if(before&&before.alignment.elevated===entity.alignment.elevated&&before.alignment.arc===entity.alignment.arc
      &&['start','end'].every(key=>before.alignment[key].every((n,i)=>n===entity.alignment[key][i])))return {entity:before,changed:false};
    const changed=this.commit([{before,after:entity}]);
    if(changed&&!before)this.nextId++;
    return {entity,changed,error:this.editError};
  }
  resizeParcel(id,width,depth) {
    const parcel=this.parcels.get(id);
    return !!parcel&&this.editParcel({...parcel,width,depth}).changed;
  }
  planParcelEdit(raw,building) {
    let parcel;
    try{parcel=normalizeParcel(raw);}catch(error){return {error:error.message};}
    if(parcel.grid)return {error:'请选择自定义地块'};
    const before=this.parcels.get(parcel.id),owner=before&&this.parcelOwner(before);
    if(!before&&this.parcels.size>=MAX_ENTITIES)return {error:'地块超过存档容量上限'};
    const parcelChanged=!before||['x','z','width','depth','angle'].some(key=>parcel[key]!==before[key]);
    if(!parcelChanged)parcel=before;
    const values=building??(owner&&{...owner,...owner.pose});
    let entity;
    if(values){
      const {type,color,offsetX,offsetZ,angle}=values;
      if(!usesParcel(type)||(owner&&owner.type!==type)||![offsetX,offsetZ,angle].every(Number.isFinite)
        ||!Number.isInteger(color)||color<0||color>3)return {parcel,error:'建筑参数无效'};
      if(!owner&&this.nextId>=Number.MAX_SAFE_INTEGER)return {parcel,error:'当前城市物件编号已达到上限'};
      entity={id:owner?.id??this.nextId,type,color,pose:{parcel,offsetX,offsetZ,angle:normalAngle(angle)}};
    }
    if(parcelChanged){
      const outline=parcelOutline(parcel),error=this.parcelPlacementError(parcel,outline,outlineBounds(outline),owner?.id);
      if(error)return {parcel,entity,error};
    }
    const error=entity&&this.canPlace(entity,owner?.id);
    if(error)return {parcel,entity,error};
    const changes=[];
    if(parcelChanged)changes.push({parcel:true,before,after:parcel});
    if(entity&&(parcelChanged||!owner||colorOrPoseChanged(owner,entity)))changes.push({before:owner,after:entity});
    return {parcel,entity,changes,allocatesId:!!entity&&!owner};
  }
  editParcel(parcel,building) {
    const plan=this.planParcelEdit(parcel,building);
    if(plan.error)return {error:plan.error,changed:false};
    if(plan.allocatesId)this.nextId++;
    return {parcel:plan.parcel,entity:plan.entity,changed:this.commit(plan.changes)};
  }
  removeEmptyParcel(id) {
    const parcel=this.parcels.get(id);
    return !!parcel&&!this.parcelOwner(parcel)&&this.commit([{parcel:true,before:parcel}]);
  }
  remove(id) { const e=this.entities.get(id); return e && this.commit([{before:{...e},after:null}]); }
  recolor(id) { const e=this.entities.get(id); return e && this.commit([{before:{...e},after:{...e,color:(e.color+1)%4}}]); }
  undo() {
    const changes=this.undoStack.at(-1); if (!this.guardEdit(changes,'before')) return false;
    this.undoStack.pop();
    this.applyChanges(changes,'after','before');
    this.redoStack.push(changes); return true;
  }
  redo() {
    const changes=this.redoStack.at(-1); if(!this.guardEdit(changes,'after')) return false;
    this.redoStack.pop();
    this.applyChanges(changes,'before','after');
    this.undoStack.push(changes); return true;
  }
  expand() { if(this.radius>=4096)return false;this.radius=Math.min(4096,this.radius+CHUNK);return true; }
  get roadNetwork(){return this._roadNetwork??=buildRoadNetwork(this.entities.values(),this.roadRevision,this.terrain);}
  roadNeighbors(e) {
    if(!hasTraffic(e.type))return [];
    const segment=this.roadNetwork.segments.get(e.id);
    return segment?.ports.map(port=>this.entities.get(port.neighborId))??[];
  }
  snapshotHeader(version=VERSION) {
    const mixed=this.alignmentCount>0;
    if(![2,PARCEL_VERSION,GRID_ROAD_VERSION,ALIGNMENT_ROAD_VERSION,ELEVATED_ROAD_VERSION,VERSION].includes(version)||(version===2&&this.parcels.size)
      ||(version<ALIGNMENT_ROAD_VERSION&&mixed)
      ||(version<ELEVATED_ROAD_VERSION&&(this.terrain==='strait'||mixed&&[...this.entities.values()].some(e=>e.alignment?.elevated)))
      ||(version<VERSION&&mixed&&[...this.entities.values()].some(e=>e.alignment?.arc)))throw new Error('无法导出为该存档格式');
    return {version,terrain:this.terrain,name:this.name,radius:this.radius,nextId:this.nextId,environment:{...this.environment},
      ...(version>=GRID_ROAD_VERSION?{roads:roadHeader(this.roadRevision,mixed)}:{})};
  }
  *snapshotEntries(version=VERSION) {
    if(version>=PARCEL_VERSION)for(const parcel of this.parcels.values())yield {parcel:{...parcel}};
    for(const e of this.entities.values()){
      const lot=e.lot?{lot:[...e.lot]}:{};
      if(e.alignment)yield {entity:{...e,alignment:{...e.alignment,start:[...e.alignment.start],end:[...e.alignment.end]}}};
      else if(version>=GRID_ROAD_VERSION&&isRoad(e.type)){
        const {id,type,rotation,color}=e;
        yield {entity:{id,type,rotation,color,center:roadCenter(e),...lot}};
      }else if(version===2||!usesParcel(e.type))yield {entity:{...e,...lot}};
      else {
        const parcel=e.pose?.parcel||legacyParcel(e);
        yield {parcel:e.pose?undefined:parcel,entity:{id:e.id,type:e.type,color:e.color,parcelId:parcel.id,
          offsetX:e.pose?.offsetX??0,offsetZ:e.pose?.offsetZ??0,angle:e.pose?.angle??0,...lot}};
      }
    }
  }
  snapshot(version=VERSION) {
    const header=this.snapshotHeader(version),entities=[],parcels=[];
    for(const {entity,parcel} of this.snapshotEntries(version)){
      if(entity)entities.push(entity);
      if(parcel)parcels.push(parcel);
    }
    return {...header,entities,...(version>=PARCEL_VERSION?{parcels}:{})};
  }
  restore(raw) {
    if (!raw || !supportedCityVersion(raw.version) || !Array.isArray(raw.entities) || raw.entities.length>MAX_ENTITIES || !Number.isInteger(raw.radius) || raw.radius<16 || raw.radius>4096) throw new Error('存档格式不受支持');
    const next = new City(); next.radius=raw.radius;next.terrain=raw.version===1?'legacy':raw.terrain;
    const terrains=raw.version>=ELEVATED_ROAD_VERSION?['legacy','meander','strait']:['legacy','meander'];
    if(!terrains.includes(next.terrain))throw new Error('未知地形');
    const ids = new Set();
    const mixed=raw.entities.some(e=>e?.alignment!==undefined);
    if(mixed&&raw.version<ALIGNMENT_ROAD_VERSION)throw new Error('曲线道路需要新版存档');
    if(raw.version>=GRID_ROAD_VERSION)next.roadRevision=readRoadHeader(raw.roads,mixed);
    const parcels=new Map(),used=new Set();
    if(raw.version>=PARCEL_VERSION){
      if(!Array.isArray(raw.parcels)||raw.parcels.length>MAX_ENTITIES+raw.entities.length)throw new Error('存档缺少有效地块列表');
      for(const value of raw.parcels){
        const p=normalizeParcel(value);
        if(parcels.has(p.id))throw new Error('存档含有重复地块');
        parcels.set(p.id,p);
        if(p.grid)continue;
        if(next.parcels.size>=MAX_ENTITIES)throw new Error('地块超过存档容量上限');
        const outline=parcelOutline(p),bounds=outlineBounds(outline),error=next.parcelPlacementError(p,outline,bounds);
        if(error)throw new Error(error);
        next.insertParcel(p,bounds);
      }
    }
    for (const original of raw.entities) {
      let e=raw.version===1&&original?{...original,lot:LEGACY_LOTS[original.type]}:original;
      const lotValid=!e?.lot||(Array.isArray(e.lot)&&e.lot.length===2&&e.lot.every((v,i)=>v===LEGACY_LOTS[e.type]?.[i]));
      if (!e || !Object.hasOwn(BY_ID,e.type) || !lotValid || !Number.isSafeInteger(e.id) || e.id<1 || ids.has(e.id) || !Number.isInteger(e.color) || e.color<0 || e.color>3) throw new Error('存档包含无效或重复建筑');
      if(e.alignment!==undefined){
        if(e.type!=='road'||['x','z','center','lot','rotation','parcelId'].some(key=>e[key]!==undefined))throw new Error('曲线道路记录无效');
        if(e.alignment?.elevated&&raw.version<ELEVATED_ROAD_VERSION)throw new Error('高架道路需要 v6 存档');
        if(e.alignment?.arc&&raw.version<VERSION)throw new Error('圆弧道路需要 v7 存档');
        e={id:e.id,type:e.type,color:e.color,alignment:readAlignment(e.alignment)};
      }else if(raw.version>=PARCEL_VERSION&&usesParcel(e.type)){
        if(used.has(e.parcelId))throw new Error('每个地块只能有一栋主建筑');
        const parcel=parcels.get(e.parcelId);
        e=readParcelEntity(e,parcel);
        used.add(parcel.id);
      }else{
        if(raw.version>=PARCEL_VERSION&&e.parcelId!==undefined)throw new Error('道路或装饰不能引用建筑地块');
        if(raw.version>=GRID_ROAD_VERSION&&isRoad(e.type))e=readGridRoad(e);
        const {id,type,x,z,rotation,color,lot}=e;
        e={id,type,x,z,rotation,color,...(lot?{lot:[...lot]}:{})};
      }
      if(!e.pose&&!e.alignment&&(!Number.isInteger(e.rotation)||e.rotation<0||e.rotation>3))throw new Error('存档包含无效建筑朝向');
      const error=next.canPlace(e,undefined,{allowHistoricBank:true});
      if(error)throw new Error(error);
      ids.add(e.id); next.insert(e);
    }
    for(const p of parcels.values())if(p.grid&&!used.has(p.id))throw new Error('兼容地块缺少原建筑');
    this.name=String(raw.name || '未命名城市').slice(0,40);this.terrain=next.terrain;this.radius=next.radius; this.entities=next.entities; this.occupancy=next.occupancy; this.chunks=next.chunks;this.spatial=next.spatial;
    this.parcels=next.parcels;this.parcelSpatial=next.parcelSpatial;this.meshRevisions=next.meshRevisions;
    this.roadRevision=next.roadRevision;this._roadNetwork=null;this._waterfront=null;this.alignmentCount=next.alignmentCount;
    this.nextId=[...ids].reduce((max,id)=>Math.max(max,id),0)+1;
    if(Number.isSafeInteger(raw.nextId)&&raw.nextId>this.nextId)this.nextId=raw.nextId;
    const env=raw.environment || {};
    for(const [field,options] of Object.entries({season:['spring','summer','autumn','winter'],weather:['clear','cloudy','rain','snow','fog'],quality:['high','balanced']})) if(options.includes(env[field])) this.environment[field]=env[field];
    for(const [field,min,max] of [['hour',0,24],['speed',0.25,8],['wind',0,1]]) if(Number.isFinite(env[field])) this.environment[field]=Math.max(min,Math.min(max,env[field]));
    this.environment.playing=!!env.playing;
    this.undoStack=[]; this.redoStack=[];
  }
}
export function createDemo() {
  const c=new City();c.name='河湾花园城';c.environment.hour=15;
  const add=(type,x,z,rotation=0,color=0)=>{const e={id:c.nextId,type,x,z,rotation,color};if(c.canPlace(e,undefined,{allowHistoricBank:true}))return false;c.insert(e);c.nextId++;return true;};
  const road=(a,b)=>{for(const [x,z] of gridLine(a,b)){if(!add('road',x,z)&&!c.at(x,z))add('bridge',x,z);}};
  // Three crossings and offset local streets, rather than a single repeated square grid.
  for(const z of [-17,1,20])road([-34,z],[34,z]);
  road([-25,-24],[-25,20]);road([22,-23],[22,20]);
  for(const points of [[[-34,-17],[-34,-8],[-29,-8],[-29,1]],[[-34,1],[-34,14],[-30,14],[-30,20]],[[34,-17],[34,-4],[30,-4],[30,1]],[[34,1],[34,15],[30,15],[30,20]],[[-25,-7],[-15,-7],[-15,1]],[[-25,10],[-17,10],[-17,20]],[[22,-8],[13,-8],[13,1]]])for(let i=1;i<points.length;i++)road(points[i-1],points[i]);
  // A skyline grows behind the cultural waterfront, with a low leisure district in front.
  for(const [type,x,z,r] of [
    ['glass-tower',15,-22,0],['office',19,-22,0],['terrace-tower',24,-22,0],['hotel',28,-21,0],['residence',31,-22,0],
    ['office',16,-15,0],['residence',19,-12,0],['terrace-tower',24,-15,0],['hotel',28,-14,0],['mint-apartment',32,-12,0],
    ['mall',15,-5,0],['museum',24,-5,0],['library',27,-3,0],['school',31,-2,0],
    ['amusement',24,4,0],['plaza',24,11,0],['market',16,4,0],['cafe',19,8,0],['bookshop',19,11,0],['garden',16,13,0],
    ['park',30,9,0],['garden',31,16,0],['clinic',-23,3,0],['clocktower',-18,3,0],['school',-33,3,0],['library',-23,13,0],
    ['plaza',-21,6,0],['grove',-32,16,0],['museum',-23,-12,0]
  ])add(type,x,z,r);
  const homes=['cottage','townhouse','rose-house','sage-house','villa','apartment','mint-apartment'];let n=0;
  // Close frontages, staggered gardens and mixed heights give streets a lived-in rhythm.
  for(const z of [-22,-19.5,-15,-11,-5,-1.5,3,6,11.5,16.5])for(const x of [-32,-29.5,-23,-20.5,-18,-15.5,-13]){
    const type=homes[n%homes.length];add(type,x,z,n%4===0?2:0,n%4);n++;
  }
  for(const z of [-12,-9,3,11,16])for(const x of [24,27,30,32]){add(n%3?'apartment':'townhouse',x,z,0,n%4);n++;}
  for(const [x,z,type] of [[-28,-4,'cafe'],[-28,4,'bakery'],[-23,17,'bookshop'],[-17,-5,'market'],[-19,14,'cafe'],[16,17,'bakery'],[19,16,'bookshop'],[27,17,'cafe']])add(type,x,z);
  // The continuous curved quay is terrain; these smaller paths connect destinations to it.
  for(let z=-25;z<=25;z+=1)for(const side of [-1,1]){
    const bank=(riverCenter(z*CELL)+side*(riverWidth(z*CELL)+4))/CELL;
    const x=side>0?Math.ceil(bank):Math.floor(bank);add('path',x,z);
    if(z%4===0)add('tree',x+side,z);if(z%7===0)add('bench',x+side,z+1);
    if(z%8===0)add('flowers',x+side*2,z+1);
  }
  for(const z of [-10,8,17])add('pier',Math.floor((riverCenter(z*CELL)-riverWidth(z*CELL)+3)/CELL),z);
  for(const x of [-35,-26,23,35])for(let z=-22;z<21;z+=4)add('tree',x,z);
  for(const z of [-18,21])for(let x=-32;x<34;x+=4)add(x%3?'tree':'cherry',x,z);
  // Small infill gardens and footpaths occupy useful gaps, leaving the outer landscape quiet.
  for(let x=-33;x<34;x+=2)for(let z=-21;z<20;z+=2){
    if(Math.abs(x)<10||!c.at(x-1,z)&&!c.at(x+1,z)&&!c.at(x,z-1)&&!c.at(x,z+1))continue;
    if((x+z)%5===0)add('garden',x,z);else if((x-z)%4===0)add('flowers',x,z);
  }
  c.undoStack=[];return c;
}
