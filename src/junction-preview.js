import * as T from 'three';
import { vehicle } from './models.js';
import { VEHICLE_ENVELOPES } from './road-junction.js';

const colors={left:0x7fe0fd,right:0xffcf84,straight:0xb5f1aa,stop:0xffa299};

export class JunctionPreview {
  constructor(scene){
    this.group=new T.Group();scene.add(this.group);
  }
  clear(){
    this.group.traverse(object=>{
      object.geometry?.dispose();
      if(object.isLine)object.material.dispose();
    });
    this.group.clear();this.id=null;this.active=null;
  }
  set(segment,kind){
    if(segment===this.segment&&this.kind===kind&&this.active)return;
    this.clear();this.segment=segment;this.kind=kind;
    if(!segment?.junction)return;
    this.id=segment.id;this.elapsed=0;
    const {movements}=segment.junction, routes=movements.filter(route=>route.vehicles.includes(kind));
    this.routes=Object.keys(colors).flatMap(type=>routes.find(route=>route.kind===type)??[]);
    this.active={kind:segment.junction.kind,vehicle:kind,count:routes.length,turn:null,distance:0};
    const y=segment.profile.vehicleY;
    this.group.position.set(segment.center[0],y,segment.center[2]);
    for(const route of routes){
      const line=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:colors[route.kind]}));
      line.geometry.setAttribute('position',new T.Float32BufferAttribute(route.samples.flatMap(({point:[x,z]})=>[x,.015,z]),3));
      this.group.add(line);
    }
    if(!routes.length)return;
    this.probe=new T.Group();this.group.add(this.probe);
    const model=vehicle(kind==='bus'?3:0);
    model.position.y=-new T.Box3().setFromObject(model).min.y+.008;
    this.probe.add(model);
    const {length,width}=VEHICLE_ENVELOPES[kind];
    const outline=new T.LineLoop(new T.BufferGeometry(),new T.LineBasicMaterial({color:0xe5fff5}));
    outline.geometry.setAttribute('position',new T.Float32BufferAttribute([-1,1,1,-1].flatMap((sign,i)=>
      [sign*width/2,.021,(i<2?-1:1)*length/2]),3));
    this.probe.add(outline);this.update(0);
  }
  update(dt){
    if(!this.active||!this.routes.length)return;
    this.elapsed+=dt;
    const route=this.routes[Math.floor(this.elapsed/6)%this.routes.length];
    const distance=Math.min(route.length,(this.elapsed%6)*.9),{samples}=route;
    const i=Math.max(1,samples.findIndex(sample=>sample.distance>=distance));
    const a=samples[i-1],b=samples[i],t=(distance-a.distance)/(b.distance-a.distance);
    const interpolate=(from,to)=>from.map((n,k)=>T.MathUtils.lerp(n,to[k],t));
    const [x,z]=interpolate(a.point,b.point),[dx,dz]=interpolate(a.direction,b.direction);
    this.probe.position.set(x,0,z);this.probe.rotation.y=Math.atan2(dx,dz);
    Object.assign(this.active,{turn:route.kind,distance});
  }
}
