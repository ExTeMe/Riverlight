import { BY_ID, CELL, CHUNK, SNAP, LEGACY_LOTS, entityDimensions } from './catalog.js';
export const VERSION = 2;
export const MAX_ENTITIES = 100000;
export const key = (x, z) => `${x},${z}`;
export const riverCenter = (z,terrain='meander') => terrain==='legacy'?Math.sin(z*.016)*11+Math.sin(z*.004)*9:Math.sin(z*.025)*23+Math.sin(z*.009)*10;
export const riverWidth = (z,terrain='meander') => terrain==='legacy'?11.9:11.3+1.8*Math.sin(z*.033+.6)+5*Math.exp(-(((z-30)/26)**2));
export const waterAt = (x,z,terrain='meander') => Math.abs(x*CELL-riverCenter(z*CELL,terrain))<riverWidth(z*CELL,terrain)-1.4;
export const chunkKey = (x, z) => key(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
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
    this.name = '河光之城'; this.terrain='meander';this.radius = 64; this.entities = new Map(); this.occupancy = new Map(); this.chunks = new Map();
    this.environment = { season: 'summer', weather: 'clear', hour: 16.5, playing: false, speed: 1, wind: 0.4, quality: 'high' };
    this.undoStack = []; this.redoStack = []; this.nextId = 1;
    if (data) this.restore(data);
  }
  at(x, z) { return this.entities.get(this.occupancy.get(key(Math.floor(x/SNAP)*SNAP,Math.floor(z/SNAP)*SNAP))); }
  canPlace(e, ignoreId) {
    if (!BY_ID[e.type]) return '未知建筑';
    if(!Number.isInteger(e.x/SNAP)||!Number.isInteger(e.z/SNAP))return '请对齐建造网格';
    if(['road','bridge','path'].includes(e.type)&&(!Number.isInteger(e.x)||!Number.isInteger(e.z)))return '道路请对齐主路网';
    if(this.entities.size>=MAX_ENTITIES&&!ignoreId)return '当前城市物件已达到存档容量上限';
    for (const [x, z] of footprint(e)) {
      if (x < -this.radius || x >= this.radius || z < -this.radius || z >= this.radius) return '这里还未扩展，点击「扩展地图」';
      const occupied = this.at(x, z);
      if (occupied && occupied.id !== ignoreId) return '这里已有建筑';
      if (waterAt(this.terrain==='legacy'?Math.floor(x):x,this.terrain==='legacy'?Math.floor(z):z,this.terrain) && !['bridge', 'pier'].includes(e.type)) return e.type === 'road' ? '水面请使用桥梁工具' : '请选择陆地区域';
      if (e.type === 'pier' && !footprint(e).some(([px,pz]) => waterAt(px,pz,this.terrain))) return '码头需要接触水面';
    }
    return null;
  }
  insert(e) {
    this.entities.set(e.id, { ...e });
    for (const [x,z] of footprint(e)) this.occupancy.set(key(x,z), e.id);
    const ck = chunkKey(e.x,e.z); if (!this.chunks.has(ck)) this.chunks.set(ck,new Set()); this.chunks.get(ck).add(e.id);
  }
  erase(id) {
    const e = this.entities.get(id); if (!e) return;
    for (const [x,z] of footprint(e)) this.occupancy.delete(key(x,z));
    this.entities.delete(id); const ck = chunkKey(e.x,e.z); this.chunks.get(ck)?.delete(id); if (!this.chunks.get(ck)?.size) this.chunks.delete(ck);
  }
  commit(changes) {
    if (!changes.length) return false;
    for (const c of changes) if (c.before) this.erase(c.before.id);
    for (const c of changes) if (c.after) this.insert(c.after);
    this.undoStack.push(changes); if (this.undoStack.length > 80) this.undoStack.shift(); this.redoStack = []; return true;
  }
  place(type,x,z,rotation=0,color=0) {
    const e = { id: this.nextId, type, x, z, rotation, color };
    if (this.canPlace(e)) return false;
    this.nextId++; this.commit([{before:null,after:e}]); return e;
  }
  paint(type,cells) {
    if(!BY_ID[type]||BY_ID[type].w!==1||BY_ID[type].d!==1)return false;
    const changes = [], visited = new Set();
    for (const [x,z] of cells) {
      if(this.entities.size+changes.length>=MAX_ENTITIES)break;
      if (visited.has(key(x,z))) continue; visited.add(key(x,z));
      const old = this.at(x,z);
      if (old?.type === type) continue;
      const e = {id:this.nextId,type,x,z,rotation:0,color:0};
      if (this.canPlace(e)) continue;
      this.nextId++; changes.push({before:null,after:e});
    }
    return this.commit(changes);
  }
  move(id,x,z,rotation) {
    const old = this.entities.get(id); if (!old) return false;
    const e = {...old,x,z,rotation}; if (this.canPlace(e,id)) return false;
    return this.commit([{before:{...old},after:e}]);
  }
  remove(id) { const e=this.entities.get(id); return e && this.commit([{before:{...e},after:null}]); }
  recolor(id) { const e=this.entities.get(id); return e && this.commit([{before:{...e},after:{...e,color:(e.color+1)%4}}]); }
  undo() {
    const changes=this.undoStack.pop(); if (!changes) return false;
    for (const c of changes) if(c.after) this.erase(c.after.id);
    for (const c of changes) if(c.before) this.insert(c.before);
    this.redoStack.push(changes); return true;
  }
  redo() {
    const changes=this.redoStack.pop(); if(!changes) return false;
    for(const c of changes) if(c.before) this.erase(c.before.id);
    for(const c of changes) if(c.after) this.insert(c.after);
    this.undoStack.push(changes); return true;
  }
  expand() { if(this.radius>=4096)return false;this.radius=Math.min(4096,this.radius+CHUNK);return true; }
  roadNeighbors(e) { return [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dz])=>this.at(e.x+dx,e.z+dz)).filter(n=>n && ['road','bridge'].includes(n.type)); }
  snapshot() { return {version:VERSION,terrain:this.terrain,name:this.name,radius:this.radius,nextId:this.nextId,environment:{...this.environment},entities:[...this.entities.values()].map(e=>({...e, ...(e.lot?{lot:[...e.lot]}:{})}))}; }
  restore(raw) {
    if (!raw || ![1,VERSION].includes(raw.version) || !Array.isArray(raw.entities) || raw.entities.length>MAX_ENTITIES || !Number.isInteger(raw.radius) || raw.radius<16 || raw.radius>4096) throw new Error('存档格式不受支持');
    const next = new City(); next.radius=raw.radius;next.terrain=raw.version===1?'legacy':raw.terrain;if(!['legacy','meander'].includes(next.terrain))throw new Error('未知地形');const ids = new Set();
    for (const original of raw.entities) {
      const e=raw.version===1&&original?{...original,lot:LEGACY_LOTS[original.type]}:original;
      const lotValid=!e?.lot||(Array.isArray(e.lot)&&e.lot.length===2&&e.lot.every((v,i)=>v===LEGACY_LOTS[e.type]?.[i]));
      if (!e || !BY_ID[e.type] || !lotValid || !Number.isSafeInteger(e.id) || e.id<1 || ids.has(e.id) || !Number.isInteger(e.x/SNAP) || !Number.isInteger(e.z/SNAP) || !Number.isInteger(e.rotation) || e.rotation<0 || e.rotation>3 || !Number.isInteger(e.color) || e.color<0 || e.color>3 || next.canPlace(e)) throw new Error('存档包含无效或重叠建筑');
      ids.add(e.id); next.insert(e);
    }
    this.name=String(raw.name || '未命名城市').slice(0,40);this.terrain=next.terrain;this.radius=next.radius; this.entities=next.entities; this.occupancy=next.occupancy; this.chunks=next.chunks;
    this.nextId=[...ids].reduce((max,id)=>Math.max(max,id),0)+1;
    const env=raw.environment || {};
    for(const [field,options] of Object.entries({season:['spring','summer','autumn','winter'],weather:['clear','cloudy','rain','snow','fog'],quality:['high','balanced']})) if(options.includes(env[field])) this.environment[field]=env[field];
    for(const [field,min,max] of [['hour',0,24],['speed',0.25,8],['wind',0,1]]) if(Number.isFinite(env[field])) this.environment[field]=Math.max(min,Math.min(max,env[field]));
    this.environment.playing=!!env.playing;
    this.undoStack=[]; this.redoStack=[];
  }
}
export function createDemo() {
  const c=new City();c.name='河湾花园城';c.environment.hour=15;
  const add=(type,x,z,rotation=0,color=0)=>{const e={id:c.nextId,type,x,z,rotation,color};if(c.canPlace(e))return false;c.insert(e);c.nextId++;return true;};
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
