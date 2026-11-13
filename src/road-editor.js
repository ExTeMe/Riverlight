import { MAX_ELEVATED_ROAD_HEIGHT, MAX_ROAD_GRADE, MAX_ROAD_HEIGHT, MAX_ROAD_POINTS, alignmentGeometry, arcRoadBearings, maxRoadArc, maxRoadRise, normalBearing, roadBearing, signedRoadAngle } from './road-alignment.js';
import { WATER_Y } from './river.js';
import { RoadHeightHandles } from './road-height-handles.js';
import { gridRoadEnd, ROAD_DIRECTIONS } from './road-network.js';
import { Vector3, Plane } from 'three';
import { REQUIRED_UNDERSIDE } from './bridges.js';
import { ROAD_DECK_BOTTOM } from './elevated-roads.js';

const fields=[['x','X 坐标（米）'],['y','高度（米）'],['z','Z 坐标（米）'],['bearing','方向（°）']];
const presets={straight:[0,0],s:[30,30]};
const arcs={left:60,right:-60};
const grades={up:2,level:0,down:-2};

export class RoadEditor {
  constructor(app,form){
    this.app=app;this.form=form;
    form.innerHTML=`<h3>道路线形</h3><p class="parcel-instructions road-instructions"></p>
      <div class="parcel-scroll">
        <label class="angle-snap"><input type="checkbox" class="road-snap" checked>吸附现有道路（Shift 临时关闭）</label>
        <label class="angle-snap"><input type="checkbox" class="road-clear-street">清理沿线小径与街景（应用后可撤销）</label>
        <div class="scene-buttons road-grades" aria-label="高架走势" hidden>
          <button type="button" data-grade="up">上升</button><button type="button" data-grade="level">水平</button><button type="button" data-grade="down">下降</button>
        </div>
        <div class="road-height-info">
          <p class="road-height-rule"></p>
          <p class="road-height-range"></p>
        </div>
        <p class="parcel-feedback" role="status" aria-live="polite"></p>
        <div class="road-middle">
          <div class="scene-buttons">
            <button type="button" class="road-add-point" aria-pressed="false">添加中间点</button>
            <button type="button" class="road-remove-point">移除当前点</button>
          </div>
          <div class="road-point-controls" hidden>
            <label>中间点<select class="road-point-choice"></select></label>
            <label>前段转向 <output></output><input class="range" type="range" min="-45" max="45" step="1" data-bend="before"></label>
            <label>后段转向 <output></output><input class="range" type="range" min="-45" max="45" step="1" data-bend="after"></label>
          </div>
        </div>
        <div class="road-elevation">
          <label>整体升降范围<select class="road-lift-scope"><option value="segment">本段 · 相邻道路自动衔接</option><option value="route">整条相连道路</option></select></label>
          <div class="scene-buttons"><button type="button" data-lift="-.5">整体降低 0.5 米</button><button type="button" data-lift=".5">整体抬高 0.5 米</button></div>
          <button type="button" class="road-clearance">自动桥坡 · 保持两端连接</button>
          <div class="road-deck" hidden><label>桥面高度（米）<input type="number" class="road-deck-height" min="0" max="32" step="any"></label><input type="range" aria-label="调整桥面高度" class="range road-deck-slider" min="0" max="32" step="any"><button type="button" class="road-remove-deck">取消自动桥坡</button></div>
        </div>
        <div class="scene-buttons" aria-label="道路形状">${[['auto','自动顺接'],['straight','直线'],['left','左圆弧'],['right','右圆弧'],['s','S 弯']].map(([id,name])=>
          `<button type="button" data-shape="${id}">${name}</button>`).join('')}</div>
        <div class="road-arc" hidden>
          <label for="road-arc-angle">圆弧转角 <span></span></label>
          <input class="range" type="range" id="road-arc-angle" min="-180" max="180" step="any" value="0">
          <p class="parcel-instructions">拖动可改变转角与半径。</p>
        </div>
        <details class="road-precision"><summary>精细调整</summary>
        <p class="parcel-instructions">方向 0° 指向 +X，90° 指向 +Z。</p>
        ${['起点','终点'].map((title,i)=>`<fieldset><legend>${title}</legend><div class="parcel-fields">${fields.map(([name,label])=>
          `<label>${title} ${label}<input type="number" step="any" name="${i}-${name}"></label>`).join('')}</div></fieldset>`).join('')}
        </details>
      </div><div class="parcel-actions"><button type="button" data-action="select">取消</button><button type="button" class="road-redraw" hidden>重画端点</button><button class="primary" type="submit">应用道路</button></div>
      <button type="submit" class="road-continue" hidden>应用并延伸</button>`;
    this.feedback=form.querySelector('.parcel-feedback');this.submit=form.querySelector('[type=submit]');
    this.continueButton=form.querySelector('.road-continue');this.gradeButtons=form.querySelector('.road-grades');
    this.heightRule=form.querySelector('.road-height-rule');
    this.title=form.querySelector('h3');this.instructions=form.querySelector('.road-instructions');this.rangeText=form.querySelector('.road-height-range');
    this.precision=form.querySelector('.road-precision');this.redraw=form.querySelector('.road-redraw');
    this.arcControls=form.querySelector('.road-arc');this.arcSlider=this.arcControls.querySelector('input');
    this.arcLabel=this.arcControls.querySelector('span');this.arcHint=this.arcControls.querySelector('p');
    this.liftScope=form.querySelector('.road-lift-scope');
    this.snap=form.querySelector('.road-snap');
    this.clearStreet=form.querySelector('.road-clear-street');
    this.clearance=form.querySelector('.road-clearance');
    this.deckControls=form.querySelector('.road-deck');this.deckInput=form.querySelector('.road-deck-height');this.deckSlider=form.querySelector('.road-deck-slider');
    form.querySelector('.road-remove-deck').addEventListener('click',()=>{this.deckHeight=undefined;this.render();});
    this.clearance.addEventListener('click',()=>{
      const points=this.values();if(!points.every(Boolean))return;
      this.elevated=true;this.deckHeight=Math.max(...points.map(p=>p[1]),Math.ceil((REQUIRED_UNDERSIDE-ROAD_DECK_BOTTOM+.1)*10)/10);this.render();
    });
    this.inputs=[0,1].map(i=>fields.map(([name])=>form.elements.namedItem(`${i}-${name}`)));
    this.handles=new RoadHeightHandles(this,form.parentElement);
    this.addPointButton=form.querySelector('.road-add-point');
    this.removePointButton=form.querySelector('.road-remove-point');
    this.pointControls=form.querySelector('.road-point-controls');
    this.pointChoice=form.querySelector('.road-point-choice');
    this.pointHandles=document.createElement('div');
    this.pointHandles.className='parcel-handles road-height-handles';
    form.parentElement.append(this.pointHandles);
    this.addPointButton.addEventListener('click',()=>{this.addingPoint=!this.addingPoint;this.render();});
    this.removePointButton.addEventListener('click',()=>{
      this.via.splice(this.activePoint,1);
      this.bends.splice(this.activePoint,2,0);
      this.activePoint=Math.max(0,Math.min(this.activePoint,this.via.length-1));
      this.render();
    });
    this.redraw.addEventListener('click',()=>this.resetPoints());
    form.addEventListener('input',event=>{
      if(event.target===this.pointChoice)this.activePoint=+this.pointChoice.value;
      if(event.target.dataset.bend){
        const index=this.activePoint+(event.target.dataset.bend==='after'?1:0);
        this.bends[index]=event.target.valueAsNumber;
      }
      if(event.target===this.arcSlider){
        const sweep=Math.round(this.arcSlider.valueAsNumber);
        this.shape='arc';this.setArc(sweep);
      }
      if(event.target===this.deckInput||event.target===this.deckSlider){this.wholeRoute=false;this.deckHeight=event.target.valueAsNumber;}
      const edited=this.inputs.flat().includes(event.target);
      if(edited){this.wholeRoute=false;if(this.inputs.some(row=>row[3]===event.target))this.shape='custom';}
      this.render();
    });
    form.addEventListener('click',event=>{
      const {shape,grade,lift}=event.target.closest('button')?.dataset??{};
      if(lift!==undefined){this.lift(Number(lift));return;}
      if(Object.hasOwn(grades,grade)){
        this.grade=grade;
        if(this.anchor&&grade==='up')this.elevated=true;
        const [start,end]=this.values();
        if(start&&end&&!this.heightLocked(1,end))this.write(1,this.slopeEnd([start,end],this.arcDraft([start,end]).arc));
        this.render();
        return;
      }
      if(shape)this.applyShape(shape);
    });
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if(this.submit.disabled)return;
      const extend=event.submitter===this.continueButton;
      if(extend&&this.continueButton.disabled)return;
      const {points:[start,end],arc}=this.arcDraft(this.values());
      const result=this.app.city.editRoadAlignment(this.raw(start,end,arc),this.id,this.editOptions());
      if(result.error){this.render();this.app.ui.toast(result.error,true);return;}
      this.app.finishRoadEdit(result,extend);
    });
  }
  get active(){return !this.form.hidden;}
  get maxHeight(){return this.elevated?MAX_ELEVATED_ROAD_HEIGHT:MAX_ROAD_HEIGHT;}
  open(entity,{ramp=false,elevated=false,anchor=null,grade='level'}={}){
    this.id=entity?.id;this.ramp=ramp;this.elevated=elevated||!!entity?.alignment.elevated;
    this.arc=entity?.alignment.arc??0;
    this.deckHeight=entity?.alignment.deckHeight;
    this.via=entity?.alignment.via?.map(point=>[...point])??[];
    this.bends=[...(entity?.alignment.bends??[0])];
    this.activePoint=0;
    this.addingPoint=false;
    this.original=entity;this.wholeRoute=false;this.routeDelta=0;this.shape=entity?(this.arc?'arc':'custom'):'auto';
    this.anchor=anchor;this.grade=ramp?'up':grade;this.form.hidden=false;this.precision.open=false;
    this.liftScope.value='segment';this.liftScope.disabled=!entity;
    this.title.textContent=this.elevated?(entity?'调整高架道路':'铺设高架道路'):ramp?'铺设坡道':'道路线形';
    this.heightRule.textContent=`端点高度 0–${this.maxHeight} 米 · 坡度上限 ${MAX_ROAD_GRADE*100}%`;
    this.gradeButtons.hidden=false;this.continueButton.hidden=!!entity;
    this.instructions.textContent=anchor?'已接续原路端点。点选下一段终点，可选上升、水平或下降。'
      :entity?'拖动圆点移动端点，拖动高度标签升降。连接处高度联动，应用后可一次撤销。':'拖出道路或点选两端，再拖动圆点调整位置。高度标签可升降；Shift 暂停吸附。';
    if(!entity){this.resetPoints();return;}
    const {start,end}=entity.alignment;
    this.locks=[null,null];
    for(const port of this.app.city.roadNetwork.segments.get(this.id).ports){
      if(port.end!==undefined)this.locks[port.end]=[start,end][port.end];
    }
    this.write(0,start);this.write(1,end);
    this.render();
  }
  resetPoints(){
    this.wholeRoute=false;this.deckHeight=undefined;this.firstSource=null;
    this.via=[];this.bends=[0];this.activePoint=0;this.addingPoint=false;
    this.locks=[this.anchor,null];
    this.write(0,this.anchor??['',0,'',0]);this.write(1,['',0,'',0]);this.render();
  }
  close(){this.form.hidden=true;this.draw=null;this.cancelHover();this.handles.clear();this.pointHandles.hidden=true;}
  write(index,values){this.inputs[index].forEach((input,i)=>{input.value=values[i];});}
  values(){return this.inputs.map(inputs=>{
    const values=inputs.map(input=>input.valueAsNumber);
    return values.every(Number.isFinite)?values:null;
  });}
  isLocked(index,point){
    if(!point)return false;
    const lock=this.locks[index];
    return !!lock&&lock[0]===point[0]&&lock[2]===point[2];
  }
  heightLocked(index,point){
    if(!this.isLocked(index,point))return false;
    if(this.id==null)return true;
    const port=this.app.city.roadNetwork.segments.get(this.id).ports.find(p=>p.end===index);
    return !this.app.city.entities.get(port?.neighborId)?.alignment;
  }
  editOptions(){return {connected:true,wholeRoute:this.wholeRoute,...(this.wholeRoute?{routeDelta:this.routeDelta}:{}),clearStreet:this.clearStreet.checked};}
  raw(start,end,arc){return {start,end,arc,elevated:this.elevated,...(this.deckHeight!==undefined?{deckHeight:this.deckHeight}:{}),
    ...(this.via.length?{via:this.via,bends:this.bends}:{})};}
  lift(delta){
    let points=this.values();if(!points.every(Boolean))return;
    const wasWhole=this.wholeRoute;this.wholeRoute=this.id!=null&&this.liftScope.value==='route';
    if(this.wholeRoute){
      const original=[this.original.alignment.start,this.original.alignment.end];
      delta=(wasWhole?this.routeDelta:0)+delta;points=original;
    }
    if(!this.wholeRoute&&points.some((p,i)=>this.heightLocked(i,p))){this.app.ui.toast('连接地面的端点保持原高；可调整桥面高度，或选择整条相连道路升降',true);return;}
    const middle=this.wholeRoute?this.original.alignment.via??[]:this.via;
    const heights=[...points.filter((p,i)=>!this.wholeRoute||!this.heightLocked(i,p)),...middle].map(p=>p[1]);
    if(this.deckHeight!==undefined)heights.push(this.wholeRoute?(this.original.alignment.deckHeight??this.deckHeight):this.deckHeight);
    if(!heights.length){this.app.ui.toast('两端都连接地面，可用自动桥坡单独升降桥面');return;}
    const low=-Math.min(...heights),high=32-Math.max(...heights);
    delta=Math.max(low,Math.min(high,delta));
    this.routeDelta=delta;
    this.elevated=true;
    this.via=middle.map(([x,y,z,bearing])=>[x,Math.round((y+delta)*1e6)/1e6,z,bearing]);
    if(this.deckHeight!==undefined)this.deckHeight=(this.wholeRoute?(this.original.alignment.deckHeight??this.deckHeight):this.deckHeight)+delta;
    points.forEach((p,i)=>this.write(i,[p[0],this.wholeRoute&&this.heightLocked(i,p)?p[1]:Math.round((p[1]+delta)*1e6)/1e6,p[2],p[3]]));this.render();
  }
  setArc(sweep){
    const points=this.values();if(!points.every(Boolean))return;
    const locked=points.map((p,i)=>this.isLocked(i,p));
    if(locked.every(Boolean))return;
    this.arc=sweep;
    if(locked.some(Boolean)){
      const index=locked[0]?0:1,anchor=points[index],free=points[1-index];
      const chord=Math.hypot(free[0]-anchor[0],free[2]-anchor[2]);
      const heading=(anchor[3]+(index===0?-sweep/2:sweep/2)+(index===1?180:0))*Math.PI/180;
      this.write(1-index,[anchor[0]+chord*Math.cos(heading),free[1],anchor[2]+chord*Math.sin(heading),free[3]]);
    }
  }
  applyShape(shape){
    let points=this.values();
    this.shape=shape;
    if(!points.every(Boolean)){this.render();return;}
    this.arc=arcs[shape]??0;
    if(this.arc)this.setArc(this.arc);
    if(shape==='straight')this.setArc(0);
    points=this.values();
    const preset=presets[shape];
    if(preset){
      const angle=roadBearing(...points);
      for(const [i,bend] of preset.entries())if(!this.isLocked(i,points[i]))this.inputs[i][3].value=normalBearing(angle+bend);
    }
    this.render();
  }
  arcDraft(points){
    if(this.via.length)return {points,arc:0};
    if(!points.every(Boolean))return {points,arc:0};
    const [start,end]=points,index=points.findIndex((point,i)=>this.isLocked(i,point));
    let arc=this.arc;
    if(this.shape==='auto'){
      if(index<0){const bearing=normalBearing(roadBearing(start,end));return {arc:0,points:points.map(p=>[...p.slice(0,3),bearing])};}
      const sweep=(index===0?2:-2)*signedRoadAngle(points[index][3]-roadBearing(start,end));
      const both=points.every((p,i)=>this.isLocked(i,p));
      if(Math.abs(sweep)<=180&&(!both||Math.abs(signedRoadAngle(arcRoadBearings(start,end,sweep)[1]-end[3]))<1e-6))arc=sweep;
      else return {arc:0,points:points.map((p,i)=>this.isLocked(i,p)?p:[...p.slice(0,3),normalBearing(roadBearing(start,end))])};
    }
    if(Math.abs(arc)<1e-6)return {points,arc:0};
    if(index<0){
      const limit=maxRoadArc(start,end);
      if(limit>0)arc=Math.sign(arc)*Math.min(Math.abs(arc),limit);
    }else{
      const lockedSweep=(index===0?2:-2)*signedRoadAngle(points[index][3]-roadBearing(start,end));
      if(Math.abs(lockedSweep)>180)return {arc:0,points};
      arc=lockedSweep;
    }
    const bearings=arcRoadBearings(start,end,arc);
    return {arc,points:points.map((p,i)=>this.isLocked(i,p)?p:[...p.slice(0,3),bearings[i]])};
  }
  rise(points,arc=0){
    const key=points.map(([x,,z,bearing])=>`${x},${z},${bearing}`).join('/')+`/${arc}`;
    if(this.riseKey!==key){this.riseKey=key;this.maxRise=maxRoadRise(...points,arc);}
    return this.maxRise;
  }
  heightRanges(points,arc){
    const sharedRise=this.via.length?null:this.rise(points,arc);
    return points.map((point,i)=>{
      if(this.heightLocked(i,point))return [this.locks[i][1],this.locks[i][1]];
      const adjacent=this.via.length?(i?this.via.at(-1):this.via[0]):points[1-i];
      const rise=this.via.length?maxRoadRise(...(i?[adjacent,point]:[point,adjacent])):sharedRise;
      if(rise===null)return [0,this.maxHeight];
      const y=adjacent[1];
      const low=Math.max(0,Math.ceil((y-rise-1e-9)*100)/100);
      const high=Math.min(this.maxHeight,Math.floor((y+rise+1e-9)*100)/100);
      let minimum=low,maximum=high;
      if(this.id!=null&&!this.wholeRoute)for(const port of this.app.city.roadNetwork.segments.get(this.id).ports.filter(p=>p.end===i)){
        const neighbor=this.app.city.entities.get(port.neighborId);if(!neighbor?.alignment)continue;
        const a=neighbor.alignment,other= a.start[0]===point[0]&&a.start[2]===point[2]?a.end:a.start;
        const rise=maxRoadRise(a.start,a.end,a.arc);
        minimum=Math.max(minimum,other[1]-rise);maximum=Math.min(maximum,other[1]+rise);
      }
      return minimum<=maximum?[minimum,maximum]:null;
    });
  }
  writeHeight(index,y){
    if(this.inputs[index][1].valueAsNumber===y)return;
    this.wholeRoute=false;this.inputs[index][1].value=y;this.render();
  }
  setHeight(index,y){
    const {points,arc}=this.arcDraft(this.values());
    const range=points.every(Boolean)&&this.heightRanges(points,arc)?.[index];
    if(!range||this.heightLocked(index,points[index]))return;
    this.writeHeight(index,Math.max(range[0],Math.min(range[1],Math.round(y*10)/10)));
  }
  point(x,z,index){
    const radius=24,bounds={minX:x-radius,maxX:x+radius,minZ:z-radius,maxZ:z+radius};
    let closest=null,distance=14,source=null;
    const {camera,canvas,pointer,keys}=this.app,rect=canvas.getBoundingClientRect(),project=new Vector3();
    const cursor=[(pointer.x+1)*rect.width/2,(1-pointer.y)*rect.height/2];
    if(keys.has('shift')||!this.snap.checked)return {point:[x,0,z,0],snapped:false};
    for(const e of this.app.city.queryFootprints(bounds))if(e.type==='road'&&e.id!==this.id){
      const segment=this.app.city.roadNetwork.segments.get(e.id);
      const ends=e.alignment?[e.alignment.start,e.alignment.end]:ROAD_DIRECTIONS.map((_,side)=>gridRoadEnd(segment,side));
      for(const [end,point] of ends.entries()){
        project.set(point[0],point[1],point[2]).project(camera);
        const d=Math.hypot((project.x+1)*rect.width/2-cursor[0],(1-project.y)*rect.height/2-cursor[1]);
        if(d>=distance||segment.ports.some(port=>(e.alignment?port.end:port.side)===end&&port.neighborId!==this.id))continue;
        const [px,y,pz,bearing]=point;
        closest=[px,y,pz,normalBearing(bearing+((e.alignment?end:1)===index?180:0))];distance=d;source=e.alignment?null:e.id;
      }
    }
    return {point:closest??[Math.round(x*10)/10,0,Math.round(z*10)/10,0],snapped:!!closest,source};
  }
  faceConnection(item,target,index){
    // A grid road is selected as a road, rather than forcing the user to hit a
    // two-metre side precisely. Choose the free exit facing the drawn route.
    if(item.source){
      const segment=this.app.city.roadNetwork.segments.get(item.source);
      let best=null,score=Infinity;
      for(let side=0;side<4;side++){
        if(segment.ports.some(p=>p.side===side))continue;
        const p=gridRoadEnd(segment,side),bearing=normalBearing(p[3]+(index?180:0));
        const heading=index?roadBearing(target,p):roadBearing(p,target);
        const angle=Math.abs(signedRoadAngle(bearing-heading));
        if(angle<score){score=angle;best=[...p.slice(0,3),bearing];}
      }
      if(best)item.point=best;
    }
    return item;
  }
  candidate(start,end){
    start={...start,point:[...start.point]};end={...end,point:[...end.point]};
    this.faceConnection(start,end.point,0);this.faceConnection(end,start.point,1);
    this.locks=[start,end].map(item=>item.snapped?item.point:null);
    const angle=normalBearing(roadBearing(start.point,end.point));
    const orient=({point,snapped})=>snapped?point:[...point.slice(0,3),angle];
    let points=[orient(start),orient(end)];
    const draft=this.arcDraft(points);points=draft.points;
    if(!end.snapped){
      points[1]=[points[1][0],start.point[1],...points[1].slice(2)];
      if(this.ramp||this.elevated||this.grade!=='level')points[1]=this.slopeEnd(points,draft.arc);
    }
    return points;
  }
  slopeEnd(points,arc){
    const [start,end]=points,range=this.heightRanges(points,arc)?.[1];
    if(!range)return end;
    const delta=grades[this.grade];
    const target=Math.round((start[1]+delta)*100)/100;
    return [end[0],Math.max(range[0],Math.min(range[1],target)),end[2],end[3]];
  }
  beginDraw(x,z,event){
    const [start,end]=this.values();
    if(!event.isPrimary||this.id!=null||end||(start&&!this.anchor))return;
    const first=this.anchor?{point:this.anchor,snapped:true}:this.point(x,z,0);
    this.draw={x:event.clientX,y:event.clientY,first};
    this.app.canvas.setPointerCapture(event.pointerId);
  }
  cancelDraw(){if(this.draw){this.draw=null;this.render();}}
  finishDraw(x,z){
    if(!this.draw)return;
    const {first}=this.draw;
    this.draw=null;
    this.setEndpoints(first,this.point(x,z,1));
  }
  pointer(x,z,event){
    const [start,end]=this.values();
    if(this.draw&&Math.hypot(event.clientX-this.draw.x,event.clientY-this.draw.y)<7)return;
    if(!this.draw&&(!start||end))return;
    this.pendingHover=[this.draw?.first??{point:start,snapped:this.isLocked(0,start),source:this.firstSource},x,z];
    if(this.hoverFrame)return;
    this.hoverFrame=requestAnimationFrame(()=>{
      this.hoverFrame=null;
      const [first,x,z]=this.pendingHover;
      this.pendingHover=null;
      const locks=this.locks;
      this.render(this.candidate(first,this.point(x,z,1)),true);
      this.locks=locks;
    });
  }
  cancelHover(){if(this.hoverFrame)cancelAnimationFrame(this.hoverFrame);this.hoverFrame=null;this.pendingHover=null;}
  click(x,z){
    const [start,end]=this.values();
    if(start&&end){if(this.addingPoint)this.insertPoint();return;}
    if(!start||end){
      const first=this.point(x,z,0);
      this.firstSource=first.source;
      this.locks=[first.snapped?first.point:null,null];
      this.write(0,first.point);this.write(1,['',0,'',0]);
      this.render();
    }else{
      this.setEndpoints({point:start,snapped:this.isLocked(0,start),source:this.firstSource},this.point(x,z,1));
    }
  }
  setEndpoints(start,end){
    this.locks=[start,end].map(({point,snapped})=>snapped?point:null);
    this.candidate(start,end).forEach((point,i)=>this.write(i,point));
    this.render();
  }
  movePoint(index,clientX,clientY){
    const points=this.values();if(!points.every(Boolean))return;
    const {canvas,pointer,raycaster,camera}=this.app,rect=canvas.getBoundingClientRect();
    pointer.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const point=new Vector3();
    if(!raycaster.ray.intersectPlane(new Plane(new Vector3(0,1,0),-points[index][1]),point))return;
    const target=this.faceConnection(this.point(point.x,point.z,index),points[1-index],index);
    const p=target.snapped?target.point:[target.point[0],points[index][1],target.point[2],points[index][3]];
    this.locks[index]=target.snapped?p:null;this.write(index,p);this.render();
  }
  insertPoint(){
    const geometry=this.previewGeometry;
    if(!geometry?.samples||this.via.length>=MAX_ROAD_POINTS)return;
    const {camera,canvas,pointer}=this.app;
    const samplePosition=new Vector3();
    const points=[this.values()[0],...this.via,this.values()[1]];
    const spans=geometry.spans??[0,geometry.samples.length-1];
    let nearest=null, distance=20;
    for(let span=0;span<spans.length-1;span++){
      for(let i=spans[span]+1;i<spans[span+1];i++){
        const {point,direction}=geometry.samples[i];
        if([points[span],points[span+1]].some(p=>Math.hypot(p[0]-point[0],p[2]-point[2])<6))continue;
        const screen=samplePosition.fromArray(point).project(camera);
        const pixels=Math.hypot((screen.x-pointer.x)*canvas.clientWidth/2,(screen.y-pointer.y)*canvas.clientHeight/2);
        if(pixels>=distance)continue;
        distance=pixels;
        nearest={span,point:[...point,normalBearing(Math.atan2(direction[1],direction[0])*180/Math.PI)]};
      }
    }
    if(!nearest){this.app.ui.toast('请点预览道路上距相邻控制点至少 6 米的位置',true);return;}
    this.activePoint=nearest.span;
    this.via.splice(nearest.span,0,nearest.point);
    this.bends.splice(nearest.span,1,0,0);
    this.addingPoint=false;
    this.render();
  }
  layoutPoints(){
    if(!this.active||this.pointHandles.hidden)return;
    const {camera,canvas}=this.app;
    const rect=canvas.getBoundingClientRect(),projected=new Vector3();
    [...this.pointHandles.children].forEach((button,i)=>{
      const sample=this.previewGeometry?.samples?.[this.previewGeometry.spans?.[i+1]];
      const p=projected.fromArray(sample?.point??this.via[i]).project(camera);
      button.hidden=Math.abs(p.x)>1||Math.abs(p.y)>1||Math.abs(p.z)>1;
      button.style.left=`${rect.left+(1+p.x)*rect.width/2}px`;
      button.style.top=`${rect.top+(1-p.y)*rect.height/2}px`;
    });
  }
  syncPointHandles(){
    if(this.pointHandles.children.length!==this.via.length){
      this.pointHandles.replaceChildren(...this.via.map((_,i)=>{
        const button=document.createElement('button');
        button.type='button';
        button.className='parcel-handle road-position-handle road-middle-handle';
        button.textContent=i+1;
        button.setAttribute('aria-label',`道路中间点 ${i+1}`);
        button.onclick=()=>{this.activePoint=i;this.render();};
        let origin=null;
        button.onpointerdown=event=>{
          if(event.button!==0)return;
          this.activePoint=i;
          origin={point:this.via[i],x:event.clientX,y:event.clientY,height:this.previewGeometry?.samples?.[this.previewGeometry.spans?.[i+1]]?.point[1]??this.via[i][1]};
          button.setPointerCapture(event.pointerId);
          this.render();
        };
        button.onpointermove=event=>{
          if(!origin||Math.hypot(event.clientX-origin.x,event.clientY-origin.y)<3)return;
          const {canvas,camera,raycaster}=this.app,rect=canvas.getBoundingClientRect();
          const mouse={x:(event.clientX-rect.left)/rect.width*2-1,y:1-(event.clientY-rect.top)/rect.height*2};
          raycaster.setFromCamera(mouse,camera);
          const position=new Vector3();
          if(!raycaster.ray.intersectPlane(new Plane(new Vector3(0,1,0),-origin.height),position))return;
          const [start,end]=this.values(),previous=this.via[i-1]??start,next=this.via[i+1]??end;
          const bearing=normalBearing(roadBearing(previous,next));
          this.via[i]=[position.x,origin.point[1],position.z,bearing];
          this.render();
        };
        button.onpointerup=()=>{origin=null;};
        button.onlostpointercapture=()=>{
          if(!origin)return;
          this.via[i]=origin.point;origin=null;this.render();
        };
        return button;
      }));
      this.pointChoice.replaceChildren(...this.via.map((_,i)=>new Option(`第 ${i+1} 点`,i)));
    }
    this.pointChoice.value=this.activePoint;
    [...this.pointHandles.children].forEach((button,i)=>button.setAttribute('aria-pressed',String(i===this.activePoint)));
    this.layoutPoints();
  }
  render(values=this.values(),hover=false){
    if(!hover)this.cancelHover();
    const {points:[start,end],arc}=this.arcDraft(values);
    if(!hover)for(const [i,point] of [start,end].entries()){
      const connected=this.id!=null&&this.locks[i];
      for(const field of [0,2])this.inputs[i][field].readOnly=!!connected;
      this.inputs[i][3].readOnly=!!arc||!!connected;
      if(point)this.inputs[i][3].value=point[3];
    }
    const plan=start&&end?this.app.city.planRoadAlignment(this.raw(start,end,arc),this.id,this.editOptions()):null;
    const profiles=plan?.changes?.filter(c=>c.after).map(c=>alignmentGeometry(c.after.alignment).samples).filter(Boolean);
    const fallback=start&&end?[start,...this.via,end].map(point=>({point:point.slice(0,3),direction:[1,0]})):null;
    this.app.world.showRoadPreviews(profiles?.length?profiles:plan?.geometry?.samples?[plan.geometry.samples]:fallback?[fallback]:[],plan?.error,this.id,[...plan?.obstacles??[],...plan?.removed??[]]);
    this.submit.disabled=hover||!plan||!!plan.error;
    this.continueButton.disabled=this.submit.disabled||this.isLocked(1,end);
    this.feedback.classList.toggle('invalid',!!plan?.error);
    const geometry=plan?.geometry;
    this.previewGeometry=geometry;
    const length=start&&end?Math.hypot(end[0]-start[0],end[2]-start[2]):0;
    const measurements=geometry?.samples?[
      `端点间距 ${length.toFixed(1)} 米`,`高差 ${(end[1]-start[1]).toFixed(2)} 米`,`最大坡度 ${(geometry.maxGrade*100).toFixed(1)}%`,
      Number.isFinite(geometry.minRadius)?`${arc?'圆弧半径':'最小半径'} ${geometry.minRadius.toFixed(1)} 米`:'',
      plan.structure?.bottomY!=null?`水面净空 ${(plan.structure.bottomY-WATER_Y).toFixed(2)} 米`:'',
    ]:[];
    const message=this.addingPoint?'点击预览道路放置中间点':plan?plan.error:start?'请选择终点':'请拖出道路或点选起点';
    const roadCount=plan?.changes?.filter(c=>c.after).length;
    this.feedback.textContent=[message,...measurements,roadCount>1?`联动调整 ${roadCount} 段道路，保持连接`:null,plan?.removed?.length?`将清理 ${plan.removed.length} 个小径或街景，可一起撤销`:null].filter(Boolean).join(' · ');
    this.heightRule.textContent=`端点高度 0–${this.maxHeight} 米 · 坡度上限 ${MAX_ROAD_GRADE*100}%${this.deckHeight!==undefined?' · 桥坡随桥高自动延长':''}`;
    this.deckControls.hidden=this.deckHeight===undefined;
    this.deckInput.disabled=this.deckSlider.disabled=this.deckHeight===undefined;
    if(this.deckHeight!==undefined){this.deckInput.value=this.deckHeight;this.deckSlider.value=this.deckHeight;}
    const points=start&&end?[start,end]:null;
    const ranges=points&&this.heightRanges(points,arc);
    this.rangeText.textContent=ranges?.map((range,i)=>{
      const name=i?'终点':'起点';
      if(!range)return `${name}超出高度范围`;
      if(this.heightLocked(i,points[i]))return `${name}接路 ${range[0].toFixed(2)} 米`;
      return `${name}可调 ${range[0].toFixed(2)}–${range[1].toFixed(2)} 米`;
    }).join(' · ')??'';
    this.handles.set(!hover?points:null,points?.map((p,i)=>this.heightLocked(i,p)),points?.map((p,i)=>this.id!=null?this.isLocked(i,p):!!this.anchor&&i===0));
    this.redraw.hidden=hover||this.id!=null||!start;
    this.arcControls.hidden=hover||!points||!!this.via.length;
    this.addPointButton.disabled=hover||!geometry?.samples||this.via.length>=MAX_ROAD_POINTS;
    this.addPointButton.setAttribute('aria-pressed',String(this.addingPoint));
    this.removePointButton.hidden=this.pointControls.hidden=this.pointHandles.hidden=!this.via.length||hover;
    this.syncPointHandles();
    for(const slider of this.pointControls.querySelectorAll('[data-bend]')){
      const bend=this.bends[this.activePoint+(slider.dataset.bend==='after'?1:0)]??0;
      slider.value=bend;
      slider.previousElementSibling.value=`${bend}°`;
    }
    if(points&&!hover){
      const limit=Math.floor(maxRoadArc(start,end)+1e-8);
      const locked=points.every((p,i)=>this.isLocked(i,p));
      this.arcSlider.min=-limit;this.arcSlider.max=limit;this.arcSlider.value=arc;
      this.arcSlider.disabled=locked||!limit;
      this.arcLabel.textContent=arc?`${arc>0?'左':'右'} ${Number(Math.abs(arc).toFixed(1))}°`:'';
      this.arcHint.textContent=locked?'两端接路，方向随原路保持。':'拖动调整弯曲；已接路时自动移动自由端，保持相切。';
    }
    for(const button of this.gradeButtons.querySelectorAll('button')){
      button.setAttribute('aria-pressed',String(button.dataset.grade===this.grade));
      button.disabled=!!end&&this.heightLocked(1,end);
    }
    for(const button of this.form.querySelectorAll('[data-shape]')){
      button.parentElement.hidden=!!this.via.length;
      button.setAttribute('aria-pressed',String(button.dataset.shape===this.shape));
    }
    for(const button of this.form.querySelectorAll('[data-lift],.road-clearance'))button.disabled=!points;
  }
}
