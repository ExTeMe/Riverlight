import { BY_ID, CELL } from './catalog.js';
import { normalAngle, PARCEL_EDGES, parcelLocal, resizeParcelEdge } from './parcel.js';
import { ParcelHandles } from './parcel-handles.js';
import { frontageSuggestion } from './riverfront-study.js';

const snap=(value,step)=>step?Math.round(value/step)*step:value;
const field=(name,label)=>`<label>${label}<input type="number" name="${name}" step="any" required></label>`;
const newId=()=>`lot-${crypto.randomUUID()}`;

export class ParcelEditor {
  constructor(app,root){
    this.app=app;
    this.form=root.querySelector('.parcel-editor');
    this.form.innerHTML=`
      <h3></h3><p class="parcel-instructions"></p>
      <div class="parcel-scroll">
      <div class="parcel-settings">
        <label>位置吸附<select name="snap" aria-label="位置吸附"><option value="0.5">0.5 米</option><option value="0.25">0.25 米</option><option value="0">自由</option></select></label>
        <label class="angle-snap"><input type="checkbox" name="angleSnap" checked> 15° 角度吸附</label>
      </div>
      <fieldset data-edit="lot"><legend>地块（米）</legend><div class="parcel-fields">
        ${field('x','中心 X')}${field('z','中心 Z')}${field('width','宽度')}${field('depth','进深')}${field('angle','地块角度 °')}
      </div></fieldset>
      <fieldset data-edit="building"><legend>建筑相对地块</legend><div class="parcel-fields">
        ${field('offsetX','局部 X（米）')}${field('offsetZ','局部 Z（米）')}${field('relative','相对角度 °')}
      </div></fieldset>
      <fieldset data-edit="frontage" hidden><legend>沿街入口</legend>
        <div class="parcel-actions"><button type="button" data-frontage="pick">选路侧</button><button type="button" data-frontage="apply">采用建议</button></div>
      </fieldset>
      </div>
      <p class="parcel-feedback" aria-live="polite"></p>
      <div class="parcel-actions"><button type="button" data-action="cancel-parcel">取消</button><button type="submit" class="primary">确认</button></div>`;
    this.form.addEventListener('input',event=>{
      const name=event.target.name;
      if(['x','z'].includes(name))this.follow=false;
      if(['x','z','width','depth'].includes(name))this.corner=null;
      this.dirty.add(name);this.render();
    });
    this.form.addEventListener('focusin',()=>this.app.keys.clear());
    this.form.addEventListener('submit',event=>{event.preventDefault();this.apply();});
    this.form.querySelector('[data-frontage=pick]').addEventListener('click',()=>{
      this.pickRoad=!this.pickRoad;this.render();
    });
    this.form.querySelector('[data-frontage=apply]').addEventListener('click',()=>{
      if(!this.suggestion)return;
      this.set('angle',this.suggestion.angle);this.set('relative',0);this.pickRoad=false;this.render();
    });
    this.handles=new ParcelHandles(this,root);
  }
  get active(){return !this.form.hidden;}
  get(name){return this.form.elements.namedItem(name);}
  get step(){return Number(this.get('snap').value);}
  get angleStep(){return this.get('angleSnap').checked?15:0;}
  set(name,value){this.get(name).value=value;this.dirty.delete(name);}
  position(x,z){this.set('x',snap(x,this.step));this.set('z',snap(z,this.step));}
  open({mode,parcel,entity,copy=false,type=entity?.type,color=entity?.color??0}){
    this.mode=mode;this.type=type;this.color=color;this.dirty=new Set();this.corner=null;this.follow=mode==='quick'&&!parcel;
    this.roadHint=null;this.pickRoad=false;
    this.form.hidden=false;
    const target=this.app.controls.target,item=BY_ID[type];
    const template=copy?entity.pose.parcel:null;
    const p=parcel??{id:newId(),x:snap(target.x,this.step),z:snap(target.z,this.step),
      width:template?.width??(item?item.w*CELL+2:10),depth:template?.depth??(item?item.d*CELL+2:12),angle:template?.angle??0};
    this.id=p.id;
    for(const name of ['x','z','width','depth','angle'])this.set(name,p[name]);
    this.set('offsetX',entity?.pose.offsetX??0);this.set('offsetZ',entity?.pose.offsetZ??0);this.set('relative',entity?.pose.angle??0);
    const lotOnly=mode==='lot'||mode==='draw',buildingOnly=mode==='building'||mode==='attach';
    this.form.querySelector('[data-edit=lot]').hidden=buildingOnly;
    this.form.querySelector('[data-edit=building]').hidden=lotOnly;
    this.frontage=this.app.city.allowRiverfront&&!!type&&!buildingOnly;
    this.form.querySelector('[data-edit=frontage]').hidden=!this.frontage;
    this.form.querySelector('h3').textContent={quick:item?`放置${item.name}`:'放置',draw:'划定空地块',lot:'移动或调整地块',building:'调整建筑',attach:item?`在地块内放置${item.name}`:'放置建筑'}[mode];
    this.form.querySelector('.parcel-instructions').textContent={quick:'在地图点击放置，或输入数值后确认。R 旋转地块。',draw:'在地图点选两个对角，或输入中心和宽深后确认。',lot:'拖动四边调整范围，拖动中间手柄移动整块。也可输入数值。',building:'拖动建筑手柄或点选地块内的新位置。',attach:'点击地块内的位置，或输入局部偏移后确认。'}[mode];
    this.render();
  }
  close(){this.form.hidden=true;this.type=null;this.corner=null;this.handles.clear();if(this.frontage)this.app.world.showStudyDraft([]);}
  read(name,step=0){
    const value=this.get(name).valueAsNumber;
    return this.dirty.has(name)?snap(value,step):value;
  }
  draft(){
    const parcel={id:this.id,x:this.read('x',this.step),z:this.read('z',this.step),width:this.read('width'),depth:this.read('depth'),angle:this.read('angle',this.angleStep)};
    const building=this.type?{type:this.type,color:this.color,offsetX:this.read('offsetX',this.step),offsetZ:this.read('offsetZ',this.step),angle:this.read('relative',this.angleStep)}:undefined;
    return {parcel,building};
  }
  plan({parcel,building}=this.draft()){
    const values=[parcel.x,parcel.z,parcel.width,parcel.depth,parcel.angle,...(building?[building.offsetX,building.offsetZ,building.angle]:[])];
    if(values.some(value=>!Number.isFinite(value)))return {error:'请填写有效数值'};
    if([parcel.x,parcel.z,parcel.width,parcel.depth,building?.offsetX??0,building?.offsetZ??0].some(value=>Math.abs(value)>32768))return {error:'位置或尺寸超出可建范围'};
    return this.app.city.planParcelEdit(parcel,building);
  }
  render(){
    const plan=this.plan();
    const sourceId=['lot','building'].includes(this.mode)?plan.entity?.id:null;
    this.app.world.showParcelPreview(plan,sourceId);
    this.handles.set(plan,this.mode);
    const feedback=this.form.querySelector('.parcel-feedback');
    const relative=['building','attach'].includes(this.mode);
    feedback.textContent=plan.error||(relative?`可以放置 · 相对 ${plan.entity.pose.angle}°`:`可以放置 · 地块 ${plan.parcel.angle}°`);
    if(this.frontage)this.renderFrontage(plan,feedback);
    feedback.classList.toggle('invalid',!!plan.error);
    this.form.querySelector('[type=submit]').disabled=!!plan.error;
  }
  renderFrontage(plan,feedback){
    const {parcel,entity}=plan;
    this.suggestion=parcel&&frontageSuggestion(this.app.city,parcel,this.roadHint);
    this.form.querySelector('[data-frontage=apply]').disabled=!this.suggestion;
    const access=entity&&!plan.error&&this.app.world.traffic.people.network.entryAccess(entity);
    const lines=[];
    if(access){
      const {point,target}=access;
      if(target)lines.push(point.x,point.y+.07,point.z,target.x,target.y+.07,target.z);
      else {
        const angle=(parcel.angle+entity.pose.angle)*Math.PI/180;
        for(const start of [0,.5,1,1.5])for(const distance of [start,start+.25])
          lines.push(point.x+Math.sin(angle)*distance,point.y+.07,point.z+Math.cos(angle)*distance);
      }
    }
    this.app.world.showStudyDraft(lines,!access?.target);
    if(this.pickRoad)feedback.textContent='点击地图中相邻的道路以选定路侧';
    else if(!plan.error){
      const suggested=this.suggestion?`建议 ${this.suggestion.angle.toFixed(1)}°`:'附近没有可选路侧';
      feedback.textContent+=` · ${suggested} · ${access?.target?'入口可接步道':'入口尚未接到步道'}`;
    }
  }
  setDraft({parcel,building}){
    for(const name of ['x','z','width','depth','angle'])this.set(name,parcel[name]);
    if(building){this.set('offsetX',building.offsetX);this.set('offsetZ',building.offsetZ);this.set('relative',building.angle);}
    this.render();
  }
  dragHandle(key,{parcel,building},dx,dz){
    const [u,v]=parcelLocal({x:0,z:0,angle:parcel.angle},dx,dz);
    if(PARCEL_EDGES[key]){
      const edge=PARCEL_EDGES[key],delta=snap([u,v][edge.index],this.step);
      const resized=resizeParcelEdge(parcel,key,delta,this.step||.01);
      parcel=resized.parcel;
      if(building)building={...building,offsetX:building.offsetX-resized.shift[0],offsetZ:building.offsetZ-resized.shift[1]};
    }else if(this.mode==='building'&&building){
      building={...building,offsetX:building.offsetX+snap(u,this.step),offsetZ:building.offsetZ+snap(v,this.step)};
    }else parcel={...parcel,x:parcel.x+snap(dx,this.step),z:parcel.z+snap(dz,this.step)};
    this.setDraft({parcel,building});
  }
  pointer(x,z){
    if(this.pickRoad)return;
    if(this.follow){this.position(x,z);this.render();}
    else if(this.mode==='draw'&&this.corner){this.drawTo(x,z);this.render();}
  }
  drawTo(x,z){
    const [ax,az]=this.corner,bx=snap(x,this.step),bz=snap(z,this.step);
    const [dx,dz]=parcelLocal({x:ax,z:az,angle:this.read('angle',this.angleStep)},bx,bz);
    this.set('x',(ax+bx)/2);this.set('z',(az+bz)/2);
    this.set('width',Math.max(Math.abs(dx),this.step||.01));this.set('depth',Math.max(Math.abs(dz),this.step||.01));
  }
  click(x,z){
    if(this.pickRoad){
      const city=this.app.city,road=city.nativeAt(x,z)??city.at(Math.floor(x/CELL+.5),Math.floor(z/CELL+.5));
      if(road&&frontageSuggestion(city,this.draft().parcel,road.id)){
        this.roadHint=road.id;this.pickRoad=false;this.render();
      }else this.app.ui.toast('请选择地块附近的道路',true);
      return;
    }
    if(this.mode==='quick'){
      if(this.follow)this.position(x,z);
      this.apply();return;
    }
    if(this.mode==='draw'){
      if(this.corner){this.drawTo(x,z);this.corner=null;}
      else {this.corner=[snap(x,this.step),snap(z,this.step)];this.position(x,z);}
    }else if(this.mode==='lot')this.position(x,z);
    else {
      const {parcel}=this.draft(),[u,v]=parcelLocal(parcel,x,z);
      this.set('offsetX',snap(u,this.step));this.set('offsetZ',snap(v,this.step));
    }
    this.render();
  }
  rotate(){
    const name=['building','attach'].includes(this.mode)?'relative':'angle';
    const value=this.read(name,this.angleStep);
    this.set(name,normalAngle(snap((Number.isFinite(value)?value:0)+15,this.angleStep)));
    this.render();
  }
  apply(){
    if(this.app.replacing||this.app.navigating)return;
    const draft=this.draft(),plan=this.plan(draft);
    if(plan.error){this.app.ui.toast(plan.error,true);return;}
    const result=this.app.city.editParcel(draft.parcel,draft.building);
    if(result.error){this.app.ui.toast(result.error,true);return;}
    this.app.finishParcelEdit(result);
  }
}
