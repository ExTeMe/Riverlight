import './style.css';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CityAOPass } from './ambient-occlusion.js';
import { City, createDemo, footprintBounds, gridLine } from './core.js';
import { CELL, BY_ID, snapStep } from './catalog.js';
import { legacySnap } from './space.js';
import { placementOf, usesParcel } from './parcel.js';
import { ParcelEditor } from './parcel-editor.js';
import { World } from './world.js';
import { Environment } from './environment.js';
import { getTemplate } from './models.js';
import { UI } from './ui.js';
import { Soundscape } from './audio.js';
import { saves, createSaveStore, download } from './storage.js';
import { SaveSession, parseCityFile } from './save-session.js';
import { icon } from './icons.js';
import { loadArchitectureAssets } from './asset-loader.js';
import { createBaseline, createScene, SCENE_WEATHER } from './baseline.js';

class App {
  async init(){
    this.mode='select';this.buildType=null;this.rotation=0;this.buildColor=0;this.selected=null;this.selectedParcel=null;this.moving=null;this.keys=new Set();this.cursor=null;this.dragCells=[];this.drawing=false;this.freeCamera=false;this.follow=false;this.quiet=false;this.thumbCache=new Map();this.saveTimer=null;this.replacing=false;
    if(import.meta.env.DEV&&new URLSearchParams(location.search).get('baseline')==='BASE-02'){
      this.baseline=createBaseline();
    }
    const sceneParams=new URLSearchParams(location.search);
    if(sceneParams.has('scene'))this.baseline=createScene(sceneParams.get('scene'),sceneParams.get('density')||'standard');
    this.saves=this.baseline?createSaveStore({name:this.baseline.cameras?`riverlight-scenes-${this.baseline.id}-${this.baseline.density}`:'riverlight-baselines'}):saves;
    this.saveSession=new SaveSession(this.saves);const opened=await this.saveSession.open(this.baseline,{resume:!!this.baseline&&new URLSearchParams(location.search).get('resume')==='1'});this.city=opened.city;
    this.canvas=document.querySelector('#scene');this.renderer=new T.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.setSize(innerWidth,innerHeight);this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.98;this.renderer.outputColorSpace=T.SRGBColorSpace;
    this.scene=new T.Scene();this.camera=new T.PerspectiveCamera(39,innerWidth/innerHeight,.5,4500);this.camera.position.set(183,180,230);
    this.renderer.info.autoReset=false;
    this.controls=new OrbitControls(this.camera,this.canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.075;this.controls.minDistance=24;this.controls.maxDistance=900;this.controls.minPolarAngle=.18;this.controls.maxPolarAngle=Math.PI*.43;this.controls.target.set(4,0,15);this.controls.mouseButtons={LEFT:null,MIDDLE:T.MOUSE.PAN,RIGHT:T.MOUSE.ROTATE};this.controls.panSpeed=.8;this.controls.rotateSpeed=.5;this.controls.zoomSpeed=.65;this.controls.update();
    this.raycaster=new T.Raycaster();this.pointer=new T.Vector2();this.plane=new T.Plane(new T.Vector3(0,1,0),0);this.point=new T.Vector3();
    this.assetStatus=await loadArchitectureAssets();this.world=new World(this.scene,this.city);this.environment=new Environment(this.scene,this.renderer,this.city);this.sound=new Soundscape();
    this.composer=new EffectComposer(this.renderer);this.composer.addPass(new RenderPass(this.scene,this.camera));this.ao=new CityAOPass(this.scene,this.camera,innerWidth,innerHeight,this.environment);this.ao.blendIntensity=.65;this.ao.updateGtaoMaterial({radius:2.5,distanceExponent:1,thickness:1,scale:1,samples:8});this.composer.addPass(this.ao);this.bloom=new UnrealBloomPass(new T.Vector2(innerWidth,innerHeight),.16,.45,1.15);this.composer.addPass(this.bloom);this.composer.addPass(new OutputPass());
    this.thumbTarget=new T.WebGLRenderTarget(160,128,{format:T.RGBAFormat});this.thumbTarget.texture.colorSpace=T.SRGBColorSpace;
    this.thumbScene=new T.Scene();this.thumbScene.add(new T.HemisphereLight('#fff6e2','#869a78',3));const thumbLight=new T.DirectionalLight('#ffffff',3);thumbLight.position.set(-6,14,12);this.thumbScene.add(thumbLight);
    this.ui=new UI(this);this.editor=new ParcelEditor(this,this.ui.root);this.bind();this.setQuality();
    this.canvas.dataset.assetLibrary=`Blender ${this.assetStatus.loaded.length}/${this.assetStatus.loaded.length+this.assetStatus.failed.filter(id=>!this.assetStatus.loaded.includes(id)).length}`;
    if(this.assetStatus.failed.length)this.ui.toast('部分精细模型未加载，请刷新重试',true);
    if(opened.camera)this.restoreCamera(opened.camera);
    this.environment.update(.016,this.camera,this.controls.target);this.composer.render();
    document.querySelector('#loading').style.opacity='0';setTimeout(()=>document.querySelector('#loading').remove(),800);
    if(opened.error){console.error(opened.error);this.ui.saved('原存档已保护 · 当前另存恢复城市');this.ui.toast('原存档读取失败，已保护原记录。当前城市将另存，可在「我的城市」导出原记录。',true);}
    if(this.baseline)this.ui.saved(`独立场景 · ${this.baseline.id} / v${this.baseline.sceneVersion}`);
    this.last=performance.now();this.elapsed=0;this.uiClock=0;this.animate=this.animate.bind(this);requestAnimationFrame(this.animate);
    setTimeout(()=>document.querySelector('.intro')?.classList.add('hide'),22000);
    // Read-only diagnostics are useful during visual and performance verification.
    window.riverlight={getStats:()=>({entities:this.city.entities.size,buildings:[...this.city.entities.values()].filter(e=>BY_ID[e.type].floors).length,pedestrians:this.world.traffic.people.walkers.length,visiblePedestrians:this.world.traffic.people.visibleCount,walkNodes:this.world.traffic.people.network.nodes.size,chunks:this.world.loaded.size,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,environment:{...this.city.environment},mode:this.mode,selected:this.selected,roadRevision:this.city.roadNetwork.revision,walkRoadRevision:this.world.traffic.people.network.revision,baseline:this.baseline?{id:this.baseline.id,sceneVersion:this.baseline.sceneVersion,seed:this.baseline.seed}:null}),version:'1.0.0'};
  }
  thumbnail(type){
    if(this.thumbCache.has(type))return this.thumbCache.get(type);
    const model=getTemplate(type).clone(),box=new T.Box3().setFromObject(model),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());model.position.sub(center);this.thumbScene.add(model);
    const r=Math.max(size.x,size.z,size.y*.85)*.92,c=new T.OrthographicCamera(-r*1.25,r*1.25,r,-r,.1,500);c.position.set(30,25,35);c.lookAt(0,0,0);
    const old=this.renderer.getRenderTarget(),color=this.renderer.getClearColor(new T.Color()),alpha=this.renderer.getClearAlpha();this.renderer.setClearColor(0x000000,0);this.renderer.setRenderTarget(this.thumbTarget);this.renderer.clear();this.renderer.render(this.thumbScene,c);
    const pixels=new Uint8Array(160*128*4);this.renderer.readRenderTargetPixels(this.thumbTarget,0,0,160,128,pixels);this.renderer.setRenderTarget(old);this.renderer.setClearColor(color,alpha);this.thumbScene.remove(model);
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;const ctx=canvas.getContext('2d'),data=ctx.createImageData(160,128);for(let y=0;y<128;y++)data.data.set(pixels.subarray((127-y)*160*4,(128-y)*160*4),y*160*4);ctx.putImageData(data,0,0);const url=canvas.toDataURL();this.thumbCache.set(type,url);return url;
  }
  async navigateScene(id,density='standard',resume=false){
    if(this.replacing||this.navigating)return;
    if(id)createScene(id,density); // Validate before saving or navigating.
    this.navigating=true;
    try{
    if(!await this.persist())return;
    if(this.baseline?.cameras&&!resume)await this.saveSession.replace(this.city,this.cameraState(),this.city,this.cameraState());
    const url=new URL(location.href);url.searchParams.delete('baseline');url.searchParams.delete('resume');url.searchParams.delete('density');
    if(id){url.searchParams.set('scene',id);url.searchParams.set('density',density);if(resume)url.searchParams.set('resume','1');}
    else url.searchParams.delete('scene');
    this.replacing=true;clearTimeout(this.saveTimer);location.assign(url);
    }finally{this.navigating=false;}
  }
  sceneEvidence(){
    const probe=this.baseline?.spatialProbe;
    const spatial=probe?{
      world:this.city.worldBounds(),
      samples:probe.map(bounds=>({bounds,objects:this.city.queryFootprints(bounds).map(e=>({id:e.id,type:e.type,bounds:footprintBounds(e)}))})),
      land:this.city.surfaceAt(-64,-12),river:this.city.surfaceAt(0,0),
    }:undefined;
    if(spatial&&this.baseline.scaleIds){
      const samples=this.baseline.scaleIds.map(id=>this.city.entities.get(id))
        .filter((e,i)=>e?.type===this.baseline.scaleTypes[i])
        .map(e=>({e,bounds:footprintBounds(e)})).sort((a,b)=>a.bounds.minX-b.bounds.minX);
      spatial.scale=samples.map(({e,bounds},i)=>{
        const model=getTemplate(e.type,e.color),height=new T.Box3().setFromObject(model).getSize(new T.Vector3()).y;
        return {id:e.id,type:e.type,width:bounds.maxX-bounds.minX,depth:bounds.maxZ-bounds.minZ,height,
          gapX:i?bounds.minX-samples[i-1].bounds.maxX:null,authored:model.userData.source==='Blender MCP'};
      });
    }
    return {revision:document.querySelector('meta[name="riverlight-revision"]')?.content,workingTree:document.querySelector('meta[name="riverlight-working-tree"]')?.content,
      capturedAt:new Date().toISOString(),scene:this.baseline?{id:this.baseline.id,version:this.baseline.sceneVersion,seed:this.baseline.seed,density:this.baseline.density}:null,
      browser:navigator.userAgent,viewport:[innerWidth,innerHeight],pixelRatio:this.renderer.getPixelRatio(),camera:this.cameraState(),
      ...window.riverlight.getStats(),cars:this.world.traffic.cars.length,boats:this.world.traffic.boats.length,
      detailedChunks:[...this.world.loaded.values()].filter(chunk=>chunk.detail).length,
      rendererMemory:{...this.renderer.info.memory},method:'最近一帧累计渲染调用（含反射与后处理）；几何/纹理为 WebGL 资源数量，不是字节数',
      frameTime:null,gpuMemoryBytes:null,deviceClass:'未登记',limitations:this.baseline?.limitations||[],spatial};
  }
  bind(){
    window.addEventListener('resize',()=>{this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight);this.composer.setSize(innerWidth,innerHeight);});
    this.canvas.addEventListener('contextmenu',e=>e.preventDefault());
    this.canvas.addEventListener('pointermove',e=>{this.updatePointer(e);if(this.drawing&&this.cursor){const cell=[this.cursor.x,this.cursor.z];this.dragCells.push(...gridLine(this.lastCell,cell));this.lastCell=cell;}if(this.editor.active&&this.cursor)this.editor.pointer(this.point.x,this.point.z);else this.preview();});
    this.canvas.addEventListener('pointerdown',e=>{if(e.button!==0||this.ui.modalOpen||this.replacing)return;this.updatePointer(e);this.pointerDown={x:e.clientX,y:e.clientY};if(this.buildType&&['road','bridge','path','tree'].includes(this.buildType)&&!this.moving&&this.cursor){this.drawing=true;this.dragCells=[[this.cursor.x,this.cursor.z]];this.lastCell=this.dragCells[0];this.canvas.setPointerCapture(e.pointerId);}});
    this.canvas.addEventListener('pointerup',e=>{if(e.button!==0)return;if(this.replacing){this.drawing=false;this.dragCells=[];this.pointerDown=null;return;}this.updatePointer(e);if(this.drawing){this.drawing=false;const painted=this.city.paint(this.buildType,this.dragCells);if(painted)this.changed();else this.ui.toast('没有可放置的位置，请检查占地或切换桥梁',true);this.dragCells=[];this.pointerDown=null;return;}if(!this.pointerDown)return;const distance=Math.hypot(e.clientX-this.pointerDown.x,e.clientY-this.pointerDown.y);this.pointerDown=null;if(distance<7)this.click();});
    this.canvas.addEventListener('pointercancel',()=>{this.drawing=false;this.dragCells=[];this.pointerDown=null;});
    this.canvas.addEventListener('pointerleave',()=>{if(!this.drawing){if(!this.editor.active)this.world.clearPreview();this.cursor=null;}});
    this.canvas.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';this.updatePointer(e);if(this.editor.active&&this.cursor)this.editor.pointer(this.point.x,this.point.z);else this.preview();});
    this.canvas.addEventListener('drop',e=>{e.preventDefault();if(this.replacing)return;const type=e.dataTransfer.getData('text/plain');if(!BY_ID[type])return;if(this.buildType!==type&&this.editor.type!==type)this.startBuild(type);this.updatePointer(e);this.click();});
    window.addEventListener('keydown',e=>this.keydown(e));window.addEventListener('keyup',e=>this.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>{this.keys.clear();this.drawing=false;});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.keys.clear();this.persist();}});
    this.controls.addEventListener('start',()=>{this.follow=false;});this.controls.addEventListener('end',()=>this.scheduleSave());
    this.autosaveInterval=setInterval(()=>{if(!document.hidden)this.persist();},45000);
  }
  updatePointer(event){const r=this.canvas.getBoundingClientRect();this.pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);if(this.raycaster.ray.intersectPlane(this.plane,this.point)){const step=snapStep(this.buildType);this.cursor={x:legacySnap(this.point.x,step),z:legacySnap(this.point.z,step)};}else this.cursor=null;}
  candidate(){return this.cursor&&this.buildType?{id:-1,type:this.buildType,x:this.cursor.x,z:this.cursor.z,rotation:this.rotation,color:this.buildColor,...(this.moving&&this.city.entities.get(this.moving)?.lot?{lot:this.city.entities.get(this.moving).lot}:{})}:null;}
  preview(){if(this.editor.active){this.editor.render();return;}const e=this.candidate();if(e)this.world.showPreview(e,!this.city.canPlace(e,this.moving));}
  startBuild(type,color=0,legacy=false){
    if(!legacy&&usesParcel(type)){
      const parcel=!this.selected&&this.city.parcels.get(this.selectedParcel);
      this.startParcelEdit(parcel?{mode:'attach',parcel,type,color}:{mode:'quick',type,color});return;
    }
    this.cancel();this.buildType=type;this.buildColor=color;this.mode='build';this.ui.refreshActive();this.ui.hint(`${BY_ID[type].name} · ${['road','bridge','path','tree'].includes(type)?'按住左键连续绘制':'点击放置'} · R 旋转 · Esc 取消`);this.preview();
  }
  startParcelEdit(options){
    this.cancel();this.mode='parcel';this.world.select(null);this.editor.open(options);this.ui.refreshActive();this.ui.refreshSelection();
  }
  finishParcelEdit(result){
    this.selected=result.entity?.id??null;this.selectedParcel=result.parcel.id;this.cancel();
    if(result.changed){this.changed();this.sound.click();}
  }
  cancel(){
    this.world.clearPreview();this.buildType=null;this.moving=null;this.rotation=0;this.buildColor=0;this.mode='select';this.drawing=false;this.dragCells=[];
    if(this.editor?.active){this.editor.close();this.world.select(this.selected,this.selectedParcel);this.ui.refreshSelection();}
    this.ui?.hint('');this.ui?.refreshActive();
  }
  click(){
    if(!this.cursor||this.ui.modalOpen||this.replacing)return;
    if(this.editor.active){this.editor.click(this.point.x,this.point.z);return;}
    if(this.buildType){const e=this.candidate(),error=this.city.canPlace(e,this.moving);if(error){this.ui.toast(error,true);return;}
      if(this.moving){this.city.move(this.moving,e.x,e.z,e.rotation);this.cancel();}
      else this.city.place(e.type,e.x,e.z,e.rotation,e.color);this.changed();this.sound.click();this.preview();return;
    }
    this.raycaster.setFromCamera(this.pointer,this.camera);const hits=this.raycaster.intersectObjects(this.world.pickables,true),hit=hits[0];
    const parcel=this.city.parcelAt(this.point.x,this.point.z);
    const id=hit?.object.userData.entityIds?.[hit.instanceId]??hit?.object.userData.entityId??this.city.nativeAt(this.point.x,this.point.z)?.id??this.city.at(this.cursor.x,this.cursor.z)?.id;
    if(this.mode==='erase'){
      if(id?this.city.remove(id):parcel&&this.city.removeEmptyParcel(parcel.id)){this.selected=null;this.selectedParcel=null;this.changed();}
      return;
    }
    const entity=id?this.city.entities.get(id):parcel&&this.city.parcelOwner(parcel);
    this.selected=entity?.id??null;this.selectedParcel=entity?.pose?.parcel.id??(!id?parcel?.id:null);
    this.world.select(this.selected,this.selectedParcel);this.ui.refresh();
  }
  changed(){this.world.sync(true,this.controls.target,this.camera.position.distanceTo(this.controls.target));this.environment.refreshSources();this.world.select(this.selected,this.selectedParcel);this.ui.refresh();this.scheduleSave();}
  setEnvironment(values){if(this.replacing)return;Object.assign(this.city.environment,values);if(values.quality)this.setQuality();this.ui.refresh();this.scheduleSave();}
  setQuality(){const high=this.city.environment.quality==='high';this.renderer.setPixelRatio(Math.min(devicePixelRatio,high?1.5:1));this.composer.setPixelRatio(this.renderer.getPixelRatio());this.bloom.enabled=high;this.ao.enabled=high;this.environment.sun.castShadow=true;}
  cameraState(){return {position:this.camera.position.toArray(),target:this.controls.target.toArray()};}
  restoreCamera(c){if(!c||![c.position,c.target].every(v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<50000)))return;this.camera.position.fromArray(c.position);this.controls.target.fromArray(c.target);this.controls.update();}
  scheduleSave(){clearTimeout(this.saveTimer);this.ui.saved('正在记下你的灵感…');this.saveTimer=setTimeout(()=>this.persist(),1100);}
  async persist(id){
    if(this.replacing)return false;clearTimeout(this.saveTimer);
    try{await this.saveSession.persist(this.city,this.cameraState(),id);this.ui.saved(this.saveSession.protected?'已保存恢复城市 · 原存档已保护':this.baseline?'已保存 · 隔离测试城市':'已保存 · 只属于你的节奏');return true;}catch(error){console.error(error);this.ui.saved('保存失败，请导出备份');this.ui.toast('浏览器保存失败，请导出城市文件备份',true);return false;}
  }
  async listSaves(){return this.saves.list();}
  async replaceCity(city,camera,original){
    if(this.replacing)return false;this.replacing=true;clearTimeout(this.saveTimer);
    const view=camera||{position:[183,180,230],target:[4,0,15]};
    try{
      try{await this.saveSession.replace(this.city,this.cameraState(),city,view,original);}
      catch(error){console.error(error);this.ui.toast('城市切换失败，原城市已保留。请导出备份后重试。',true);return false;}
      this.cancel();this.selected=null;this.selectedParcel=null;this.city=city;this.world.setCity(city);this.environment.city=city;this.environment.refreshSources();this.follow=false;this.controls.autoRotate=false;this.setQuality();this.restoreCamera(view);this.ui.refresh();this.ui.closeModal();
      this.ui.saved(this.saveSession.protected?'已保存恢复城市 · 原存档已保护':'已保存 · 当前城市已备份');return true;
    }finally{this.replacing=false;}
  }
  async importFile(file){try{if(file.size>20*1024*1024)throw new Error('城市文件超过 20 MB');const parsed=parseCityFile(await file.text());if(await this.replaceCity(parsed.city,parsed.camera,parsed.original))this.ui.toast('城市已导入，欢迎回来');}catch(error){this.ui.toast(`无法导入：${error.message}`,true);}}
  home(){this.follow=false;this.controls.autoRotate=false;this.keys.clear();this.camera.position.set(183,180,230);this.controls.target.set(4,0,15);this.controls.update();}
  zoom(factor){const direction=this.camera.position.clone().sub(this.controls.target);const length=T.MathUtils.clamp(direction.length()*factor,this.controls.minDistance,this.controls.maxDistance);this.camera.position.copy(this.controls.target).add(direction.setLength(length));this.controls.update();}
  keydown(e){
    if(e.key==='Escape'&&this.editor.active){e.preventDefault();this.cancel();return;}
    if(e.target.matches('input,textarea,select')||this.ui.modalOpen){if(e.key==='Escape')this.ui.closeModal();return;}
    const key=e.key.toLowerCase();this.keys.add(key);
    if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key))e.preventDefault();
    if(e.ctrlKey||e.metaKey){if(['z','y','s'].includes(key))e.preventDefault();if(key==='z')this.action(e.shiftKey?'redo':'undo');if(key==='y')this.action('redo');if(key==='s')this.action('save');return;}
    if(e.repeat)return;
    const actions={v:'select',b:'road',t:'trees',x:'erase',c:'camera',h:'quiet',home:'home',delete:'delete',backspace:'delete'};
    if(actions[key]){e.preventDefault();this.action(actions[key]);}
    if(key==='r'){if(this.editor.active)this.editor.rotate();else if(this.buildType){this.rotation=(this.rotation+1)%4;this.preview();}else this.action('rotate');}
    if(key==='escape'){if(this.quiet)this.action('quiet');this.cancel();this.selected=null;this.selectedParcel=null;this.world.select(null);this.ui.refresh();}
    if(key===' ')this.action('play');
  }
  async action(action,el){
    if(this.replacing)return;
    const e=this.city.entities.get(this.selected);
    const parcel=this.city.parcels.get(this.selectedParcel);
    switch(action){
      case 'select':this.cancel();break;
      case 'draw-parcel':this.startParcelEdit({mode:'draw'});break;
      case 'cancel-parcel':this.cancel();break;
      case 'edit-lot':if(parcel)this.startParcelEdit({mode:'lot',parcel,entity:e});break;
      case 'edit-building':if(e?.pose)this.startParcelEdit({mode:'building',parcel:e.pose.parcel,entity:e});break;
      case 'road':this.ui.showCategory('road');this.startBuild('road');break;
      case 'trees':this.ui.showCategory('detail');this.startBuild('tree');break;
      case 'erase':this.cancel();this.mode='erase';this.ui.hint('点击拆除 · Ctrl+Z 可撤销 · Esc 返回');this.ui.refreshActive();break;
      case 'undo':this.cancel();if(this.city.undo()){this.selected=null;this.selectedParcel=null;this.changed();}break;
      case 'redo':this.cancel();if(this.city.redo()){this.selected=null;this.selectedParcel=null;this.changed();}break;
      case 'move':if(e&&!e.pose){this.startBuild(e.type,e.color,true);this.moving=e.id;this.rotation=e.rotation;this.ui.hint('选择新的位置 · 原建筑会保留到移动成功 · Esc 取消');this.preview();}break;
      case 'copy':if(e?.pose){this.startParcelEdit({mode:'quick',entity:e,copy:true});}else if(e){this.startBuild(e.type,e.color,true);this.rotation=e.rotation;this.preview();}break;
      case 'rotate':if(e?.pose){this.startParcelEdit({mode:'building',parcel:e.pose.parcel,entity:e});this.editor.rotate();}else if(e){if(!this.city.move(e.id,e.x,e.z,(e.rotation+1)%4))this.ui.toast('旋转后会与其他物件重叠',true);else this.changed();}break;
      case 'color':if(e&&BY_ID[e.type].floors){this.city.recolor(e.id);this.changed();}break;
      case 'delete':if(!this.editor.active&&(e?this.city.remove(e.id):parcel&&this.city.removeEmptyParcel(parcel.id))){this.selected=null;this.selectedParcel=null;this.changed();}break;
      case 'focus':if(e||parcel){const p=e?placementOf(e):parcel;this.controls.target.set(p.x,0,p.z);this.camera.position.copy(this.controls.target).add(new T.Vector3(35,30,40));}break;
      case 'expand':if(this.city.expand()){this.changed();this.ui.toast(`城市向四周生长了 · 现在是 ${this.city.radius*2} × ${this.city.radius*2} 格`);}else this.ui.toast('已到达当前版本的世界边界');break;
      case 'zoom-in':this.zoom(.82);break;case 'zoom-out':this.zoom(1.22);break;case 'home':this.home();break;
      case 'camera':this.freeCamera=!this.freeCamera;this.controls.maxPolarAngle=this.freeCamera?Math.PI*.493:Math.PI*.43;this.controls.minDistance=this.freeCamera?8:24;document.querySelector('#camera-label').textContent=this.freeCamera?'返回建造视角':'自由观察';document.querySelector('[data-action=camera]').classList.toggle('active',this.freeCamera);this.ui.toast(this.freeCamera?'自由观察 · 右键环绕，方向键移动':'已返回建造视角');break;
      case 'quiet':this.cancel();this.quiet=!this.quiet;document.body.classList.toggle('quiet',this.quiet);this.world.emptyParcels.layers.set(this.quiet?1:0);break;
      case 'environment':{const panel=document.querySelector('.environment');panel.hidden=!panel.hidden;document.querySelector('[data-action=environment]').classList.toggle('active',!panel.hidden);break;}
      case 'play':this.setEnvironment({playing:!this.city.environment.playing});break;
      case 'save':if(await this.persist())this.ui.toast('这一刻，已经为你保存');break;
      case 'cities':await this.ui.cities();break;
      case 'scenes':this.ui.scenes();break;
      case 'load-scene':await this.navigateScene(el.dataset.scene);break;
      case 'return-city':await this.navigateScene(null);break;
      case 'scene-density':await this.navigateScene('T07',el.dataset.density);break;
      case 'resume-scene':await this.navigateScene(this.baseline.id,this.baseline.density,true);break;
      case 'scene-camera':if(this.baseline?.cameras){this.follow=false;this.controls.autoRotate=false;this.restoreCamera(this.baseline.cameras[el.dataset.view]);this.scheduleSave();}break;
      case 'scene-weather':{const preset=SCENE_WEATHER.find(p=>p.id===el.dataset.weatherId);if(preset){const {hour,season,weather}=preset;this.setEnvironment({hour,season,weather,playing:false});}break;}
      case 'scene-evidence':download(`${this.baseline.id}-evidence.json`,JSON.stringify(this.sceneEvidence(),null,2));this.ui.toast('已导出当前镜头与实际资源记录');break;
      case 'save-copy':this.city.name=document.querySelector('#rename-city').value.trim()||'未命名城市';if(await this.persist(`city-${crypto.randomUUID()}`)){await this.persist();this.ui.refresh();await this.ui.cities();this.ui.toast('城市已收藏');}break;
      case 'load-city':{const s=await this.saves.load(el.dataset.saveId);if(!s?.data)throw new Error('该存档无法打开，请保留原记录并使用其他备份');await this.replaceCity(new City(s.data),s.camera);break;}
      case 'new-city':{const city=new City();city.name='新的河畔';await this.replaceCity(city);break;}
      case 'demo-city':await this.replaceCity(createDemo());break;
      case 'export':download(`${this.city.name}.riverlight.json`,JSON.stringify({city:this.city.snapshot(),camera:this.cameraState()},null,2));this.ui.toast('城市文件已导出');break;
      case 'export-original':{const original=await this.saveSession.originalRecord();if(!original)throw new Error('原记录暂时无法读取，请保留浏览器数据并稍后重试');download('riverlight-original-record.json',JSON.stringify(original,null,2));this.ui.toast('原存档记录已导出，未作修改');break;}
      case 'export-save':{const record=await this.saves.load(el.dataset.saveId);if(!record)throw new Error('该记录暂时无法读取');download(`${record.name||'未命名城市'}.riverlight-record.json`,JSON.stringify(record,null,2));this.ui.toast('存档原记录已导出');break;}
      case 'reset-baseline':if(this.baseline){const initial=this.baseline.cameras?createScene(this.baseline.id,this.baseline.density):createBaseline();if(await this.replaceCity(new City(initial.city),initial.camera)){const url=new URL(location.href);url.searchParams.delete('resume');location.assign(url);}}break;
      case 'import':document.querySelector('#import-file').click();break;
      case 'close-modal':this.ui.closeModal();break;case 'help':this.ui.help();break;case 'audio':this.ui.audio();break;
      case 'toggle-audio':await this.sound.enable();document.querySelector('.top-actions [data-action=audio]').innerHTML=icon(this.sound.enabled?'sound':'mute');this.ui.audio();break;
      case 'screenshot':{const guides=[this.world.selection,this.world.parcelSelection,this.world.emptyParcels],shown=guides.map(g=>g.visible);guides.forEach(g=>g.visible=false);this.world.clearPreview();this.composer.render();this.canvas.toBlob(blob=>{if(blob){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${this.city.name}-${Date.now()}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}},'image/png');guides.forEach((g,i)=>g.visible=shown[i]);this.preview();this.ui.toast('已留下这片风景');break;}
      case 'orbit':this.controls.autoRotate=!this.controls.autoRotate;this.controls.autoRotateSpeed=.3;this.follow=false;this.ui.closeModal();this.ui.toast(this.controls.autoRotate?'镜头正在缓缓环绕':'已停止环绕');break;
      case 'follow':if(!this.world.traffic.followTarget){this.ui.toast('先铺设一些连通道路，让车辆来到城市');break;}this.follow=!this.follow;this.controls.autoRotate=false;this.ui.closeModal();this.ui.toast('跟随小车看风景 · 拖动视角即可退出');break;
      case 'bookmark':this.bookmark=this.cameraState();localStorage.setItem('riverlight-camera',JSON.stringify(this.bookmark));this.ui.toast('这个视角已收藏');break;
      case 'recall':{const c=this.bookmark||JSON.parse(localStorage.getItem('riverlight-camera')||'null');if(c){this.restoreCamera(c);this.ui.closeModal();}else this.ui.toast('还没有收藏镜头');break;}
    }
  }
  animate(now){
    const dt=Math.min((now-this.last)/1000,.06);this.last=now;this.elapsed+=dt;
    if(!this.ui.modalOpen){const dir=new T.Vector3();this.camera.getWorldDirection(dir);dir.y=0;dir.normalize();const right=new T.Vector3().crossVectors(dir,new T.Vector3(0,1,0));const move=new T.Vector3();
      if(this.keys.has('arrowup')||this.keys.has('w'))move.add(dir);if(this.keys.has('arrowdown')||this.keys.has('s'))move.sub(dir);if(this.keys.has('arrowright')||this.keys.has('d'))move.add(right);if(this.keys.has('arrowleft')||this.keys.has('a'))move.sub(right);
      if(move.lengthSq()){move.normalize().multiplyScalar(dt*this.camera.position.distanceTo(this.controls.target)*.38);this.controls.target.add(move);this.camera.position.add(move);this.follow=false;}
    }
    const limit=this.city.radius*CELL-8,clamped=this.controls.target.clone();clamped.x=T.MathUtils.clamp(clamped.x,-limit,limit);clamped.z=T.MathUtils.clamp(clamped.z,-limit,limit);const correction=clamped.sub(this.controls.target);this.controls.target.add(correction);this.camera.position.add(correction);
    if(this.follow&&this.world.traffic.followTarget){const target=this.world.traffic.followTarget.position;this.controls.target.lerp(target,dt*1.5);this.camera.position.lerp(target.clone().add(new T.Vector3(15,12,21)),dt*.75);}
    this.controls.update(dt);this.renderer.info.reset();this.world.update(dt,this.elapsed,this.controls.target,this.camera.position.distanceTo(this.controls.target));this.environment.update(dt,this.camera,this.controls.target);this.sound.update(this.city.environment,this.controls.target);this.composer.render();
    this.uiClock+=dt;if(this.uiClock>.3){this.ui.clock();this.uiClock=0;}requestAnimationFrame(this.animate);
  }
}
new App().init().catch(error=>{console.error(error);const loading=document.querySelector('#loading');if(loading)loading.innerHTML='<div class="loading-mark">栖</div><h1>城市暂时没有打开</h1><p>请确认浏览器支持 WebGL，然后刷新重试。</p><p id="startup-error"></p>';const p=document.querySelector('#startup-error');if(p)p.textContent=error.message;});
