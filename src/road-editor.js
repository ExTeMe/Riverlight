import { MAX_ROAD_GRADE, MAX_ROAD_HEIGHT, maxRoadRise, normalBearing, roadBearing } from './road-alignment.js';
import { RoadHeightHandles } from './road-height-handles.js';
import { gridRoadEnd, ROAD_DIRECTIONS } from './road-network.js';

const fields=[['x','X 坐标（米）'],['y','高度（米）'],['z','Z 坐标（米）'],['bearing','方向（°）']];
const presets={straight:[0,0],left:[30,-30],right:[-30,30],s:[30,30]};

export class RoadEditor {
  constructor(app,form){
    this.app=app;this.form=form;
    form.innerHTML=`<h3>道路线形</h3><p class="parcel-instructions road-instructions"></p>
      <div class="parcel-scroll">
        <div class="road-height-info">
          <p class="road-height-rule">端点高度 0–${MAX_ROAD_HEIGHT} 米 · 坡度上限 ${MAX_ROAD_GRADE*100}%</p>
          <p class="road-height-range"></p>
        </div>
        <p class="parcel-feedback" role="status" aria-live="polite"></p>
        <details class="road-precision"><summary>精细调整</summary>
        <p class="parcel-instructions">方向 0° 指向 +X，90° 指向 +Z。</p>
        ${['起点','终点'].map((title,i)=>`<fieldset><legend>${title}</legend><div class="parcel-fields">${fields.map(([name,label])=>
          `<label>${title} ${label}<input type="number" step="any" name="${i}-${name}"></label>`).join('')}</div></fieldset>`).join('')}
        <div class="scene-buttons" aria-label="道路形状">${[['straight','直线'],['left','左弯'],['right','右弯'],['s','S 弯']].map(([id,name])=>
          `<button type="button" data-shape="${id}">${name}</button>`).join('')}</div>
        </details>
      </div><div class="parcel-actions"><button type="button" data-action="select">取消</button><button type="button" class="road-redraw" hidden>重画端点</button><button class="primary" type="submit">应用道路</button></div>`;
    this.feedback=form.querySelector('.parcel-feedback');this.submit=form.querySelector('[type=submit]');
    this.title=form.querySelector('h3');this.instructions=form.querySelector('.road-instructions');this.rangeText=form.querySelector('.road-height-range');
    this.precision=form.querySelector('.road-precision');this.redraw=form.querySelector('.road-redraw');
    this.inputs=[0,1].map(i=>fields.map(([name])=>form.elements.namedItem(`${i}-${name}`)));
    this.handles=new RoadHeightHandles(this,form.parentElement);
    this.redraw.addEventListener('click',()=>this.resetPoints());
    form.addEventListener('input',()=>this.render());
    form.addEventListener('click',event=>{
      const preset=presets[event.target.closest('button')?.dataset.shape];
      if(!preset)return;
      const [start,end]=this.values();
      if(!start||!end)return;
      const angle=roadBearing(start,end);
      for(const [i,bend] of preset.entries())if(!this.isLocked(i,[start,end][i]))this.inputs[i][3].value=normalBearing(angle+bend);
      this.render();
    });
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if(this.submit.disabled)return;
      const [start,end]=this.values(),result=this.app.city.editRoadAlignment({start,end},this.id);
      if(result.error){this.render();this.app.ui.toast(result.error,true);return;}
      this.app.finishRoadEdit(result);
    });
  }
  get active(){return !this.form.hidden;}
  open(entity,ramp){
    this.id=entity?.id;this.ramp=ramp;this.form.hidden=false;this.precision.open=!ramp;
    this.title.textContent=ramp?'铺设坡道':'道路线形';
    this.instructions.textContent=entity?'拖动地图上的高度手柄，或在精细调整中输入坐标与高度。':'拖出一段道路，或依次点选两端。拖动地图上的高度手柄来升降端点。';
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
    this.locks=[null,null];
    this.write(0,['',0,'',0]);this.write(1,['',0,'',0]);this.render();
  }
  close(){this.form.hidden=true;this.draw=null;this.handles.clear();}
  write(index,values){this.inputs[index].forEach((input,i)=>{input.value=values[i];});}
  values(){return this.inputs.map(inputs=>{
    const values=inputs.map(input=>input.valueAsNumber);
    return values.every(Number.isFinite)?values:null;
  });}
  isLocked(index,point){
    const lock=this.locks[index];
    return !!lock&&lock[0]===point[0]&&lock[2]===point[2];
  }
  rise(points){
    const key=points.map(([x,,z,bearing])=>`${x},${z},${bearing}`).join('/');
    if(this.riseKey!==key){this.riseKey=key;this.maxRise=maxRoadRise(...points);}
    return this.maxRise;
  }
  heightRanges(points){
    const rise=this.rise(points);
    if(rise===null)return null;
    return points.map((point,i)=>{
      if(this.isLocked(i,point))return [this.locks[i][1],this.locks[i][1]];
      const y=points[1-i][1];
      const low=Math.max(0,Math.ceil((y-rise-1e-9)*100)/100);
      const high=Math.min(MAX_ROAD_HEIGHT,Math.floor((y+rise+1e-9)*100)/100);
      return low<=high?[low,high]:null;
    });
  }
  writeHeight(index,y){
    if(this.inputs[index][1].valueAsNumber===y)return;
    this.inputs[index][1].value=y;this.render();
  }
  setHeight(index,y){
    const points=this.values();
    const range=points.every(Boolean)&&this.heightRanges(points)?.[index];
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
    if(this.ramp&&!end.snapped){
      const rise=this.rise(points);
      if(rise!==null){
        const y=points[0][1],delta=Math.min(2,rise);
        const target=y===MAX_ROAD_HEIGHT?y-delta:Math.min(MAX_ROAD_HEIGHT,y+delta);
        points[1][1]=Math.floor((target+1e-9)*100)/100;
      }
    }
    return points;
  }
  beginDraw(x,z,event){
    if(!event.isPrimary||this.id!=null||this.values()[0])return;
    this.draw={x:event.clientX,y:event.clientY,first:this.point(x,z,0)};
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
    if(this.draw){
      if(Math.hypot(event.clientX-this.draw.x,event.clientY-this.draw.y)>=7){
        this.render(this.candidate(this.draw.first,this.point(x,z,1)),true);
      }
      return;
    }
    const [start,end]=this.values();
    if(!start||end)return;
    this.render(this.candidate({point:start,snapped:this.isLocked(0,start)},this.point(x,z,1)),true);
  }
  click(x,z){
    const [start,end]=this.values();
    if(end&&this.ramp)return;
    if(!start||end){
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
  render([start,end]=this.values(),hover=false){
    const plan=start&&end?this.app.city.planRoadAlignment({start,end},this.id):null;
    this.app.world.showRoadPreview(plan?.geometry,plan?.error);
    this.submit.disabled=hover||!plan||!!plan.error;
    this.feedback.classList.toggle('invalid',!!plan?.error);
    const geometry=plan?.geometry;
    const length=start&&end?Math.hypot(end[0]-start[0],end[2]-start[2]):0;
    const measurements=geometry?.samples?[
      `端点间距 ${length.toFixed(1)} 米`,`高差 ${(end[1]-start[1]).toFixed(2)} 米`,`最大坡度 ${(geometry.maxGrade*100).toFixed(1)}%`,
      Number.isFinite(geometry.minRadius)?`最小半径 ${geometry.minRadius.toFixed(1)} 米`:'',
    ]:[];
    const message=plan?plan.error:start?'请选择终点':'请拖出道路或点选起点';
    this.feedback.textContent=[message,...measurements].filter(Boolean).join(' · ');
    const points=start&&end?[start,end]:null;
    const ranges=points&&this.heightRanges(points);
    this.rangeText.textContent=ranges?.map((range,i)=>{
      const name=i?'终点':'起点';
      if(!range)return `${name}超出高度范围`;
      if(this.isLocked(i,points[i]))return `${name}接路 ${range[0].toFixed(2)} 米`;
      return `${name}可调 ${range[0].toFixed(2)}–${range[1].toFixed(2)} 米`;
    }).join(' · ')??'';
    this.handles.set(!hover&&ranges?points:null,ranges?.map((range,i)=>!range||this.isLocked(i,points[i])));
    this.redraw.hidden=hover||this.id!=null||!start;
    for(const button of this.form.querySelectorAll('[data-shape]'))button.disabled=hover||!start||!end;
  }
}
