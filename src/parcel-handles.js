import { Vector3 } from 'three';
import { icon } from './icons.js';
import { PARCEL_EDGES, parcelPoint, placementOf } from './parcel.js';

const edgeNames={left:'地块左边',right:'地块右边',far:'地块后边',near:'地块前边'};
const keys={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};

export class ParcelHandles {
  constructor(editor,root){
    this.editor=editor;
    this.projected=new Vector3();this.axis=new Vector3();
    this.layer=document.createElement('div');this.layer.className='parcel-handles';this.layer.hidden=true;
    this.layer.setAttribute('role','group');this.layer.setAttribute('aria-label','场景编辑手柄');
    root.append(this.layer);
    this.buttons=new Map([...Object.keys(edgeNames),'move'].map(key=>{
      const button=document.createElement('button');button.type='button';button.className='parcel-handle';button.dataset.handle=key;
      button.innerHTML=icon(key==='move'?'move':'resize',18);
      if(edgeNames[key]){button.title=`调整${edgeNames[key]}`;button.setAttribute('aria-label',button.title);}
      button.addEventListener('pointerdown',event=>this.start(event,key));
      button.addEventListener('pointermove',event=>this.move(event));
      button.addEventListener('pointerup',event=>this.finish(event,false));
      button.addEventListener('pointercancel',event=>this.finish(event,true));
      button.addEventListener('lostpointercapture',event=>this.finish(event,true));
      button.addEventListener('keydown',event=>this.nudge(event,key));
      this.layer.append(button);
      return [key,button];
    }));
  }
  set({parcel,entity,error},mode){
    this.layer.hidden=!parcel||!['lot','building'].includes(mode);
    this.parcel=parcel;this.mode=mode;
    this.building=entity&&placementOf(entity);
    this.layer.classList.toggle('invalid',!!error);
    const button=this.buttons.get('move');
    button.title=mode==='building'?'拖动建筑':'拖动整块地块';button.setAttribute('aria-label',button.title);
    this.layout();
  }
  clear(){this.drag=null;this.layer.hidden=true;this.layer.classList.remove('dragging');}
  layout(){
    if(this.layer.hidden)return;
    const {app}=this.editor,{parcel,mode,building}=this;
    app.camera.updateMatrixWorld();
    const {width,height,left,top}=app.canvas.getBoundingClientRect();
    for(const [key,button] of this.buttons){
      const edge=PARCEL_EDGES[key];
      if(edge&&mode==='building'){button.hidden=true;continue;}
      let x=parcel.x,z=parcel.z;
      if(edge){
        const point=[0,0];point[edge.index]=edge.sign*parcel[edge.axis]/2;
        [x,z]=parcelPoint(parcel,...point);
        point[edge.index]+=1;
        const [u,v]=parcelPoint(parcel,...point);
        this.axis.set(u,.18,v).project(app.camera);
      }else if(mode==='building'&&building)({x,z}=building);
      const p=this.projected.set(x,.18,z).project(app.camera);
      button.hidden=p.z< -1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;
      if(button.hidden)continue;
      button.style.left=`${left+(p.x+1)*width/2}px`;
      button.style.top=`${top+(1-p.y)*height/2}px`;
      if(edge)button.style.setProperty('--handle-angle',`${Math.atan2((p.y-this.axis.y)*height,(this.axis.x-p.x)*width)}rad`);
    }
  }
  ground(event){
    const {app}=this.editor;
    app.updatePointer(event);
    return app.cursor?[app.point.x,app.point.z]:null;
  }
  start(event,key){
    if(event.button!==0||this.drag||this.editor.app.replacing)return;
    const point=this.ground(event);
    if(!point)return;
    event.preventDefault();this.editor.app.keys.clear();
    event.currentTarget.setPointerCapture(event.pointerId);
    this.drag={id:event.pointerId,key,point,draft:this.editor.draft()};
    this.layer.classList.add('dragging');
  }
  move(event){
    const drag=this.drag;
    if(!drag||drag.id!==event.pointerId)return;
    const point=this.ground(event);
    if(point)this.editor.dragHandle(drag.key,drag.draft,point[0]-drag.point[0],point[1]-drag.point[1]);
  }
  finish(event,canceled){
    const drag=this.drag;
    if(!drag||drag.id!==event.pointerId)return;
    if(canceled)this.editor.setDraft(drag.draft);
    else this.move(event);
    this.drag=null;this.layer.classList.remove('dragging');
  }
  nudge(event,key){
    const direction=keys[event.key];
    if(!direction||this.drag)return;
    event.preventDefault();event.stopPropagation();
    const draft=this.editor.draft(),step=this.editor.step||.1;
    const edge=PARCEL_EDGES[key],amount=edge?direction[edge.index]:0;
    if(edge&&!amount)return;
    const local=edge?(edge.index===0?[amount,0]:[0,amount]):direction;
    const angle=key==='move'&&this.mode==='lot'?0:draft.parcel.angle;
    const [dx,dz]=parcelPoint({x:0,z:0,angle},local[0]*step,local[1]*step);
    this.editor.dragHandle(key,draft,dx,dz);
  }
}
