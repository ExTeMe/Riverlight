import { normalBearing, roadBearing } from './road-alignment.js';

const fields=[['x','X 坐标（米）'],['y','高度（米）'],['z','Z 坐标（米）'],['bearing','方向（°）']];
const presets={straight:[0,0],left:[30,-30],right:[-30,30],s:[30,30]};

export class RoadEditor {
  constructor(app,form){
    this.app=app;this.form=form;
    form.innerHTML=`<h3>道路线形</h3><p class="parcel-instructions">点选起点和终点，或直接输入米制坐标。0° 指向 +X，90° 指向 +Z。</p>
      <div class="parcel-scroll">
        ${['起点','终点'].map((title,i)=>`<fieldset><legend>${title}</legend><div class="parcel-fields">${fields.map(([name,label])=>
          `<label>${title} ${label}<input type="number" step="any" name="${i}-${name}"></label>`).join('')}</div></fieldset>`).join('')}
        <div class="scene-buttons" aria-label="道路形状">${[['straight','直线'],['left','左弯'],['right','右弯'],['s','S 弯']].map(([id,name])=>
          `<button type="button" data-shape="${id}">${name}</button>`).join('')}</div>
        <p class="parcel-feedback" role="status" aria-live="polite"></p>
      </div><div class="parcel-actions"><button type="button" data-action="select">取消</button><button class="primary" type="submit">应用道路</button></div>`;
    this.feedback=form.querySelector('.parcel-feedback');this.submit=form.querySelector('[type=submit]');
    this.inputs=[0,1].map(i=>fields.map(([name])=>form.elements.namedItem(`${i}-${name}`)));
    form.addEventListener('input',()=>this.render());
    form.addEventListener('click',event=>{
      const preset=presets[event.target.closest('button')?.dataset.shape];
      if(!preset)return;
      const [start,end]=this.values();
      if(!start||!end)return;
      const angle=roadBearing(start,end);
      for(const [i,bend] of preset.entries())this.inputs[i][3].value=normalBearing(angle+bend);
      this.render();
    });
    form.addEventListener('submit',event=>{
      event.preventDefault();
      const [start,end]=this.values(),result=this.app.city.editRoadAlignment({start,end},this.id);
      if(result.error){this.render();return;}
      this.app.finishRoadEdit(result);
    });
  }
  get active(){return !this.form.hidden;}
  open(entity){
    this.id=entity?.id;this.startSnapped=false;this.form.hidden=false;
    this.write(0,entity?.alignment.start??['',0,'',0]);
    this.write(1,entity?.alignment.end??['',0,'',0]);
    this.render();
  }
  close(){this.form.hidden=true;}
  write(index,values){this.inputs[index].forEach((input,i)=>{input.value=values[i];});}
  values(){return this.inputs.map(inputs=>{
    const values=inputs.map(input=>input.valueAsNumber);
    return values.every(Number.isFinite)?values:null;
  });}
  point(x,z,index){
    const radius=1.5,bounds={minX:x-radius,maxX:x+radius,minZ:z-radius,maxZ:z+radius};
    let closest=null,distance=radius;
    for(const e of this.app.city.queryFootprints(bounds))if(e.alignment&&e.id!==this.id){
      const segment=this.app.city.roadNetwork.segments.get(e.id);
      for(const [end,point] of [e.alignment.start,e.alignment.end].entries()){
        const d=Math.hypot(point[0]-x,point[2]-z);
        if(d>=distance||segment.ports.some(port=>port.end===end&&port.neighborId!==this.id))continue;
        const [px,y,pz,bearing]=point;
        closest=[px,y,pz,normalBearing(bearing+(end===index?180:0))];distance=d;
      }
    }
    return {point:closest??[Math.round(x*2)/2,0,Math.round(z*2)/2,0],snapped:!!closest};
  }
  candidate(start,end){
    const angle=normalBearing(roadBearing(start.point,end.point));
    const orient=({point,snapped})=>snapped?point:[...point.slice(0,3),angle];
    return [orient(start),orient(end)];
  }
  pointer(x,z){
    const [start,end]=this.values();
    if(!start||end)return;
    this.render(this.candidate({point:start,snapped:this.startSnapped},this.point(x,z,1)),true);
  }
  click(x,z){
    const [start,end]=this.values();
    if(!start||end){
      const first=this.point(x,z,0);this.startSnapped=first.snapped;this.write(0,first.point);this.write(1,['',0,'',0]);
    }else{
      const next=this.point(x,z,1),points=this.candidate({point:start,snapped:this.startSnapped},next);
      points.forEach((point,i)=>this.write(i,point));
    }
    this.render();
  }
  render([start,end]=this.values(),hover=false){
    const plan=start&&end?this.app.city.planRoadAlignment({start,end},this.id):null;
    this.app.world.showRoadPreview(plan?.geometry,plan?.error);
    this.submit.disabled=hover||!plan||!!plan.error;
    this.feedback.classList.toggle('invalid',!!plan?.error);
    const geometry=plan?.geometry;
    const measurements=geometry?.samples?`最小半径 ${Number.isFinite(geometry.minRadius)?`${geometry.minRadius.toFixed(1)} 米`:'∞'} · 最大坡度 ${(geometry.maxGrade*100).toFixed(1)}%` : '';
    const message=plan?plan.error:start?'请点选终点或填写终点坐标':'请点选起点或填写起点坐标';
    this.feedback.textContent=[message,measurements].filter(Boolean).join(' · ');
    for(const button of this.form.querySelectorAll('[data-shape]'))button.disabled=hover||!start||!end;
  }
}
