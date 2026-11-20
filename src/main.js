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
import { SimulationClock } from './simulation-clock.js';
import { PROTOTYPE_HULL, PROTOTYPE_RADIUS, WATER_Y, navigableSpan, riverBanks } from './river.js';
import { pointOnTrack } from './navigation.js';
import { bridgeRise, buildBridges, REQUIRED_UNDERSIDE } from './bridges.js';
import { BRIDGE_STYLES, gridBridgeAppearance } from './bridge-styles.js';
import { ROAD_PROFILES, hasTraffic } from './road-network.js';
import { placementOf, usesParcel } from './parcel.js';
import { ParcelEditor } from './parcel-editor.js';
import { RoadEditor } from './road-editor.js';
import { normalBearing } from './road-alignment.js';
import { World } from './world.js';
import { Environment } from './environment.js';
import { getTemplate } from './models.js';
import { UI } from './ui.js';
import { Soundscape } from './audio.js';
import { saves, createSaveStore, download } from './storage.js';
import { SaveSession, parseCityFile } from './save-session.js';
import { Autosave, createSaveWriter, encodeSnapshot } from './autosave.js';
import { icon } from './icons.js';
import { loadArchitectureAssets } from './asset-loader.js';
import { createBaseline, createScene, SCENE_WEATHER } from './baseline.js';
import { RIVERFRONT_STUDY_ID, STUDY_FRONTAGES, riverfrontEvidence, riverfrontGuideLines } from './riverfront-study.js';
import { RiverfrontEditor } from './riverfront-editor.js';

function sceneForApp(id, density) {
  if(id===RIVERFRONT_STUDY_ID&&!import.meta.env.DEV)throw new Error('西岸街坡仅在开发服务中开放');
  return createScene(id,density);
}

class App {
  async init(){
    this.mode='select';this.buildType=null;this.rotation=0;this.buildColor=0;this.selected=null;this.selectedParcel=null;this.moving=null;this.keys=new Set();this.cursor=null;this.dragCells=[];this.drawing=false;this.freeCamera=false;this.follow=false;this.quiet=false;this.thumbCache=new Map();this.replacing=false;
    if(import.meta.env.DEV&&new URLSearchParams(location.search).get('baseline')==='BASE-02'){
      this.baseline=createBaseline();
    }
    const sceneParams=new URLSearchParams(location.search);
    if(sceneParams.has('scene'))this.baseline=sceneForApp(sceneParams.get('scene'),sceneParams.get('density')||'standard');
    const allowRiverfront=this.baseline?.id===RIVERFRONT_STUDY_ID;
    this.cityOptions={allowRiverfront};
    const saveName=this.baseline?(this.baseline.cameras?`riverlight-scenes-${this.baseline.id}-${this.baseline.density}`:'riverlight-baselines'):'riverlight-cities';
    this.saves=this.baseline?createSaveStore({name:saveName,allowRiverfront}):saves;
    this.saveSession=new SaveSession(this.saves,this.cityOptions);const opened=await this.saveSession.open(this.baseline,{resume:!!this.baseline&&new URLSearchParams(location.search).get('resume')==='1'});this.city=opened.city;
    this.canvas=document.querySelector('#scene');this.renderer=new T.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.setSize(innerWidth,innerHeight);this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.98;this.renderer.outputColorSpace=T.SRGBColorSpace;
    this.scene=new T.Scene();this.camera=new T.PerspectiveCamera(39,innerWidth/innerHeight,.5,4500);this.camera.position.set(183,180,230);
    this.renderer.info.autoReset=false;
    this.controls=new OrbitControls(this.camera,this.canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.075;this.controls.minDistance=24;this.controls.maxDistance=900;this.controls.minPolarAngle=.18;this.controls.maxPolarAngle=Math.PI*.43;this.controls.target.set(4,0,15);this.controls.mouseButtons={LEFT:null,MIDDLE:T.MOUSE.PAN,RIGHT:T.MOUSE.ROTATE};this.controls.panSpeed=.8;this.controls.rotateSpeed=.5;this.controls.zoomSpeed=.65;this.controls.update();
    this.selectionIds=new Set();
    this.groupTransform=null;
    this.simulation=new SimulationClock();
    this.raycaster=new T.Raycaster();this.pointer=new T.Vector2();this.plane=new T.Plane(new T.Vector3(0,1,0),0);this.point=new T.Vector3();
    this.assetStatus=await loadArchitectureAssets();this.world=new World(this.scene,this.city,this.baseline?.seed);this.environment=new Environment(this.scene,this.renderer,this.city);this.sound=new Soundscape();
    this.composer=new EffectComposer(this.renderer);this.composer.addPass(new RenderPass(this.scene,this.camera));this.ao=new CityAOPass(this.scene,this.camera,innerWidth,innerHeight,this.environment);this.ao.blendIntensity=.65;this.ao.updateGtaoMaterial({radius:2.5,distanceExponent:1,thickness:1,scale:1,samples:8});this.composer.addPass(this.ao);this.bloom=new UnrealBloomPass(new T.Vector2(innerWidth,innerHeight),.16,.45,1.15);this.composer.addPass(this.bloom);this.composer.addPass(new OutputPass());
    this.thumbTarget=new T.WebGLRenderTarget(160,128,{format:T.RGBAFormat});this.thumbTarget.texture.colorSpace=T.SRGBColorSpace;
    this.thumbScene=new T.Scene();this.thumbScene.add(new T.HemisphereLight('#fff6e2','#869a78',3));const thumbLight=new T.DirectionalLight('#ffffff',3);thumbLight.position.set(-6,14,12);this.thumbScene.add(thumbLight);
    this.ui=new UI(this);this.editor=new ParcelEditor(this,this.ui.root);this.roadEditor=new RoadEditor(this,this.ui.root.querySelector('.road-editor'));
    if(allowRiverfront)this.platformEditor=new RiverfrontEditor(this,this.ui.root.querySelector('.riverfront-editor'));
    const writer=createSaveWriter(this.saves,saveName,this.cityOptions);
    this.autosave=new Autosave({
      available:()=>!this.replacing,
      capture:async current=>{
        const camera=this.cameraState(),parts=await encodeSnapshot(this.city,current);
        return parts?{parts,camera}:null;
      },
      write:({parts,camera})=>this.saveSession.persistEncoded(parts,camera,writer),
      onStart:()=>this.ui.saved('正在保存…'),
      onFinish:error=>this.saveFeedback(error),
    });
    this.bind();this.setQuality();
    this.canvas.dataset.assetLibrary=`Blender ${this.assetStatus.loaded.length}/${this.assetStatus.loaded.length+this.assetStatus.failed.filter(id=>!this.assetStatus.loaded.includes(id)).length}`;
    if(this.assetStatus.failed.length)this.ui.toast('部分精细模型未加载，请刷新重试',true);
    if(opened.camera)this.restoreCamera(opened.camera);
    this.environment.update(.016,this.camera,this.controls.target);this.composer.render();
    document.querySelector('#loading').style.opacity='0';setTimeout(()=>document.querySelector('#loading').remove(),800);
    if(opened.error){console.error(opened.error);this.ui.saved('原存档已保护 · 当前另存恢复城市');this.ui.toast('原存档读取失败，已保护原记录。当前城市将另存，可在「我的城市」导出原记录。',true);}
    if(this.baseline)this.ui.saved(`独立场景 · ${this.baseline.id} / v${this.baseline.sceneVersion}`);
    this.last=performance.now();this.uiClock=0;this.animate=this.animate.bind(this);requestAnimationFrame(this.animate);
    setTimeout(()=>document.querySelector('.intro')?.classList.add('hide'),22000);
    // Read-only diagnostics are useful during visual and performance verification.
    window.riverlight={getStats:()=>({entities:this.city.entities.size,buildings:[...this.city.entities.values()].filter(e=>BY_ID[e.type].floors).length,pedestrians:this.world.traffic.people.walkers.length,visiblePedestrians:this.world.traffic.people.visibleCount,walkNodes:this.world.traffic.people.network.nodes.size,chunks:this.world.loaded.size,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,environment:{...this.city.environment},mode:this.mode,selected:this.selected,roadRevision:this.city.roadNetwork.revision,walkRoadRevision:this.world.traffic.people.network.revision,laneRoadRevision:this.city.roadNetwork.laneGraph.revision,laneEdges:this.city.roadNetwork.laneGraph.edges.size,mobilityOverlay:this.world.walkOverlay.visible,sailing:this.world.traffic.boatStatus,junctionPreview:this.world.junctionPreview.active&&{...this.world.junctionPreview.active},baseline:this.baseline?{id:this.baseline.id,sceneVersion:this.baseline.sceneVersion,seed:this.baseline.seed}:null}),version:'1.0.0'};
    window.riverlight.getVehicles=()=>this.world.traffic.vehicleStatus;
    if(allowRiverfront)window.riverlight.getRiverfront=()=>riverfrontEvidence(this.city,this.world.traffic.people.network);
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
    if(id)sceneForApp(id,density); // Validate before saving or navigating.
    this.navigating=true;
    try{
    if(!await this.persist())return;
    if(this.baseline?.cameras&&!resume)await this.saveSession.replace(this.city,this.cameraState(),this.city,this.cameraState());
    const url=new URL(location.href);url.searchParams.delete('baseline');url.searchParams.delete('resume');url.searchParams.delete('density');
    if(id){url.searchParams.set('scene',id);url.searchParams.set('density',density);if(resume)url.searchParams.set('resume','1');}
    else url.searchParams.delete('scene');
    this.replacing=true;this.autosave.cancel();location.assign(url);
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
    let mobility;
    if(this.baseline?.id==='T05'){
      const graph=this.world.traffic.people.network;
      const byNode=new Map();
      for(const group of graph.components){
        const kinds=[...new Set(group.map(node=>node.kind))].sort();
        for(const node of group)byNode.set(node.id,kinds);
      }
      mobility=graph.destinations.flatMap(node=>{
        const entity=this.city.entities.get(node.entityId);
        return entity?.pose?[{id:entity.id,type:entity.type,parcel:entity.pose.parcel.id,point:[node.x,node.y,node.z],reachable:byNode.get(node.id)??[]}]:[];
      });
    }
    const riverfront=this.baseline?.id===RIVERFRONT_STUDY_ID?riverfrontEvidence(this.city,this.world.traffic.people.network):undefined;
    const river=this.baseline?.cameras?.river?{
      waterY:this.environment.water.position.y,quaySections:this.city.waterfront.length,radius:PROTOTYPE_RADIUS,
      sections:[-55,0,35].map(z=>({z,banks:riverBanks(z,this.city.terrain),navigable:navigableSpan(z,this.city.terrain,PROTOTYPE_RADIUS)})),
      requiredUnderside:REQUIRED_UNDERSIDE,bridges:this.city.roadNetwork.bridges.crossings,
      hull:PROTOTYPE_HULL,sailing:this.world.traffic.boatStatus,
      reaches:this.world.traffic.routes.map(({from,to})=>[from,to].map(d=>pointOnTrack(this.world.traffic.track,d).z)),
    }:undefined;
    return {revision:document.querySelector('meta[name="riverlight-revision"]')?.content,workingTree:document.querySelector('meta[name="riverlight-working-tree"]')?.content,
      capturedAt:new Date().toISOString(),scene:this.baseline?{id:this.baseline.id,version:this.baseline.sceneVersion,seed:this.baseline.seed,density:this.baseline.density}:null,
      browser:navigator.userAgent,viewport:[innerWidth,innerHeight],pixelRatio:this.renderer.getPixelRatio(),camera:this.cameraState(),
      ...window.riverlight.getStats(),cars:this.world.traffic.cars.length,vehicles:this.world.traffic.vehicleStatus,boats:this.world.traffic.boats.length,mobility,river,riverfront,
      detailedChunks:[...this.world.loaded.values()].filter(chunk=>chunk.detail).length,
      rendererMemory:{...this.renderer.info.memory},method:'最近一帧累计渲染调用（含反射与后处理）；几何/纹理为 WebGL 资源数量，不是字节数',
      frameTime:null,gpuMemoryBytes:null,deviceClass:'未登记',limitations:this.baseline?.limitations||[],spatial};
  }
  bind(){
    window.addEventListener('resize',()=>{this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight);this.composer.setSize(innerWidth,innerHeight);});
    this.canvas.addEventListener('contextmenu',e=>e.preventDefault());
    this.canvas.addEventListener('pointermove',e=>{
      this.updatePointer(e);this.extendStroke();
      if(this.platformEditor?.start&&this.cursor)this.platformEditor.draw(this.point.x,this.point.z,true);
      else if(this.editor.active&&this.cursor)this.editor.pointer(this.point.x,this.point.z);
      else if(this.roadEditor.active&&this.cursor)this.roadEditor.pointer(...this.roadPointer(),e);
      else this.preview();
    });
    this.canvas.addEventListener('pointerdown',e=>{
      if(e.button!==0||this.ui.modalOpen||this.replacing)return;
      this.updatePointer(e);this.pointerDown={x:e.clientX,y:e.clientY};
      if(!this.cursor)return;
      if(this.platformEditor?.active){this.platformEditor.start=[this.point.x,this.point.z];this.canvas.setPointerCapture(e.pointerId);}
      else if(this.roadEditor.active)this.roadEditor.beginDraw(...this.roadPointer(),e);
      else if(this.buildType&&['road','bridge','path','tree'].includes(this.buildType)&&!this.moving){
        this.drawing=true;this.dragCells=[[this.cursor.x,this.cursor.z]];this.lastCell=this.dragCells[0];this.canvas.setPointerCapture(e.pointerId);
      }
    });
    this.canvas.addEventListener('pointerup',e=>{
      if(e.button!==0)return;
      if(this.replacing){this.drawing=false;this.dragCells=[];this.pointerDown=null;this.roadEditor.cancelDraw();if(this.platformEditor)this.platformEditor.start=null;return;}
      this.updatePointer(e);
      if(this.platformEditor?.start){
        const start=this.pointerDown;
        this.pointerDown=null;
        if(start&&this.cursor)this.platformEditor.draw(this.point.x,this.point.z,Math.hypot(e.clientX-start.x,e.clientY-start.y)>=7);
        this.platformEditor.start=null;
        return;
      }
      if(this.drawing){
        this.extendStroke();this.drawing=false;
        const painted=this.city.paint(this.buildType,this.dragCells);
        if(painted)this.changed();else this.ui.toast(this.city.editError??'没有可放置的位置，请检查占地或切换桥梁',true);
        this.world.clearPreview();this.dragCells=[];this.pointerDown=null;return;
      }
      if(!this.pointerDown)return;
      const distance=Math.hypot(e.clientX-this.pointerDown.x,e.clientY-this.pointerDown.y);
      this.pointerDown=null;
      if(distance>=7&&this.roadEditor.active&&this.cursor)this.roadEditor.finishDraw(...this.roadPointer());
      else{this.roadEditor.cancelDraw();if(distance<7)this.click(e);}
    });
    this.canvas.addEventListener('pointercancel',()=>{this.drawing=false;this.dragCells=[];this.pointerDown=null;this.roadEditor.cancelDraw();if(this.platformEditor)this.platformEditor.start=null;});
    this.canvas.addEventListener('pointerleave',()=>{if(!this.drawing){if(this.roadEditor.active)this.roadEditor.render();else if(!this.editor.active)this.world.clearPreview();this.cursor=null;}});
    this.canvas.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';this.updatePointer(e);if(this.editor.active&&this.cursor)this.editor.pointer(this.point.x,this.point.z);else this.preview();});
    this.canvas.addEventListener('drop',e=>{e.preventDefault();if(this.replacing)return;const type=e.dataTransfer.getData('text/plain');if(!BY_ID[type])return;if(this.buildType!==type&&this.editor.type!==type)this.startBuild(type);this.updatePointer(e);this.click();});
    window.addEventListener('keydown',e=>this.keydown(e));window.addEventListener('keyup',e=>this.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>{this.keys.clear();this.drawing=false;this.pointerDown=null;this.roadEditor.cancelDraw();if(this.platformEditor)this.platformEditor.start=null;});
    document.addEventListener('visibilitychange',()=>{
      this.last=performance.now();
      if(document.hidden){this.keys.clear();this.autosave.flush();}
    });
    this.controls.addEventListener('start',()=>{this.follow=false;});
  }
  extendStroke(){
    if(!this.drawing||!this.cursor)return;
    const cell=[this.cursor.x,this.cursor.z];
    if(cell[0]===this.lastCell[0]&&cell[1]===this.lastCell[1])return;
    this.dragCells.push(...gridLine(this.lastCell,cell).slice(1));this.lastCell=cell;
  }
  updatePointer(event){const r=this.canvas.getBoundingClientRect();this.pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);if(this.raycaster.ray.intersectPlane(this.plane,this.point)){const step=snapStep(this.buildType);this.cursor={x:legacySnap(this.point.x,step),z:legacySnap(this.point.z,step)};}else this.cursor=null;}
  roadPointer(){
    const hit=this.raycaster.intersectObjects(this.world.pickables.filter(o=>o.userData.alignment),true)[0];
    const p=hit?.point??this.point;
    return [p.x,p.z];
  }
  candidate(){return this.cursor&&this.buildType?{id:-1,type:this.buildType,x:this.cursor.x,z:this.cursor.z,rotation:this.rotation,color:this.buildColor,...(this.moving&&this.city.entities.get(this.moving)?.lot?{lot:this.city.entities.get(this.moving).lot}:{})}:null;}
  preview(){
    if(this.groupTransform){this.previewGroup();return;}
    if(this.editor.active){this.editor.render();return;}
    if(this.roadEditor.active){this.roadEditor.render();return;}
    const e=this.candidate();
    if(!e)return;
    const error=this.city.canPlace(e,this.moving);
    if(e.type==='bridge')this.previewBridge(e,error);
    else this.world.showPreview(e,!error,this.moving);
  }
  previewBridge(entity,placementError){
    const placements=this.drawing?this.city.paintPlan('bridge',this.dragCells):placementError?[]:[{...entity,id:this.moving??entity.id}];
    if(!placements.length){this.world.showPreview(entity,false,this.moving);this.ui.hint(placementError??'没有可放置的位置');return;}
    const grid=[...this.city.entities.values()].filter(e=>e.id!==this.moving&&!e.alignment&&hasTraffic(e.type)).concat(placements);
    const {vehicleY,bedY}=ROAD_PROFILES.road;
    const previous=this.city.roadNetwork;
    const {grades,crossings:plans}=buildBridges(grid,previous.alignmentMasks,this.city.terrain,vehicleY);
    const ids=new Set(placements.map(e=>e.id));
    const crossings=plans.filter(({deckIds,approachIds,passable})=>deckIds.some(id=>ids.has(id)||!passable&&previous.bridges.byTile.get(id)?.passable)||approachIds.some(id=>ids.has(id)));
    const issue=crossings.find(bridge=>!bridge.passable)?.reason;
    const hints={approach:'净空不足 · 需要连续跨河桥面，两岸各接 3 格直线引桥',channel:'净空不足 · 桥孔横向空间不足',height:'净空不足 · 桥底低于船体安全高度'};
    for(const bridge of crossings)for(const id of [...bridge.deckIds,...bridge.approachIds])ids.add(id);
    const profiles=grid.filter(e=>ids.has(e.id)).map(e=>[-CELL/2,CELL/2].map(offset=>{
      const x=e.x*CELL+offset;
      return {point:[x,bedY+bridgeRise(grades.get(e.id),x),e.z*CELL],direction:[1,0]};
    }));
    const bridges=issue?[]:crossings.map(crossing=>{
      const {bounds}=crossing,z=(bounds.minZ+bounds.maxZ)/2;
      const appearance=gridBridgeAppearance(crossing,bounds=>this.city.queryFootprints(bounds));
      const samples=[bounds.minX,bounds.maxX].map(x=>({point:[x,bedY+bridgeRise(bounds,x),z],direction:[1,0]}));
      return {appearance,samples};
    });
    this.world.showRoadPreviews(profiles,!!issue,this.moving,[],bridges);
    const styles=new Set(bridges.map(({appearance})=>BRIDGE_STYLES[appearance.key].name));
    this.ui.hint(issue?hints[issue]:crossings.length?`桥下净空 ${(Math.min(...crossings.map(bridge=>bridge.bottomY))-WATER_Y).toFixed(2)} 米 · 可容纳原型船 · ${[...styles].join('、')}`:
      '按住左键跨河绘制 · 两岸各接 3 格直线引桥 · Esc 取消');
  }
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
    this.setSelection(result.entity?[result.entity.id]:[],result.parcel.id);this.cancel();
    if(result.changed){this.changed();this.sound.click();}
  }
  startRoadEdit(entity,options){
    this.cancel();this.mode='alignment';this.world.select(null);this.roadEditor.open(entity,options);this.ui.refreshActive();this.ui.refreshSelection();
  }
  extendRoad(entity,end,grade='level'){
    const segment=entity?.alignment&&this.city.roadNetwork.segments.get(entity.id);
    if(!segment||segment.ports.some(port=>port.end===end))return;
    const point=entity.alignment[end?'end':'start'];
    const anchor=end?point:[...point.slice(0,3),normalBearing(point[3]+180)];
    this.startRoadEdit(undefined,{elevated:!!entity.alignment.elevated,anchor,grade});
  }
  finishRoadEdit(result,extend=false){
    const grade=this.roadEditor.grade;
    this.setSelection([result.entity.id]);this.cancel();
    if(result.changed){this.changed();this.sound.click();}
    if(extend)this.extendRoad(result.entity,1,grade);
  }
  cancel(){
    const wasGrouping=!!this.groupTransform;
    this.groupTransform=null;
    if(this.ui.root.classList.contains('paving-study')){
      this.ui.root.classList.remove('paving-study');
      if(this.studyLayer==='forecourt'){this.studyLayer=null;this.world.showStudyGuide([]);}
      this.ui.refreshStudy();
    }
    this.world.clearPreview();this.buildType=null;this.moving=null;this.rotation=0;this.buildColor=0;this.mode='select';this.drawing=false;this.dragCells=[];
    if(this.editor?.active){this.editor.close();this.world.select(this.selected,this.selectedParcel);this.ui.refreshSelection();}
    if(this.roadEditor?.active){this.roadEditor.close();this.world.select(this.selected,this.selectedParcel);this.ui.refreshSelection();}
    if(this.platformEditor?.active){this.platformEditor.close();this.ui.refreshSelection();}
    this.ui?.hint('');this.ui?.refreshActive();
    if(wasGrouping){this.showSelection();this.ui.refreshSelection();}
  }
  setSelection(ids,parcelId=null){
    this.selectionIds=new Set(ids);
    this.selected=[...this.selectionIds].at(-1)??null;
    this.selectedParcel=this.city.entities.get(this.selected)?.pose?.parcel.id??parcelId;
  }
  showSelection(){
    this.world.select(this.selected,this.selectedParcel,this.selectionIds.size>1?this.selectionIds:null);
  }
  startGroupTransform(mode){
    this.cancel();
    const entities=[...this.selectionIds].map(id=>this.city.entities.get(id));
    const centers=entities.map(e=>{
      if(!e.alignment)return placementOf(e);
      const [x,,z]=this.city.roadNetwork.segments.get(e.id).center;
      return {x,z};
    });
    const hasGrid=entities.some(e=>!e.pose&&!e.alignment);
    const step=entities.some(e=>['road','bridge','path'].includes(e.type)&&!e.alignment)?CELL:hasGrid?CELL/2:.1;
    const pivot=['x','z'].map(axis=>Math.round(centers.reduce((sum,p)=>sum+p[axis],0)/centers.length/step)*step);
    this.groupTransform={mode,pivot,step,turn:hasGrid?90:15,degrees:0,dx:0,dz:0};
    if(mode==='rotate')this.groupTransform.degrees=this.groupTransform.turn;
    this.previewGroup(false);
    this.ui.refreshSelection();
  }
  previewGroup(followPointer=true){
    const draft=this.groupTransform;
    if(followPointer&&draft.mode==='move'&&this.cursor){
      draft.dx=Math.round((this.point.x-draft.pivot[0])/draft.step)*draft.step;
      draft.dz=Math.round((this.point.z-draft.pivot[1])/draft.step)*draft.step;
    }
    const plan=this.city.planGroupTransform(this.selectionIds,draft.pivot,draft.dx,draft.dz,draft.degrees);
    this.world.showGroupPreview(plan.entities??[],!plan.error);
    const direction=draft.mode==='rotate'?`已旋转 ${draft.degrees}° · R 继续旋转 · 点击应用`:'移动鼠标预览 · 点击放置';
    this.ui.hint(plan.error??`${direction} · Esc 取消`);
  }
  applyGroup(){
    const {pivot,dx,dz,degrees}=this.groupTransform;
    if(!dx&&!dz&&!degrees){this.cancel();this.ui.refreshSelection();return;}
    if(!this.city.transformGroup(this.selectionIds,pivot,dx,dz,degrees)){this.reportEditError();return;}
    this.cancel();this.changed();this.sound.click();
  }
  click(event){
    if(!this.cursor||this.ui.modalOpen||this.replacing)return;
    if(this.groupTransform){this.previewGroup();this.applyGroup();return;}
    if(this.editor.active){this.editor.click(this.point.x,this.point.z);return;}
    if(this.roadEditor.active){this.roadEditor.click(...this.roadPointer());return;}
    if(this.buildType){const e=this.candidate(),error=this.city.canPlace(e,this.moving);if(error){this.ui.toast(error,true);return;}
      const placed=this.moving?this.city.move(this.moving,e.x,e.z,e.rotation):this.city.place(e.type,e.x,e.z,e.rotation,e.color);
      if(!placed){this.reportEditError();return;}
      if(this.moving)this.cancel();
      this.changed();this.sound.click();this.preview();return;
    }
    this.raycaster.setFromCamera(this.pointer,this.camera);const hits=this.raycaster.intersectObjects(this.world.pickables,true),hit=hits[0];
    const parcel=this.city.parcelAt(this.point.x,this.point.z);
    const id=hit?.object.userData.entityIds?.[hit.instanceId]??hit?.object.userData.entityId??this.city.nativeAt(this.point.x,this.point.z)?.id??this.city.at(this.cursor.x,this.cursor.z)?.id;
    if(this.mode==='erase'){
      if(id?this.city.remove(id):parcel&&this.city.removeEmptyParcel(parcel.id)){this.setSelection([]);this.changed();}
      else if(id||parcel)this.reportEditError();
      return;
    }
    const entity=id?this.city.entities.get(id):parcel&&this.city.parcelOwner(parcel);
    if(event?.ctrlKey||event?.metaKey){
      if(!entity)return;
      const ids=new Set(this.selectionIds);
      if(ids.has(entity.id))ids.delete(entity.id);else ids.add(entity.id);
      this.setSelection(ids);
    }else this.setSelection(entity?[entity.id]:[],parcel?.id);
    this.showSelection();this.ui.refresh();
  }
  reportEditError(){if(this.city.editError)this.ui.toast(this.city.editError,true);}
  changed(){this.world.sync(true,this.controls.target,this.camera.position.distanceTo(this.controls.target));if(this.studyLayer)this.world.showStudyGuide(riverfrontGuideLines(this.city,this.studyLayer));this.environment.refreshSources();this.showSelection();this.ui.refresh();this.autosave.mark();}
  setEnvironment(values){
    if(this.replacing||Object.entries(values).every(([key,value])=>this.city.environment[key]===value))return;
    Object.assign(this.city.environment,values);if(values.quality)this.setQuality();this.ui.refresh();this.autosave.mark();
  }
  setQuality(){const high=this.city.environment.quality==='high';this.renderer.setPixelRatio(Math.min(devicePixelRatio,high?1.5:1));this.composer.setPixelRatio(this.renderer.getPixelRatio());this.bloom.enabled=high;this.ao.enabled=high;this.environment.sun.castShadow=true;}
  cameraState(){return {position:this.camera.position.toArray(),target:this.controls.target.toArray()};}
  restoreCamera(c){if(!c||![c.position,c.target].every(v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<50000)))return;this.camera.position.fromArray(c.position);this.controls.target.fromArray(c.target);this.controls.update();this.camera.updateMatrixWorld();}
  async persist(id){
    if(this.replacing)return false;
    if(id===undefined)return this.autosave.flush(true);
    try{await this.saveSession.persist(this.city,this.cameraState(),id);this.saveFeedback();return true;}
    catch(error){this.saveFeedback(error);return false;}
  }
  saveFeedback(error){
    if(error){console.error(error);this.ui.saved('保存失败，请导出备份');this.ui.toast('浏览器保存失败，请导出城市文件备份',true);return;}
    this.ui.saved(this.saveSession.protected?'已保存恢复城市 · 原存档已保护':this.baseline?'已保存 · 隔离测试城市':'已保存 · 只属于你的节奏');
  }
  async listSaves(){return this.saves.list();}
  async replaceCity(city,camera,original){
    if(this.replacing)return false;this.replacing=true;this.autosave.cancel();
    const view=camera||{position:[183,180,230],target:[4,0,15]};
    try{
      try{await this.saveSession.replace(this.city,this.cameraState(),city,view,original);}
      catch(error){console.error(error);this.ui.toast('城市切换失败，原城市已保留。请导出备份后重试。',true);return false;}
      this.cancel();this.setSelection([]);this.simulation.reset();this.last=performance.now();
      this.city=city;this.world.setCity(city);if(this.studyLayer)this.world.showStudyGuide(riverfrontGuideLines(city,this.studyLayer));this.environment.city=city;this.environment.refreshSources();this.follow=false;this.controls.autoRotate=false;this.setQuality();this.restoreCamera(view);this.ui.refresh();this.ui.closeModal();
      this.autosave.reset();this.ui.saved(this.saveSession.protected?'已保存恢复城市 · 原存档已保护':'已保存 · 当前城市已备份');return true;
    }finally{this.replacing=false;this.autosave.schedule();}
  }
  async importFile(file){try{if(file.size>20*1024*1024)throw new Error('城市文件超过 20 MB');const parsed=parseCityFile(await file.text(),this.cityOptions);if(await this.replaceCity(parsed.city,parsed.camera,parsed.original))this.ui.toast('城市已导入，欢迎回来');}catch(error){this.ui.toast(`无法导入：${error.message}`,true);}}
  home(){this.follow=false;this.controls.autoRotate=false;this.keys.clear();this.camera.position.set(183,180,230);this.controls.target.set(4,0,15);this.controls.update();}
  zoom(factor){const direction=this.camera.position.clone().sub(this.controls.target);const length=T.MathUtils.clamp(direction.length()*factor,this.controls.minDistance,this.controls.maxDistance);this.camera.position.copy(this.controls.target).add(direction.setLength(length));this.controls.update();}
  keydown(e){
    if(e.key==='Escape'&&(this.editor.active||this.roadEditor.active||this.platformEditor?.active||this.groupTransform)){e.preventDefault();this.cancel();this.ui.refreshSelection();return;}
    if(e.target.matches('input,textarea,select')||this.ui.modalOpen){if(e.key==='Escape')this.ui.closeModal();return;}
    if(e.key===' '&&e.target.closest('button'))return;
    const key=e.key.toLowerCase();this.keys.add(key);
    if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key))e.preventDefault();
    if(e.ctrlKey||e.metaKey){if(['z','y','s'].includes(key))e.preventDefault();if(key==='z')this.action(e.shiftKey?'redo':'undo');if(key==='y')this.action('redo');if(key==='s')this.action('save');return;}
    if(e.repeat)return;
    const actions={v:'select',b:'road',t:'trees',x:'erase',c:'camera',h:'quiet',home:'home',delete:'delete',backspace:'delete'};
    if(actions[key]){e.preventDefault();this.action(actions[key]);}
    if(key==='r'){if(this.editor.active)this.editor.rotate();else if(this.platformEditor?.active)this.platformEditor.rotate();else if(this.buildType){this.rotation=(this.rotation+1)%4;this.preview();}else this.action('rotate');}
    if(key==='escape'){if(this.quiet)this.action('quiet');this.cancel();this.setSelection([]);this.world.select(null);this.world.junctionPreview.clear();this.world.showMobility(false);this.world.showRiver(false);this.ui.refresh();}
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
      case 'cancel-platform':this.cancel();break;
      case 'study-frontage':if(this.platformEditor){
        const {type,...sample}=STUDY_FRONTAGES.find(lot=>lot.type===el.dataset.type);
        const parcel=this.city.parcels.get(sample.id)??sample,entity=this.city.parcelOwner(parcel);
        this.startParcelEdit({mode:entity?'lot':'quick',parcel,type,entity});
      }break;
      case 'study-paving':if(this.platformEditor){
        this.startBuild('path');
        this.ui.root.classList.add('paving-study');
        this.studyLayer='forecourt';this.world.showStudyGuide(riverfrontGuideLines(this.city,this.studyLayer));
        this.ui.refreshStudy();
        this.ui.hint('按住左键沿白线拖铺桥头前场 · Esc 返回');
      }break;
      case 'study-platform':if(this.platformEditor){
        this.cancel();this.setSelection([]);this.showSelection();this.platformEditor.open();this.ui.refreshSelection();
      }break;
      case 'study-remove-platform':if(this.platformEditor){
        this.cancel();if(this.city.removePlatform())this.changed();else this.reportEditError();
      }break;
      case 'study-walk':if(this.platformEditor){
        this.world.showMobility(!this.world.walkOverlay.visible,this.controls.target);this.ui.refreshStudy();
      }break;
      case 'edit-lot':if(parcel)this.startParcelEdit({mode:'lot',parcel,entity:e});break;
      case 'edit-building':if(e?.pose)this.startParcelEdit({mode:'building',parcel:e.pose.parcel,entity:e});break;
      case 'road':this.ui.showCategory('road');this.startBuild('road');break;
      case 'draw-road':this.startRoadEdit();break;
      case 'draw-ramp':this.startRoadEdit(undefined,{ramp:true});break;
      case 'draw-elevated':this.startRoadEdit(undefined,{elevated:true});break;
      case 'edit-road':if(e?.alignment)this.startRoadEdit(e);break;
      case 'extend-road-start':this.extendRoad(e,0);break;
      case 'extend-road-end':this.extendRoad(e,1);break;
      case 'inspect-junction':if(e){
        const segment=this.city.roadNetwork.segments.get(e.id);
        if(!segment?.junction)break;
        const [x,,z]=segment.center;
        this.follow=false;this.controls.autoRotate=false;
        this.restoreCamera({target:[x,0,z],position:[x+5,25,z+10]});
        if(this.world.junctionPreview.id===e.id)this.world.junctionPreview.clear();else this.world.showJunction(e.id,'car');
        this.ui.refreshJunction();
      }break;
      case 'junction-vehicle':this.world.showJunction(this.world.junctionPreview.id,el.dataset.vehicle);this.ui.refreshJunction();break;
      case 'hide-junction':this.world.junctionPreview.clear();this.ui.refreshJunction();break;
      case 'trees':this.ui.showCategory('detail');this.startBuild('tree');break;
      case 'erase':this.cancel();this.mode='erase';this.ui.hint('点击拆除 · Ctrl+Z 可撤销 · Esc 返回');this.ui.refreshActive();break;
      case 'undo':this.cancel();if(this.city.undo()){this.setSelection([]);this.changed();}else this.reportEditError();break;
      case 'redo':this.cancel();if(this.city.redo()){this.setSelection([]);this.changed();}else this.reportEditError();break;
      case 'move':if(this.selectionIds.size>1){this.startGroupTransform('move');break;}if(e&&!e.pose&&!e.alignment){this.startBuild(e.type,e.color,true);this.moving=e.id;this.rotation=e.rotation;this.ui.hint('选择新的位置 · Esc 恢复原位');this.preview();}break;
      case 'copy':if(e?.pose){this.startParcelEdit({mode:'quick',entity:e,copy:true});}else if(e&&!e.alignment){this.startBuild(e.type,e.color,true);this.rotation=e.rotation;this.preview();}break;
      case 'rotate':
        if(this.groupTransform){
          const draft=this.groupTransform;
          draft.degrees=(draft.degrees+draft.turn)%360;
          this.previewGroup(false);
        }else if(this.selectionIds.size>1)this.startGroupTransform('rotate');
        else if(e?.pose){this.startParcelEdit({mode:'building',parcel:e.pose.parcel,entity:e});this.editor.rotate();}
        else if(e&&!e.alignment){if(!this.city.move(e.id,e.x,e.z,(e.rotation+1)%4))this.ui.toast(this.city.editError??'旋转后会与其他物件重叠',true);else this.changed();}
        break;
      case 'apply-group':if(this.groupTransform)this.applyGroup();break;
      case 'cancel-group':this.cancel();break;
      case 'color':if(e&&BY_ID[e.type].floors){this.city.recolor(e.id);this.changed();}break;
      case 'delete':if(!this.groupTransform&&!this.editor.active&&!this.roadEditor.active&&(e||parcel)){
        if(e?this.city.removeGroup(this.selectionIds):this.city.removeEmptyParcel(parcel.id)){this.setSelection([]);this.changed();}
        else this.reportEditError();
      }break;
      case 'focus':if(e?.alignment){this.controls.target.fromArray(this.city.roadNetwork.segments.get(e.id).center);this.camera.position.copy(this.controls.target).add(new T.Vector3(35,30,40));}else if(e||parcel){const p=e?placementOf(e):parcel;this.controls.target.set(p.x,0,p.z);this.camera.position.copy(this.controls.target).add(new T.Vector3(35,30,40));}break;
      case 'expand':if(this.city.expand()){this.changed();this.ui.toast(`城市向四周生长了 · 现在是 ${this.city.radius*2} × ${this.city.radius*2} 格`);}else this.ui.toast('已到达当前版本的世界边界');break;
      case 'zoom-in':this.zoom(.82);break;case 'zoom-out':this.zoom(1.22);break;case 'home':this.home();break;
      case 'camera':this.freeCamera=!this.freeCamera;this.controls.maxPolarAngle=this.freeCamera?Math.PI*.493:Math.PI*.43;this.controls.minDistance=this.freeCamera?8:24;document.querySelector('#camera-label').textContent=this.freeCamera?'返回建造视角':'自由观察';document.querySelector('[data-action=camera]').classList.toggle('active',this.freeCamera);this.ui.toast(this.freeCamera?'自由观察 · 右键环绕，方向键移动':'已返回建造视角');break;
      case 'quiet':this.cancel();this.quiet=!this.quiet;document.body.classList.toggle('quiet',this.quiet);this.world.emptyParcels.layers.set(this.quiet?1:0);break;
      case 'environment':{const panel=document.querySelector('.environment');panel.hidden=!panel.hidden;document.querySelector('[data-action=environment]').classList.toggle('active',!panel.hidden);break;}
      case 'play':this.setEnvironment({playing:!this.city.environment.playing});break;
      case 'toggle-simulation':
        this.simulation.paused=!this.simulation.paused;
        this.last=performance.now();
        this.ui.simulation(this.simulation.paused);
        break;
      case 'save':if(await this.persist())this.ui.toast('这一刻，已经为你保存');break;
      case 'cities':await this.ui.cities();break;
      case 'scenes':this.ui.scenes();break;
      case 'load-scene':await this.navigateScene(el.dataset.scene);break;
      case 'return-city':await this.navigateScene(null);break;
      case 'scene-density':await this.navigateScene('T07',el.dataset.density);break;
      case 'resume-scene':await this.navigateScene(this.baseline.id,this.baseline.density,true);break;
      case 'scene-camera':if(this.baseline?.cameras){
        const view=el.dataset.view,cell=this.baseline.junctionViews?.[view];
        this.follow=false;this.controls.autoRotate=false;this.restoreCamera(this.baseline.cameras[view]);
        this.world.showJunction(cell&&this.city.at(...cell)?.id,'car');this.world.showMobility(view==='walk',this.controls.target);
        this.world.showRiver(view==='river');
        this.ui.refreshJunction();
        this.ui.refreshStudy();
      }break;
      case 'scene-weather':{const preset=SCENE_WEATHER.find(p=>p.id===el.dataset.weatherId);if(preset){const {hour,season,weather}=preset;this.setEnvironment({hour,season,weather,playing:false});}break;}
      case 'study-guide':{
        this.studyLayer=this.studyLayer===el.dataset.layer?null:el.dataset.layer;
        this.world.showStudyGuide(riverfrontGuideLines(this.city,this.studyLayer));
        this.ui.refreshStudy();
        break;
      }
      case 'scene-evidence':download(`${this.baseline.id}-evidence.json`,JSON.stringify(this.sceneEvidence(),null,2));this.ui.toast('已导出当前镜头与实际资源记录');break;
      case 'save-copy':this.city.name=document.querySelector('#rename-city').value.trim()||'未命名城市';if(await this.persist(`city-${crypto.randomUUID()}`)){await this.persist();this.ui.refresh();await this.ui.cities();this.ui.toast('城市已收藏');}break;
      case 'load-city':{const s=await this.saves.load(el.dataset.saveId);if(!s?.data)throw new Error('该存档无法打开，请保留原记录并使用其他备份');await this.replaceCity(new City(s.data,this.cityOptions),s.camera);break;}
      case 'new-city':
      case 'new-strait-city':{
        const city=new City(undefined,this.cityOptions),strait=action==='new-strait-city';
        city.name=strait?'海峡新城':'新的河畔';
        if(strait)city.terrain='strait';
        await this.replaceCity(city);break;
      }
      case 'demo-city':{const demo=createDemo();await this.replaceCity(this.cityOptions.allowRiverfront?new City(demo.snapshot(),this.cityOptions):demo);break;}
      case 'export':download(`${this.city.name}.riverlight.json`,JSON.stringify({city:this.city.snapshot(),camera:this.cameraState()},null,2));this.ui.toast('城市文件已导出');break;
      case 'export-original':{const original=await this.saveSession.originalRecord();if(!original)throw new Error('原记录暂时无法读取，请保留浏览器数据并稍后重试');download('riverlight-original-record.json',JSON.stringify(original,null,2));this.ui.toast('原存档记录已导出，未作修改');break;}
      case 'export-save':{const record=await this.saves.load(el.dataset.saveId);if(!record)throw new Error('该记录暂时无法读取');download(`${record.name||'未命名城市'}.riverlight-record.json`,JSON.stringify(record,null,2));this.ui.toast('存档原记录已导出');break;}
      case 'reset-baseline':if(this.baseline){const initial=this.baseline.cameras?sceneForApp(this.baseline.id,this.baseline.density):createBaseline();if(await this.replaceCity(new City(initial.city,this.cityOptions),initial.camera)){const url=new URL(location.href);url.searchParams.delete('resume');location.assign(url);}}break;
      case 'import':document.querySelector('#import-file').click();break;
      case 'close-modal':this.ui.closeModal();break;case 'help':this.ui.help();break;case 'audio':this.ui.audio();break;
      case 'toggle-audio':await this.sound.enable();document.querySelector('.top-actions [data-action=audio]').innerHTML=icon(this.sound.enabled?'sound':'mute');this.ui.audio();break;
      case 'screenshot':{const guides=[this.world.selection,this.world.roadSelection,this.world.parcelSelection,this.world.emptyParcels],shown=guides.map(g=>g.visible);guides.forEach(g=>g.visible=false);this.world.clearPreview();this.composer.render();this.canvas.toBlob(blob=>{if(blob){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${this.city.name}-${Date.now()}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}},'image/png');guides.forEach((g,i)=>g.visible=shown[i]);this.preview();this.ui.toast('已留下这片风景');break;}
      case 'orbit':this.controls.autoRotate=!this.controls.autoRotate;this.controls.autoRotateSpeed=.3;this.follow=false;this.ui.closeModal();this.ui.toast(this.controls.autoRotate?'镜头正在缓缓环绕':'已停止环绕');break;
      case 'follow':if(!this.world.traffic.followTarget){this.ui.toast('先铺设一些连通道路，让车辆来到城市');break;}this.follow=this.follow?false:this.world.traffic.followTarget;this.controls.autoRotate=false;this.ui.closeModal();this.ui.toast(this.follow?'跟随车辆看风景 · 拖动视角即可退出':'已停止跟随');break;
      case 'bookmark':this.bookmark=this.cameraState();localStorage.setItem('riverlight-camera',JSON.stringify(this.bookmark));this.ui.toast('这个视角已收藏');break;
      case 'recall':{const c=this.bookmark||JSON.parse(localStorage.getItem('riverlight-camera')||'null');if(c){this.restoreCamera(c);this.ui.closeModal();}else this.ui.toast('还没有收藏镜头');break;}
    }
  }
  animate(now){
    const frameTime=Math.max(0,(now-this.last)/1000);
    this.last=now;
    const dt=Math.min(frameTime,.06);
    if(!document.hidden&&!this.replacing)this.simulation.advance(frameTime,(step,time)=>this.world.step(step,time));
    if(!this.ui.modalOpen){const dir=new T.Vector3();this.camera.getWorldDirection(dir);dir.y=0;dir.normalize();const right=new T.Vector3().crossVectors(dir,new T.Vector3(0,1,0));const move=new T.Vector3();
      if(this.keys.has('arrowup')||this.keys.has('w'))move.add(dir);if(this.keys.has('arrowdown')||this.keys.has('s'))move.sub(dir);if(this.keys.has('arrowright')||this.keys.has('d'))move.add(right);if(this.keys.has('arrowleft')||this.keys.has('a'))move.sub(right);
      if(move.lengthSq()){move.normalize().multiplyScalar(dt*this.camera.position.distanceTo(this.controls.target)*.38);this.controls.target.add(move);this.camera.position.add(move);this.follow=false;}
    }
    const limit=this.city.radius*CELL-8,clamped=this.controls.target.clone();clamped.x=T.MathUtils.clamp(clamped.x,-limit,limit);clamped.z=T.MathUtils.clamp(clamped.z,-limit,limit);const correction=clamped.sub(this.controls.target);this.controls.target.add(correction);this.camera.position.add(correction);
    if(this.follow&&!this.follow.parent)this.follow=false;
    if(this.follow){const target=this.follow.position;this.controls.target.lerp(target,dt*1.5);this.camera.position.lerp(target.clone().add(new T.Vector3(15,12,21)),dt*.75);}
    this.controls.update(dt);this.editor.handles.layout();this.roadEditor.handles.layout();this.roadEditor.layoutPoints();this.renderer.info.reset();this.world.update(this.simulation.time,this.controls.target,this.camera.position.distanceTo(this.controls.target));this.ui.sailing(this.world.riverOverlay.visible?this.world.traffic.boatStatus:null);this.environment.update(dt,this.camera,this.controls.target);this.sound.update(this.city.environment,this.controls.target);this.composer.render();
    this.uiClock+=dt;if(this.uiClock>.3){this.ui.clock();this.uiClock=0;}requestAnimationFrame(this.animate);
  }
}
new App().init().catch(error=>{console.error(error);const loading=document.querySelector('#loading');if(loading)loading.innerHTML='<div class="loading-mark">栖</div><h1>城市暂时没有打开</h1><p>请确认浏览器支持 WebGL，然后刷新重试。</p><p id="startup-error"></p>';const p=document.querySelector('#startup-error');if(p)p.textContent=error.message;});
