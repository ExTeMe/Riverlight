import { MAX_ELEVATED_ROAD_HEIGHT, MAX_ROAD_GRADE, MAX_ROAD_HEIGHT, arcRoadBearings, maxRoadArc, maxRoadRise, normalBearing, roadBearing, signedRoadAngle } from './road-alignment.js';
import { WATER_Y } from './river.js';
import { RoadHeightHandles } from './road-height-handles.js';
import { gridRoadEnd, ROAD_DIRECTIONS } from './road-network.js';

const fields=[['x','X 坐标（米）'],['y','高度（米）'],['z','Z 坐标（米）'],['bearing','方向（°）']];
const presets={straight:[0,0],s:[30,30]};
const arcs={left:60,right:-60};
const grades={up:2,level:0,down:-2};

export class RoadEditor {
  constructor(app,form){
    this.app=app;this.form=form;
    form.innerHTML=`<h3>道路线形</h3><p class="parcel-instructions road-instructions"></p>
      <div class="parcel-scroll">
        <div class="scene-buttons road-grades" aria-label="高架走势" hidden>
          <button type="button" data-grade="up">上升</button><button type="button" data-grade="level">水平</button><button type="button" data-grade="down">下降</button>
        </div>
        <div class="road-height-info">
          <p class="road-height-rule"></p>
          <p class="road-height-range"></p>
        </div>
        <p class="parcel-feedback" role="status" aria-live="polite"></p>
        <div class="scene-buttons" aria-label="道路形状">${[['straight','直线'],['left','左圆弧'],['right','右圆弧'],['s','S 弯']].map(([id,name])=>
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
    this.inputs=[0,1].map(i=>fields.map(([name])=>form.elements.namedItem(`${i}-${name}`)));
    this.handles=new RoadHeightHandles(this,form.parentElement);
    this.redraw.addEventListener('click',()=>this.resetPoints());
    form.addEventListener('input',event=>{
      if(event.target===this.arcSlider){
        const sweep=Math.round(this.arcSlider.valueAsNumber);
        if(!sweep){this.applyShape('straight');return;}
        this.arc=sweep;
      }
      this.render();
    });
    form.addEventListener('click',event=>{
      const {shape,grade}=event.target.closest('button')?.dataset??{};
      if(Object.hasOwn(grades,grade)){
        this.grade=grade;
        const [start,end]=this.values();
        if(start&&end&&!this.isLocked(1,end))this.write(1,this.slopeEnd([start,end],this.arcDraft([start,end]).arc));
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
      const result=this.app.city.editRoadAlignment({start,end,arc,elevated:this.elevated},this.id);
      if(result.error){this.render();this.app.ui.toast(result.error,true);return;}
      this.app.finishRoadEdit(result,extend);
    });
  }
  get active(){return !this.form.hidden;}
  get maxHeight(){return this.elevated?MAX_ELEVATED_ROAD_HEIGHT:MAX_ROAD_HEIGHT;}
  open(entity,{ramp=false,elevated=false,anchor=null,grade='up'}={}){
    this.id=entity?.id;this.ramp=ramp;this.elevated=elevated||!!entity?.alignment.elevated;
    this.arc=entity?.alignment.arc??0;
    this.anchor=anchor;this.grade=grade;this.form.hidden=false;this.precision.open=!!entity||(!ramp&&!this.elevated);
    this.title.textContent=this.elevated?(entity?'调整高架道路':'铺设高架道路'):ramp?'铺设坡道':'道路线形';
    this.heightRule.textContent=`端点高度 0–${this.maxHeight} 米 · 坡度上限 ${MAX_ROAD_GRADE*100}%`;
    this.gradeButtons.hidden=!this.elevated;this.continueButton.hidden=!this.elevated||!!entity;
    this.instructions.textContent=anchor?'已接续原路端点。点选下一段终点，可选上升、水平或下降。'
      :entity?'拖动地图上的高度手柄，或在精细调整中输入坐标与高度。':'拖出一段道路，或依次点选两端。拖动地图上的高度手柄来升降端点。';
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
    this.arc=0;
    this.locks=[this.anchor,null];
    this.write(0,this.anchor??['',0,'',0]);this.write(1,['',0,'',0]);this.render();
  }
  close(){this.form.hidden=true;this.draw=null;this.cancelHover();this.handles.clear();}
  write(index,values){this.inputs[index].forEach((input,i)=>{input.value=values[i];});}
  values(){return this.inputs.map(inputs=>{
    const values=inputs.map(input=>input.valueAsNumber);
    return values.every(Number.isFinite)?values:null;
  });}
  isLocked(index,point){
    const lock=this.locks[index];
    return !!lock&&lock[0]===point[0]&&lock[2]===point[2];
  }
  applyShape(shape){
    const points=this.values();
    if(!points.every(Boolean))return;
    this.arc=arcs[shape]??0;
    const preset=presets[shape];
    if(preset){
      const angle=roadBearing(...points);
      for(const [i,bend] of preset.entries())if(!this.isLocked(i,points[i]))this.inputs[i][3].value=normalBearing(angle+bend);
    }
    this.render();
  }
  arcDraft(points){
    if(!this.arc||!points.every(Boolean))return {points,arc:0};
    const [start,end]=points,index=points.findIndex((point,i)=>this.isLocked(i,point));
    let arc=this.arc;
    if(index<0){
      const limit=maxRoadArc(start,end);
      if(limit>0)arc=Math.sign(arc)*Math.min(Math.abs(arc),limit);
    }else{
      const lockedSweep=(index===0?2:-2)*signedRoadAngle(points[index][3]-roadBearing(start,end));
      if(Math.abs(lockedSweep)>1e-8)arc=lockedSweep;
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
    const rise=this.rise(points,arc);
    if(rise===null)return null;
    return points.map((point,i)=>{
      if(this.isLocked(i,point))return [this.locks[i][1],this.locks[i][1]];
      const y=points[1-i][1];
      const low=Math.max(0,Math.ceil((y-rise-1e-9)*100)/100);
      const high=Math.min(this.maxHeight,Math.floor((y+rise+1e-9)*100)/100);
      return low<=high?[low,high]:null;
    });
  }
  writeHeight(index,y){
    if(this.inputs[index][1].valueAsNumber===y)return;
    this.inputs[index][1].value=y;this.render();
  }
  setHeight(index,y){
    const {points,arc}=this.arcDraft(this.values());
    const range=points.every(Boolean)&&this.heightRanges(points,arc)?.[index];
    if(!range||this.isLocked(index,points[index]))return;
    this.writeHeight(index,Math.max(range[0],Math.min(range[1],Math.round(y*10)/10)));
  }
  point(x,z,index){
    const radius=1.5,bounds={minX:x-radius,maxX:x+radius,minZ:z-radius,maxZ:z+radius};
    let closest=null,distance=radius;
    for(const e of this.app.city.queryFootprints(bounds))if(e.type==='road'&&e.id!==this.id){
      const segment=this.app.city.roadNetwork.segments.get(e.id);
      const ends=e.alignment?[e.alignment.start,e.alignment.end]:ROAD_DIRECTIONS.map((_,side)=>gridRoadEnd(segment,side));
      for(const [end,point] of ends.entries()){
        const d=Math.hypot(point[0]-x,point[2]-z);
        if(d>=distance||segment.ports.some(port=>(e.alignment?port.end:port.side)===end&&port.neighborId!==this.id))continue;
        const [px,y,pz,bearing]=point;
        closest=[px,y,pz,normalBearing(bearing+((e.alignment?end:1)===index?180:0))];distance=d;
      }
    }
    return {point:closest??[Math.round(x*2)/2,0,Math.round(z*2)/2,0],snapped:!!closest};
  }
  candidate(start,end){
    const angle=normalBearing(roadBearing(start.point,end.point));
    const orient=({point,snapped})=>snapped?point:[...point.slice(0,3),angle];
    const points=[orient(start),orient(end)];
    if((this.ramp||this.elevated)&&!end.snapped)points[1]=this.slopeEnd(points);
    return points;
  }
  slopeEnd(points,arc){
    const [start,end]=points,range=this.heightRanges(points,arc)?.[1];
    if(!range)return end;
    const delta=this.elevated?grades[this.grade]:start[1]===this.maxHeight?-2:2;
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
    this.pendingHover=[this.draw?.first??{point:start,snapped:this.isLocked(0,start)},x,z];
    if(this.hoverFrame)return;
    this.hoverFrame=requestAnimationFrame(()=>{
      this.hoverFrame=null;
      const [first,x,z]=this.pendingHover;
      this.pendingHover=null;
      this.render(this.candidate(first,this.point(x,z,1)),true);
    });
  }
  cancelHover(){if(this.hoverFrame)cancelAnimationFrame(this.hoverFrame);this.hoverFrame=null;this.pendingHover=null;}
  click(x,z){
    const [start,end]=this.values();
    if(end&&this.id==null)return;
    if(!start||end){
      this.arc=0;
      const first=this.point(x,z,0);
      this.locks=[first.snapped?first.point:null,null];
      this.write(0,first.point);this.write(1,['',0,'',0]);
      this.render();
    }else{
      this.setEndpoints({point:start,snapped:this.isLocked(0,start)},this.point(x,z,1));
    }
  }
  setEndpoints(start,end){
    this.locks=[start,end].map(({point,snapped})=>snapped?point:null);
    this.candidate(start,end).forEach((point,i)=>this.write(i,point));
    this.render();
  }
  render(values=this.values(),hover=false){
    if(!hover)this.cancelHover();
    const {points:[start,end],arc}=this.arcDraft(values);
    if(!hover)for(const [i,point] of [start,end].entries()){
      this.inputs[i][3].readOnly=!!arc;
      if(arc&&point)this.inputs[i][3].value=point[3];
    }
    const plan=start&&end?this.app.city.planRoadAlignment({start,end,arc,elevated:this.elevated},this.id):null;
    this.app.world.showRoadPreview(plan?.geometry,plan?.error,this.id);
    this.submit.disabled=hover||!plan||!!plan.error;
    this.continueButton.disabled=this.submit.disabled||this.isLocked(1,end);
    this.feedback.classList.toggle('invalid',!!plan?.error);
    const geometry=plan?.geometry;
    const length=start&&end?Math.hypot(end[0]-start[0],end[2]-start[2]):0;
    const measurements=geometry?.samples?[
      `端点间距 ${length.toFixed(1)} 米`,`高差 ${(end[1]-start[1]).toFixed(2)} 米`,`最大坡度 ${(geometry.maxGrade*100).toFixed(1)}%`,
      Number.isFinite(geometry.minRadius)?`${arc?'圆弧半径':'最小半径'} ${geometry.minRadius.toFixed(1)} 米`:'',
      plan.structure?.bottomY!=null?`水面净空 ${(plan.structure.bottomY-WATER_Y).toFixed(2)} 米`:'',
    ]:[];
    const message=plan?plan.error:start?'请选择终点':'请拖出道路或点选起点';
    this.feedback.textContent=[message,...measurements].filter(Boolean).join(' · ');
    const points=start&&end?[start,end]:null;
    const ranges=points&&this.heightRanges(points,arc);
    this.rangeText.textContent=ranges?.map((range,i)=>{
      const name=i?'终点':'起点';
      if(!range)return `${name}超出高度范围`;
      if(this.isLocked(i,points[i]))return `${name}接路 ${range[0].toFixed(2)} 米`;
      return `${name}可调 ${range[0].toFixed(2)}–${range[1].toFixed(2)} 米`;
    }).join(' · ')??'';
    this.handles.set(!hover&&ranges?points:null,ranges?.map((range,i)=>!range||this.isLocked(i,points[i])));
    this.redraw.hidden=hover||this.id!=null||!start;
    this.arcControls.hidden=hover||!points;
    if(points&&!hover){
      const limit=Math.floor(maxRoadArc(start,end)+1e-8);
      const locked=points.some((p,i)=>this.isLocked(i,p));
      this.arcSlider.min=-limit;this.arcSlider.max=limit;this.arcSlider.value=arc;
      this.arcSlider.disabled=locked||!limit;
      this.arcLabel.textContent=arc?`${arc>0?'左':'右'} ${Number(Math.abs(arc).toFixed(1))}°`:'';
      this.arcHint.textContent=locked?'接路方向固定圆弧。可在精细调整中移动另一端。':'拖动可改变转角与半径。';
    }
    for(const button of this.gradeButtons.querySelectorAll('button')){
      button.setAttribute('aria-pressed',String(button.dataset.grade===this.grade));
      button.disabled=!!end&&this.isLocked(1,end);
    }
    for(const button of this.form.querySelectorAll('[data-shape]'))button.disabled=hover||!start||!end;
  }
}
