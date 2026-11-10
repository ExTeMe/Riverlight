import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BY_ID, CELL, LEGACY_LOTS } from './catalog.js';
import { createRoad } from './roads.js';
import { createArchitecture, animateArchitecture } from './architecture.js';

const materials = new Map(), templates = new Map(), importedAssets=new Map(), importedLods=new Map(), assetClips=new Map(), mixers=new WeakMap();
export const uniforms = { time: {value:0}, wind:{value:0.4} };
export function material(color, role='solid', facade=false) {
  const k=color+role+(facade?':facade':'');
  if(materials.has(k))return materials.get(k);
  const m=new T.MeshStandardMaterial({color,roughness:role==='glass'?0.24:0.86,metalness:role==='glass'?0.25:0,flatShading:role==='leaf'});
  m.userData={base:new T.Color(color),role,facade};
  if(['light','windowWarm','windowSoft','sign','festival'].includes(role)) {
    m.emissive=new T.Color(role==='windowSoft'?'#d0e0e5':role==='festival'?color:'#ffd5a1');m.emissiveIntensity=0;
    if(role.startsWith('window')){const s=32,data=new Uint8Array(s*s*4);for(let y=0;y<s;y++)for(let x=0;x<s;x++){const i=(y*s+x)*4,edge=x<3||x>28||y<2||y>28,curtain=x<8||x>25,shade=y>23&&x>10&&x<21;const v=edge?0:shade?24:curtain?60:Math.round(105+(1-y/s)*100);data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}const tex=new T.DataTexture(data,s,s);tex.needsUpdate=true;m.emissiveMap=tex;m.roughness=.4;}
  }
  if(role==='leaf') enableLeafSway(m);
  materials.set(k,m);return m;
}
function enableLeafSway(m){
  m.onBeforeCompile=s=>{s.uniforms.uTime=uniforms.time;s.uniforms.uWind=uniforms.wind;s.vertexShader='uniform float uTime; uniform float uWind;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x += sin(uTime * 1.3 + position.y * 0.8 + position.z) * uWind * 0.08 * max(position.y,0.0);');};
  m.customProgramCacheKey=()=> 'riverlight-leaves';
}
class Builder {
  constructor(){this.parts=new Map();}
  geo(g,m,x=0,y=0,z=0,rx=0,ry=0,rz=0){
    const q=new T.Quaternion().setFromEuler(new T.Euler(rx,ry,rz));g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x,y,z),q,new T.Vector3(1,1,1)));
    let flat=g.index?g.toNonIndexed():g;if(flat!==g)g.dispose();
    if(!flat.getAttribute('uv'))flat.setAttribute('uv',new T.BufferAttribute(new Float32Array(flat.getAttribute('position').count*2),2));
    if(!this.parts.has(m))this.parts.set(m,[]);this.parts.get(m).push(flat);
  }
  box(w,h,d,x,y,z,m,ry=0){this.geo(new T.BoxGeometry(w,h,d),m,x,y,z,0,ry);}
  cylinder(rt,rb,h,x,y,z,m,n=10){this.geo(new T.CylinderGeometry(rt,rb,h,n),m,x,y,z);}
  sphere(r,x,y,z,m,sx=1,sy=1,sz=1){const g=new T.IcosahedronGeometry(r,1);g.scale(sx,sy,sz);this.geo(g,m,x,y,z);}
  finish(){const group=new T.Group();for(const [m,parts] of this.parts){const geo=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());const mesh=new T.Mesh(geo,m);mesh.castShadow=m.userData.role!=='light';mesh.receiveShadow=true;group.add(mesh);}return group;}
}
const pavement=()=>material('#c9c5af','ground'), trunk=()=>material('#7b6650'), metal=()=>material('#52605d');
function tree(b,x,z,scale=1,kind='tree') {
  const m=material(kind==='cherry'?'#c7a5a0':kind==='pine'?'#4f7660':'#77966a','leaf');
  b.cylinder(.12*scale,.2*scale,2.7*scale,x,1.35*scale,z,trunk(),7);
  if(kind==='pine'){for(let i=0;i<3;i++)b.cylinder(0,(1.4-i*.25)*scale,2.2*scale,x,(2.3+i*.7)*scale,z,m,8);}
  else {b.sphere(1.45*scale,x,3.3*scale,z,m,1,1.2,1);b.sphere(.95*scale,x-.7*scale,2.9*scale,z+.3*scale,m);}
}
function bench(b,x,z,rot=0) {const wood=material('#a88358');b.box(1.7,.14,.6,x,.53,z,wood,rot);b.box(1.7,.5,.12,x,.86,z-.25,wood,rot);for(const dx of [-.62,.62])b.box(.12,.5,.5,x+dx,.25,z,metal());}
function lamp(b,x,z) {b.cylinder(.06,.085,3.4,x,1.7,z,metal(),6);b.box(.65,.09,.12,x+.26,3.35,z,metal());b.box(.45,.12,.25,x+.4,3.3,z,material('#fff0c5','light'));}
function flowers(b,x,z){b.box(2.4,.28,1.4,x,.14,z,material('#af9f83'));b.box(2.2,.12,1.2,x,.31,z,material('#788861','leaf'));for(let i=0;i<9;i++)b.sphere(.15,x+(i%3-1)*.63,.55,z+(Math.floor(i/3)-1)*.34,material(i%2?'#d8b75e':'#ba786e'));}
function roof(b,w,d,y,m){
  const p=[-w/2,y,-d/2,w/2,y,-d/2,0,y+1.6,-d/2, -w/2,y,d/2,0,y+1.6,d/2,w/2,y,d/2, -w/2,y,-d/2,0,y+1.6,-d/2,0,y+1.6,d/2, -w/2,y,-d/2,0,y+1.6,d/2,-w/2,y,d/2, w/2,y,-d/2,w/2,y,d/2,0,y+1.6,d/2, w/2,y,-d/2,0,y+1.6,d/2,0,y+1.6,-d/2];
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));const indices=[];for(let i=0;i<p.length/3;i+=3)indices.push(i,i+2,i+1);g.setIndex(indices);g.computeVertexNormals();b.geo(g,m);
}
function wallMaterial(item,color){const shade=new T.Color(item.color);if(color)shade.offsetHSL([0,-.025,.018,.045][color],-.015,[0,-.07,.055,-.02][color]);return material('#'+shade.getHexString());}
export function getTemplate(type,color=0,connections=15) {
  const cacheKey=`${type}:${color}:${connections}`;if(templates.has(cacheKey))return templates.get(cacheKey);
  if(['road','bridge','path'].includes(type)){const model=createRoad(type,connections,{Builder,material});templates.set(cacheKey,model);return model;}
  if(importedAssets.has(type)){
    const model=importedAssets.get(type).clone(true);
    applyAssetColor(model,type,color);
    templates.set(cacheKey,model);return model;
  }
  const item=BY_ID[type],b=new Builder(),W=item.w*CELL,D=item.d*CELL;
  if(item.floors||item.kind==='amusement'){
    const model=createArchitecture(item,color,{Builder,material,wallMaterial,tree,bench,lamp,roof});animateArchitecture(model,0);templates.set(cacheKey,model);return model;
  }
  else if(['road','bridge','path'].includes(item.kind)){
    const bridge=item.kind==='bridge',path=item.kind==='path',y=bridge?.45:.04;
    b.box(4,.14,4,0,y-.07,0,material(path?'#cfc5ac':'#777e7d',path?'ground':'road'));
    if(!path){
      const edge=material('#c3c6b7','ground'),paint=material('#e4dab5','road');
      const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
      dirs.forEach(([dx,dz],i)=>{if(!(connections&(1<<i)))b.box(dx?.48:4,.15,dz?.48:4,dx*1.8,y+.09,dz*1.8,edge);});
      if(connections===3 || connections===12 || connections===0){const horizontal=connections!==12;b.box(horizontal?1.25:.06,.008,horizontal?.06:1.25,0,y+.075,0,paint);}
      if(bridge){
        const horizontal=connections!==12;
        for(const side of [-1,1]){
          b.box(horizontal?4:.12,.12,horizontal?.12:4,horizontal?0:side*1.7,y+1,horizontal?side*1.7:0,edge);
          for(const p of [-1.6,0,1.6])b.box(.1,.85,.1,horizontal?p:side*1.7,y+.5,horizontal?side*1.7:p,edge);
        }
        b.box(.6,1.9,.6,0,-.55,0,edge);
      }
      if(!bridge && ((connections&3)===3) && ((connections&12)!==0))for(let i=0;i<5;i++)b.box(.22,.008,.65,-.75+i*.37,y+.08,1.22,paint);
    }
  }else if(['tree','pine','cherry'].includes(item.kind))tree(b,0,0,1,item.kind);
  else if(item.kind==='bench')bench(b,0,0);
  else if(item.kind==='lamp')lamp(b,0,0);
  else if(item.kind==='flowers')flowers(b,0,0);
  else if(item.kind==='pier'){
    b.box(W-.2,.3,D-.2,0,.2,0,material('#b49e77','roof'));
    for(let x=-W/2+.2;x<W/2;x+=.6)b.box(.035,.012,D-.2,x,.36,0,trunk());
    for(const x of [-W/2+.4,W/2-.4])for(const z of [-D/2+.4,D/2-.4])b.cylinder(.13,.13,2,x,-.3,z,trunk(),8);
    lamp(b,-W*.38,-D*.38);bench(b,0,-D*.3);
  }else{
    b.box(W-.2,.18,D-.2,0,.09,0,pavement());
    b.box(W-.65,.11,D-.65,0,.23,0,material('#95a981','ground'));
    b.box(.9,.025,D-.25,0,.3,0,material('#d7ccb1'));
    b.box(W-.25,.025,.9,0,.3,0,material('#d7ccb1'));
    if(item.kind==='fountain'){
      b.cylinder(2.7,2.9,.45,0,.5,0,material('#c6c5b3'),24);b.cylinder(2.4,2.4,.06,0,.75,0,material('#729f9a','glass'),24);
      b.cylinder(.35,.55,1.6,0,1.35,0,material('#d0d3bd'),12);b.cylinder(1.1,1.25,.2,0,2.08,0,material('#e1dcca'),20);
      for(let i=0;i<8;i++){const a=i*Math.PI/4;b.cylinder(.035,.045,1.2,Math.sin(a),1.45,Math.cos(a),material('#b3d8ce','glass'),5);}
    }
    if(item.kind==='garden')for(const x of [-2,2])for(const z of [-2,2])flowers(b,x,z);
    else for(const [x,z] of [[-W*.3,-D*.3],[W*.3,D*.3],[-W*.3,D*.3],[W*.3,-D*.3]])tree(b,x,z,item.kind==='grove'?1.1:.8);
    bench(b,-W*.24,0);lamp(b,W*.38,-D*.38);
  }
  const model=b.finish();templates.set(cacheKey,model);return model;
}
export function updateMaterials(season,night,wet,snow,time,wind,dt=.016) {
  uniforms.time.value=time;uniforms.wind.value=wind;
  const autumn=new T.Color('#bc8445'),winter=new T.Color('#c9d3c8'),spring=new T.Color('#92b07d'),white=new T.Color('#e4eae3');
  for(const m of materials.values()){
    const {base,role}=m.userData;const target=m.userData.target||(m.userData.target=new T.Color());target.copy(base);
    if(role==='leaf') {if(season==='autumn')target.lerp(autumn,.72);if(season==='winter')target.lerp(winter,.54);if(season==='spring')target.lerp(spring,.4);target.lerp(white,snow*.5);}
    if(['roof','ground','road'].includes(role))target.lerp(white,snow*(role==='road'?.5:.82));
    if(role==='road'){m.roughness=.93-wet*.69;m.metalness=wet*.2;target.multiplyScalar(1-wet*.24);}
    m.color.lerp(target,1-Math.exp(-dt*1.4));
    if(role==='windowWarm')m.emissiveIntensity=night*.95;
    if(role==='windowSoft')m.emissiveIntensity=night*.48;
    if(role==='sign')m.emissiveIntensity=night*.6;
    if(role==='festival')m.emissiveIntensity=night*(1.1+Math.sin(time*.6)*.12);
    if(role==='light')m.emissiveIntensity=night*1.7;
  }
}
export function getDistantTemplate(type,color=0,connections=15){
  if(importedLods.has(type)){const key=`lod:${type}:${color}`;if(templates.has(key))return templates.get(key);const model=importedLods.get(type).clone(true);applyAssetColor(model,type,color);templates.set(key,model);return model;}
  if(importedAssets.has(type))return getTemplate(type,color,connections);
  const item=BY_ID[type];if(!item.floors&&item.kind!=='amusement')return getTemplate(type,color,connections);
  const k=`lod:${type}:${color}`;if(templates.has(k))return templates.get(k);
  const model=createArchitecture(item,color,{Builder,material,wallMaterial,tree,bench,lamp,roof},false);animateArchitecture(model,0);templates.set(k,model);return model;
}
export function vehicle(kind=0) {
  const b=new Builder(),bus=kind===3,colors=['#e6dbba','#b26550','#7b9e9b','#bdad72','#aebabc'];
  const body=material(colors[kind%colors.length]),glass=material('#405f62','glass'),rubber=material('#3f4846');
  b.box(1.28,.52,bus?3.8:2.4,0,.65,0,body);b.box(1.1,bus?.95:.6,bus?3.15:1.35,0,bus?1.3:1.08,bus?-.12:-.1,glass);b.box(1.18,.12,bus?3.3:1.5,0,bus?1.84:1.43,-.1,body);
  for(const x of [-.63,.63])for(const z of [bus?-1.25:-.74,bus?1.25:.74])b.sphere(.27,x,.34,z,rubber,.45,1,1);
  for(const x of [-.4,.4]){b.box(.25,.15,.08,x,.68,bus?1.93:1.23,material('#fff3be','light'));b.box(.2,.15,.08,x,.68,bus?-1.93:-1.23,material('#b25546','light'));}
  return b.finish();
}
export function boat(){const b=new Builder();b.box(2,.45,4,0,.15,0,material('#e5dfc9'));b.box(1.55,.8,1.9,0,.65,-.35,material('#a8c3c0','glass'));b.box(1.8,.15,2.3,0,1.14,-.35,material('#eee7d3','roof'));return b.finish();}
export function person(seed=0){const b=new Builder();b.cylinder(.18,.21,.6,0,.7,0,material(['#b17e66','#738d8c','#d1b373'][seed%3]),6);b.sphere(.18,0,1.2,0,material('#cda982'));for(const x of [-.1,.1])b.box(.12,.43,.13,x,.24,0,material('#62716a'));return b.finish();}

function applyAssetColor(model,type,color){
  if(!color)return;model.traverse(o=>{if(o.isMesh&&o.material.userData.facade){const key=`tint:${type}:${color}:${o.material.uuid}`;let tint=materials.get(key);if(!tint){tint=o.material.clone();tint.color.offsetHSL([0,-.025,.018,.045][color],-.015,[0,-.07,.055,-.02][color]);tint.userData={...o.material.userData,base:tint.color.clone()};materials.set(key,tint);}o.material=tint;}});
}
export function registerArchitectureAsset(type,scene,clips=[],lod=false){
  const builders=new Map(),dynamic=[],mapped=new Map(),anchors={};
  // Authored mesh dimensions are retained in the reference catalog; adapt to compact plots.
  const item=BY_ID[type],original=LEGACY_LOTS[type];scene.scale.x*=item.w/original[0];scene.scale.z*=item.d/original[1];scene.updateMatrixWorld(true);
  scene.traverse(o=>{
    if(o.userData.riverlight_dynamic||o.name==='Mall_RevolvingDoor')dynamic.push(o);
    const name=o.name.match(/(?:^|_)(Entrance|Shelter)$/)?.[1];
    if(name&&!o.isMesh)anchors[name.toLowerCase()]=new T.Vector3().setFromMatrixPosition(o.matrixWorld).toArray();
  });
  scene.traverse(o=>{if(!o.isMesh)return;const original=o.material;if(!mapped.has(original)){
    const name=original.name,role=name.includes('WindowWarm')?'windowWarm':name.includes('WindowSoft')?'windowSoft':name.includes('Glass')?'glass':name.includes('Roof')?'roof':name.includes('Ground')?'ground':name.includes('Leaf')?'leaf':name.includes('Sign')?'sign':name.includes('Festival')?'festival':name.includes('Light')?'light':'solid';
    const m=original.clone();
    m.userData={...m.userData,base:m.color.clone(),role,facade:name.includes('Wall')||(type==='glass-tower'&&role==='glass')};
    if(role==='leaf')enableLeafSway(m);
    if(['windowWarm','windowSoft','sign','festival','light'].includes(role))m.emissiveIntensity=0;
    materials.set(m.uuid,m);
    mapped.set(original,m);
  }o.material=mapped.get(original);});
  scene.traverse(o=>{if(!o.isMesh)return;let ancestor=o;while(ancestor){if(dynamic.includes(ancestor))return;ancestor=ancestor.parent;}
    const g=o.geometry.clone();
    // Keep secondary UVs, vertex colors and tangents. Merge only compatible layouts.
    const attributes=Object.entries(g.attributes).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`);
    if(!g.hasAttribute('uv'))attributes.push('uv:2:false:Float32Array');
    const layout=attributes.sort().join('|');
    if(!builders.has(layout))builders.set(layout,new Builder());
    g.applyMatrix4(o.matrixWorld);
    builders.get(layout).geo(g,o.material);
  });
  const model=new T.Group();
  for(const builder of builders.values())for(const mesh of [...builder.finish().children])model.add(mesh);
  for(const root of dynamic){const clone=root.clone(true);root.matrixWorld.decompose(clone.position,clone.quaternion,clone.scale);const names=new Set();clone.traverse(o=>names.add(o.name));const filtered=clips.map(clip=>new T.AnimationClip(clip.name,clip.duration,clip.tracks.filter(track=>names.has(track.name.split('.')[0])))).filter(clip=>clip.tracks.length);const animationKey=`${type}:${root.name}`;
    clone.userData={...clone.userData,dynamic:true,animation:clips.length?'gltf':root.name==='Mall_RevolvingDoor'?'mall-door':'static',animationKey};if(!lod)assetClips.set(animationKey,filtered);model.add(clone);
  }model.userData={source:'Blender MCP',architecture:type,anchors};(lod?importedLods:importedAssets).set(type,model);
  for(const key of [...templates.keys()])if(key.startsWith(type+':')||key.startsWith('lod:'+type+':'))templates.delete(key);
}

export function animateImportedAssets(root,time){root.traverse(o=>{if(o.userData.animation!=='gltf')return;let mixer=mixers.get(o);if(!mixer){mixer=new T.AnimationMixer(o);for(const clip of assetClips.get(o.userData.animationKey)||[])mixer.clipAction(clip).play();mixers.set(o,mixer);}mixer.setTime(time);});}

export function getQuayTemplate(){
  const k='quay-furniture';if(templates.has(k))return templates.get(k);const b=new Builder(),rail=material('#596968'),stone=material('#cbc6b5');
  b.box(.08,.08,5.5,-1.2,1.02,0,rail);for(const z of [-2.6,0,2.6])b.cylinder(.055,.065,.95,-1.2,.55,z,rail,6);
  bench(b,.35,-1.1);b.box(1.2,.45,1.4,.45,.27,1.8,stone);b.sphere(.57,.45,.82,1.8,material('#7a9864','leaf'),1,.6,1);lamp(b,.7,2.8);
  const model=b.finish();templates.set(k,model);return model;
}
