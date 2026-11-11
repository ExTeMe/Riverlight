import { Vector3 } from 'three';
import { icon } from './icons.js';

export class RoadHeightHandles {
  constructor(editor,root){
    this.editor=editor;
    this.point=new Vector3();
    this.layer=document.createElement('div');
    this.layer.className='parcel-handles road-height-handles';
    this.layer.hidden=true;
    this.layer.setAttribute('role','group');
    this.layer.setAttribute('aria-label','道路高度手柄');
    root.append(this.layer);
    this.buttons=['起点','终点'].map((name,index)=>{
      const button=document.createElement('button');
      button.type='button';button.className='parcel-handle road-height-handle';
      button.setAttribute('aria-label',`调整${name}高度`);
      button.innerHTML=`${icon('resize',14)}<span></span>`;
      button.addEventListener('pointerdown',event=>this.start(event,index));
      button.addEventListener('pointermove',event=>this.move(event));
      button.addEventListener('pointerup',event=>this.finish(event,false));
      button.addEventListener('pointercancel',event=>this.finish(event,true));
      button.addEventListener('lostpointercapture',event=>this.finish(event,true));
      button.addEventListener('keydown',event=>{
        if(!['ArrowUp','ArrowDown'].includes(event.key)||this.drag)return;
        event.preventDefault();event.stopPropagation();
        const step=event.shiftKey?1:.1;
        this.editor.setHeight(index,this.ends[index][1]+(event.key==='ArrowUp'?step:-step));
      });
      this.layer.append(button);
      return button;
    });
  }
  set(ends,locked){
    this.ends=ends;
    this.layer.hidden=!ends;
    if(!ends)return;
    for(const [i,button] of this.buttons.entries()){
      button.disabled=locked[i];
      button.title=locked[i]?'已接路，高度随连接端点':'向上或向下拖动，方向键微调';
      button.querySelector('span').textContent=`${ends[i][1].toFixed(2)} 米`;
    }
    this.layout();
  }
  clear(){this.cancelFrame();this.drag=null;this.layer.hidden=true;}
  layout(){
    if(this.layer.hidden)return;
    const {camera,canvas}=this.editor.app;
    const {left,top,width,height}=canvas.getBoundingClientRect();
    camera.updateMatrixWorld();
    for(const [i,button] of this.buttons.entries()){
      const [x,y,z]=this.ends[i],p=this.point.set(x,y+.25,z).project(camera);
      button.hidden=p.z< -1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;
      if(button.hidden)continue;
      button.style.left=`${left+(1+p.x)*width/2}px`;
      button.style.top=`${top+(1-p.y)*height/2}px`;
    }
  }
  start(event,index){
    if(event.button!==0||this.drag||this.editor.app.replacing)return;
    const {camera,canvas,keys}=this.editor.app,[x,y,z]=this.ends[index];
    const from=this.point.set(x,y,z).project(camera).y,to=this.point.set(x,y+1,z).project(camera).y;
    const pixelsPerMetre=Math.max(12,(to-from)*canvas.getBoundingClientRect().height/2);
    event.preventDefault();keys.clear();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    this.drag={id:event.pointerId,index,screenY:event.clientY,y,pixelsPerMetre};
  }
  move(event){
    const drag=this.drag;
    if(!drag||drag.id!==event.pointerId)return;
    this.pendingY=event.clientY;
    if(this.frame)return;
    this.frame=requestAnimationFrame(()=>{
      this.frame=null;
      this.editor.setHeight(drag.index,drag.y+(drag.screenY-this.pendingY)/drag.pixelsPerMetre);
    });
  }
  cancelFrame(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=null;}
  finish(event,canceled){
    const drag=this.drag;
    if(!drag||drag.id!==event.pointerId)return;
    this.cancelFrame();this.drag=null;
    if(canceled)this.editor.writeHeight(drag.index,drag.y);
    else this.editor.setHeight(drag.index,drag.y+(drag.screenY-event.clientY)/drag.pixelsPerMetre);
  }
}
