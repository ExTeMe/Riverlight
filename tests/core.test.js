import test from 'node:test';
import assert from 'node:assert/strict';
import { City, createDemo, gridLine, footprint, waterAt } from '../src/core.js';
import { CATALOG, entityDimensions } from '../src/catalog.js';
import { SpatialIndex, legacyFootprintBounds, legacyPlacement, legacySnap } from '../src/space.js';
import { getTemplate, getDistantTemplate, registerArchitectureAsset, animateImportedAssets } from '../src/models.js';
import { animateArchitecture } from '../src/architecture.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readFile, stat } from 'node:fs/promises';
import { Box3, BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, Scene, Texture, Vector3 } from 'three';
import { World } from '../src/world.js';
import { buildWalkNetwork, walkingRoute } from '../src/walk-network.js';
import { Pedestrians } from '../src/pedestrians.js';

test('buildings reserve their entire rotated footprint; failed moves preserve the original',()=>{
 const city=new City();const house=city.place('villa',-30,-10);assert.ok(house);assert.equal(footprint(house).length,24);assert.equal(city.place('cottage',-29,-10),false);
 const other=city.place('cottage',-24,-10);assert.ok(other);assert.equal(city.move(house.id,-24,-10,1),false);assert.equal(city.at(-30,-10).id,house.id);
 assert.ok(city.move(house.id,-30,-6,1));assert.equal(city.at(-30,-10),undefined);assert.equal(city.at(-29,-4).id,house.id);
});
test('metre footprints query both sides of a partition and survive history and save round trips',()=>{
 const c=new City(),library=c.place('library',-17,-3.5);
 assert.ok(library);
 const left={minX:-72,minZ:-16,maxX:-64,maxZ:-6},right={...left,minX:-64,maxX:-56};
 const area={...left,maxX:-56};
 for(const bounds of [left,right,area])assert.deepEqual(c.queryFootprints(bounds).map(e=>e.id),[library.id]);
 const footprint=legacyFootprintBounds(library);
 assert.deepEqual(footprint,{minX:-70,minZ:-16,maxX:-58,maxZ:-6});
 const touching={...footprint,minX:-58,maxX:-56};
 assert.deepEqual(c.queryFootprints(touching),[]);
 const small=new SpatialIndex(4);
 small.insert(library.id,footprint);
 small.insert(99,{minX:0,minZ:0,maxX:4,maxZ:4});
 for(const bounds of [left,right,area,touching])assert.deepEqual(small.query(bounds),c.queryFootprints(bounds).map(e=>e.id));
 assert.ok(c.move(library.id,-22,-6,1));
 assert.deepEqual(c.queryFootprints(area),[]);
 assert.ok(c.undo());
 assert.deepEqual(new City(c.snapshot()).queryFootprints(area),[library]);
 assert.ok(c.redo());
 assert.deepEqual(c.queryFootprints(area),[]);
});
test('legacy snap, rotation, terrain height and editable edges keep their metre meanings',()=>{
 const c=new City();
 assert.equal(legacySnap(-3,.5),-.5);
 assert.equal(legacySnap(-3,1),-1);
 assert.deepEqual(c.worldBounds(),{minX:-258,minZ:-258,maxX:254,maxZ:254});
 assert.deepEqual(c.surfaceAt(0,0),{groundY:null,waterY:-.4});
 assert.deepEqual(c.surfaceAt(-64,-12),{groundY:0,waterY:null});
 const e=c.place('cottage',-64,62.5,1);
 assert.ok(e);
 assert.equal(legacyFootprintBounds(e).maxZ,254);
 assert.deepEqual(legacyPlacement(e),{x:-254,z:251,radians:Math.PI/2,scaleX:1,scaleZ:1});
 assert.equal(c.move(e.id,-64,63,1),false);
});
test('undo and redo restore data, occupancy and chunk indexes across a boundary',()=>{
 const city=new City();const e=city.place('cottage',-18,5);city.move(e.id,20,5,1);city.undo();assert.equal(city.at(-18,5).id,e.id);assert.equal(city.at(20,5),undefined);city.redo();assert.equal(city.at(20,5).id,e.id);
 city.remove(e.id);city.undo();assert.equal(city.at(20,5).id,e.id);assert.equal([...city.chunks.values()].reduce((n,s)=>n+s.size,0),1);
});
test('roads are orthogonally continuous and painting is one reversible action',()=>{
 const c=new City();const line=gridLine([-22,0],[-12,8]);assert.deepEqual(line[0],[-22,0]);assert.deepEqual(line.at(-1),[-12,8]);
 for(let i=1;i<line.length;i++)assert.equal(Math.abs(line[i][0]-line[i-1][0])+Math.abs(line[i][1]-line[i-1][1]),1);
 c.paint('road',line);assert.equal(c.entities.size,line.length);c.undo();assert.equal(c.entities.size,0);c.redo();assert.equal(c.entities.size,line.length);
});
test('water needs bridges; a bridge participates in the same traversable road graph',()=>{
 const c=new City();assert.equal(waterAt(0,0),true);assert.equal(c.place('road',0,0),false);const bridge=c.place('bridge',0,0);assert.ok(bridge);c.place('bridge',1,0);assert.equal(c.roadNeighbors(bridge).length,1);
});
test('expansion permits new builds and survives serialization',()=>{
 const c=new City();assert.equal(c.place('cottage',70,0),false);c.expand();assert.ok(c.place('cottage',70,0));const restored=new City(c.snapshot());assert.equal(restored.radius,80);assert.equal(restored.entities.size,1);
});
test('demo has connected crossings and roundtrips without overlapping objects',()=>{
 const c=createDemo(),roundtrip=new City(c.snapshot());assert.deepEqual(roundtrip.snapshot(),c.snapshot());assert.ok(c.entities.size>500);
 const bridge=[...c.entities.values()].find(e=>e.type==='bridge');assert.ok(c.roadNeighbors(bridge).length>0);
});
test('invalid import is rejected without mutating an existing city',()=>{
 const c=createDemo(),before=c.snapshot();const bad=c.snapshot();bad.entities.push({...bad.entities[0]});assert.throws(()=>c.restore(bad));assert.deepEqual(c.snapshot(),before);
 const future=c.snapshot();future.version=99;assert.throws(()=>new City(future));
});
test('all model variants have finite vertices and material assignments',()=>{
 for(const item of CATALOG){const model=getTemplate(item.id);assert.ok(model.children.length>0,item.id);model.traverse(mesh=>{if(!mesh.isMesh)return;assert.ok(mesh.material,item.id);for(const value of mesh.geometry.attributes.position.array)assert.ok(Number.isFinite(value),item.id);});}
});
test('amusement rides move independently and ferris cabins remain upright',()=>{
 const model=getTemplate('amusement').clone(true),other=getTemplate('amusement').clone(true);animateArchitecture(model,8);model.updateMatrixWorld(true);
 assert.notEqual(model.getObjectByName('rotor').rotation.z,other.getObjectByName('rotor').rotation.z);
 const cabin=model.getObjectByName('gondola'),up=new Vector3(0,1,0).transformDirection(cabin.matrixWorld);assert.ok(up.distanceTo(new Vector3(0,1,0))<.00001);
 assert.notEqual(model.getObjectByName('carousel').rotation.y,0);
});
test('every non-road catalog asset loads its authored Blender model and distant variant',async()=>{
 for(const item of CATALOG.filter(item=>!['road','bridge','path'].includes(item.id))){
  for(const lod of [false,true]){
   const stem=item.id==='mall'?'shopping-gallery':item.id;
   const file=await readFile(new URL(`../public/models/${stem}${lod?'_lod':''}.glb`,import.meta.url));
   const gltf=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
   registerArchitectureAsset(item.id,gltf.scene,gltf.animations,lod);
   const model=lod?getDistantTemplate(item.id):getTemplate(item.id);assert.equal(model.userData.source,'Blender MCP',item.id);
   model.traverse(m=>{if(m.isMesh)for(const value of m.geometry.attributes.position.array)assert.ok(Number.isFinite(value),item.id);});
  }
 }
 for(const [type,name] of [['mall','Mall_RevolvingDoor'],['amusement','amusement_Wheel_Rotor'],['amusement','amusement_Carousel']]){
  const model=getTemplate(type).clone(true),node=model.getObjectByName(name);assert.ok(node,name);
  animateImportedAssets(model,0);const before=node.quaternion.clone();animateImportedAssets(model,2);assert.ok(before.angleTo(node.quaternion)>.1,name);
 }
 const plaza=getTemplate('plaza').clone(true),jets=plaza.getObjectByName('plaza_Fountain_Jets');
 assert.ok(jets);
 animateImportedAssets(plaza,0);const initialScale=jets.scale.clone();
 animateImportedAssets(plaza,2);assert.ok(initialScale.distanceTo(jets.scale)>.1);
});
test('world boundaries contain the advertised number of cells and expansion stops safely',()=>{
 const c=new City();assert.ok(c.place('tree',-64,-64));assert.ok(c.place('tree',63,63));assert.equal(c.place('tree',64,63),false);
 c.radius=4095;assert.equal(c.expand(),true);assert.equal(c.radius,4096);assert.equal(c.expand(),false);
});
test('half-cell footprints move, rotate, reject overlaps and survive saves',()=>{
 const c=new City(),e=c.place('cottage',-30.5,-10.5);assert.ok(e);assert.equal(footprint(e).length,12);
 assert.equal(c.place('lamp',-30,-10),false);assert.ok(c.place('cottage',-29,-10.5));
 assert.equal(c.place('road',-40.5,-10),false);assert.equal(c.place('cottage',-40.1,-10),false);
 assert.ok(c.move(e.id,-26.5,-6.5,1));assert.deepEqual(entityDimensions(c.entities.get(e.id)),[2,1.5]);
 const restored=new City(c.snapshot());assert.deepEqual(restored.snapshot(),c.snapshot());c.undo();assert.equal(c.at(-30.5,-10.5).id,e.id);
});
test('version-one cities retain old footprints, positions and original river',()=>{
 const c=new City(),raw=c.snapshot();raw.version=1;delete raw.terrain;raw.entities=[{id:1,type:'cottage',x:-30,z:-10,rotation:1,color:2}];
 const migrated=new City(raw);assert.equal(migrated.terrain,'legacy');assert.deepEqual(entityDimensions(migrated.entities.get(1)),[2,2]);assert.equal(migrated.at(-28.5,-8.5).id,1);
 assert.deepEqual(new City(migrated.snapshot()).snapshot(),migrated.snapshot());
});
test('all four road corners have upward surfaces and a continuous pedestrian turn',()=>{
 for(const [sx,sz,mask] of [[1,1,5],[-1,1,6],[1,-1,9],[-1,-1,10]]){
  const model=getTemplate('road',0,mask);assert.equal(model.userData.roadShape,'arc');model.traverse(m=>{if(m.isMesh)for(let i=1;i<m.geometry.attributes.normal.array.length;i+=3)assert.ok(m.geometry.attributes.normal.array[i]>.99);});
  const c=new City();c.place('road',-30,-30);c.place('road',-30+sx,-30);c.place('road',-30,-30+sz);
  const net=buildWalkNetwork(c),offset=c.roadNetwork.segments.values().next().value.profile.sidewalks[1].offset;
  assert.ok(net.components.some(group=>group.some(n=>n.x===(-30+sx)*4+sx*offset)&&group.some(n=>n.z===(-30+sz)*4+sz*offset)),'pavements join across a curved corner');
 }
});
test('autonomous pedestrians follow valid edges, move over time, and rebuild after roads disappear',()=>{
 const c=new City();for(let x=-35;x<=-15;x++)c.place('road',x,-30);
 const net=buildWalkNetwork(c);assert.ok(net.components.length);const route=walkingRoute(net,net.components[0][0],12);
 for(let i=1;i<route.length;i++)assert.ok(route[i-1].edges.has(route[i].id));
 const people=new Pedestrians(new Scene());people.rebuild(c);assert.ok(people.walkers.length>0);const before=people.walkers.map(w=>[w.x,w.z]);
 for(let i=0;i<240;i++)people.step(1/30,[]);
 people.render(new Vector3(-100,0,-120));
 assert.ok(people.walkers.some((w,i)=>Math.hypot(w.x-before[i][0],w.z-before[i][1])>3));assert.equal(people.parts.length,6);
 for(const e of [...c.entities.values()])c.remove(e.id);people.rebuild(c);assert.equal(people.walkers.length,0);people.clear();
});
test('distant buildings reduce vertices while retaining the selected facade color',()=>{
 for(const item of CATALOG.filter(item=>item.floors)){
  const close=getTemplate(item.id,3),far=getDistantTemplate(item.id,3),vertices=model=>{let sum=0;model.traverse(m=>{if(m.isMesh)sum+=m.geometry.attributes.position.count;});return sum;};
  assert.ok(vertices(far)<vertices(close),item.id);
  const facade=far.children.find(m=>m.material?.userData.facade)?.material;assert.ok(facade,item.id);assert.ok(close.children.some(m=>m.material?.name===facade.name&&m.material.userData.facade&&m.material.color.equals(facade.color)),item.id);
 }
});
test('R1 samples retain matching entrance and shelter anchors across LODs',()=>{
 for(const [type,expected] of [['cottage',[-.525,0,3.85]],['bakery',[0,0,3.9]],['library',[-.55,.24,14/3]],['office',[-.08*5/6,.22,5.61]],['park',[2,.126,3.93]],['pier',[0,.025,3.96]]]){
  const close=getTemplate(type),far=getDistantTemplate(type);
  const {entrance,shelter}=close.userData.anchors;
  assert.deepEqual(far.userData.anchors,close.userData.anchors,type);
  assert.ok(new Vector3().fromArray(entrance).distanceTo(new Vector3(...expected))<1e-6,type);
  assert.ok(entrance[2]>shelter[2],type);
 }
 const {light}=getTemplate('park').userData.anchors;
 assert.deepEqual(light,getDistantTemplate('park').userData.anchors.light);
 assert.ok(new Vector3().fromArray(light).distanceTo(new Vector3(-1.48,2.12,-.72))<1e-6);
});
test('R1 sample templates stay within the measured static asset budgets',async t=>{
 for(const type of ['cottage','bakery','library','office','park','pier']){
  const closeBounds=new Box3().setFromObject(getTemplate(type));
  const farBounds=new Box3().setFromObject(getDistantTemplate(type));
  const delta=Math.max(closeBounds.min.distanceTo(farBounds.min),closeBounds.max.distanceTo(farBounds.max));
  assert.ok(delta<=.05,`${type} changed bounds by ${delta.toFixed(3)} m`);
  for(const lod of [false,true]){
   const model=(lod?getDistantTemplate:getTemplate)(type);
   const file=new URL(`../public/models/${type}${lod?'_lod':''}.glb`,import.meta.url);
   const {size:bytes}=await stat(file);
   const batches=model.children.filter(mesh=>mesh.isMesh);
   const triangles=batches.reduce((sum,mesh)=>sum+mesh.geometry.getAttribute('position').count/3,0);
   t.diagnostic(`${type} ${lod?'LOD':'near'}: ${triangles} triangles, ${batches.length} batches, ${bytes} bytes`);
   assert.ok(triangles>0&&triangles<=(lod?2_500:30_000),type);
   assert.ok(batches.length<=(lod?16:20),type);
   assert.ok(bytes<=(lod?256*1024:1_100_000),type);
  }
 }
});
test('GLB registration retains authored PBR maps and compatible vertex attributes',()=>{
 const texture=new Texture(),normal=new Texture();normal.channel=1;
 const original=new MeshStandardMaterial({
  name:'RL_Wall_Test',color:0x987a5c,map:texture,normalMap:normal,
  roughness:.57,metalness:.23,roughnessMap:texture,metalnessMap:texture,
 });
 const scene=new Group(),geometry=new BoxGeometry();
 geometry.setAttribute('uv1',geometry.getAttribute('uv').clone());
 const withColors=geometry.clone();
 withColors.setAttribute('color',new BufferAttribute(new Float32Array(geometry.getAttribute('position').count*3).fill(1),3));
 scene.add(new Mesh(geometry,original),new Mesh(withColors,original));
 registerArchitectureAsset('clinic',scene);
 const model=getTemplate('clinic'),tinted=getTemplate('clinic',1);
 assert.equal(model.children.length,2);
 assert.equal(model.children.filter(mesh=>mesh.geometry.hasAttribute('color')).length,1);
 for(const mesh of model.children){
  assert.equal(mesh.material.map,texture);
  assert.equal(mesh.material.normalMap,normal);
  assert.equal(mesh.material.roughnessMap,texture);
  assert.equal(mesh.material.metalnessMap,texture);
  assert.equal(mesh.material.roughness,.57);
  assert.equal(mesh.material.metalness,.23);
  assert.ok(mesh.geometry.hasAttribute('uv1'));
  assert.ok(mesh.material.color.equals(original.color));
 }
 assert.equal(tinted.children[0].material.map,texture);
 assert.ok(!tinted.children[0].material.color.equals(original.color));
});
test('streaming a large city releases render chunks without deleting city data',()=>{
 const c=new City();c.radius=512;
 for(let x=-180;x<180;x+=5)for(let z=-180;z<180;z+=5)c.place('cottage',x,z);
 assert.ok(c.entities.size>4500);const before=c.snapshot(),scene=new Scene(),world=new World(scene,c);
 world.sync(true,new Vector3(0,0,0),180);const first=[...world.loaded.keys()];assert.ok(world.loaded.size<=81);
 world.sync(false,new Vector3(1600,0,1200),180);assert.ok(first.every(key=>!world.loaded.has(key)));assert.ok(world.loaded.size<=81);
 world.sync(false,new Vector3(0,0,0),180);assert.deepEqual([...world.loaded.keys()],first);assert.deepEqual(c.snapshot(),before);
 let released=0;const trafficCity=createDemo();world.setCity(trafficCity);
 for(const car of world.traffic.cars)car.mesh.traverse(m=>{if(m.geometry)m.geometry.addEventListener('dispose',()=>released++);});
 world.sync(true);assert.ok(released>0);world.clear();assert.equal(world.loaded.size,0);
});

test('a local edit and its undo keep unrelated chunk meshes loaded',()=>{
 const city=new City(),near=city.place('tree',-42,0),far=city.place('tree',42,0);
 const world=new World(new Scene(),city);
 const mesh=id=>world.pickables.find(object=>object.userData.entityIds?.includes(id));
 const before=mesh(near.id),unrelated=mesh(far.id);
 assert.ok(before&&unrelated);
 const placed=city.place('tree',-42,3);assert.ok(placed);world.sync(true);
 assert.notEqual(mesh(near.id),before);assert.equal(mesh(far.id),unrelated);assert.ok(mesh(placed.id));
 assert.ok(city.undo());world.sync(true);
 assert.equal(mesh(far.id),unrelated);assert.equal(mesh(placed.id),undefined);
 world.clear();
});
