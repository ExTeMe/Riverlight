import * as T from 'three';
import { buildWalkNetwork, walkingRoute } from './walk-network.js';

const palette=['#e1b55b','#6e919e','#b85f4e','#e4dccc','#659479','#91749c'];
/** Autonomous walkers, rendered in six batches regardless of the number of people. */
export class Pedestrians {
  constructor(scene){this.scene=scene;this.group=new T.Group();scene.add(this.group);this.walkers=[];this.parts=[];this.matrix=new T.Matrix4();this.pose=new T.Object3D();this.part=new T.Object3D();}
  clear(){this.group.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();o.dispose?.();}});this.group.clear();this.walkers=[];this.parts=[];}
  rebuild(city){
    this.clear();this.network=buildWalkNetwork(city);
    const candidates=this.network.components.flat(),count=Math.min(112,Math.floor(candidates.length/19));
    for(let i=0;i<count;i++){
      const start=candidates[Math.floor(i*candidates.length/count)],route=walkingRoute(this.network,start,i*31+9);
      this.walkers.push({route,index:0,t:0,speed:.85+(i%7)*.09,seed:i*31+9,wait:0,walked:0,x:start.x,y:start.y,z:start.z,angle:0});
    }
    const definitions=[['body',new T.BoxGeometry(.43,.58,.24),'#ffffff'],['head',new T.IcosahedronGeometry(.17,1),'#d2a780'],['leftArm',new T.BoxGeometry(.13,.53,.15),'#ffffff'],['rightArm',new T.BoxGeometry(.13,.53,.15),'#ffffff'],['leftLeg',new T.BoxGeometry(.15,.58,.18),'#435463'],['rightLeg',new T.BoxGeometry(.15,.58,.18),'#435463']];
    for(const [name,geo,color] of definitions){
      const mesh=new T.InstancedMesh(geo,new T.MeshStandardMaterial({color,roughness:.86}),count);mesh.name=`Pedestrians_${name}`;mesh.castShadow=true;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      for(let i=0;i<count;i++)if(name==='body'||name.includes('Arm'))mesh.setColorAt(i,new T.Color(palette[i%palette.length]));
      this.parts.push(mesh);this.group.add(mesh);
    }
    const positions=[];
    for(const [a,b] of this.network.connectors){
      const dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);if(l<.1)continue;const nx=-dz/l*.3,nz=dx/l*.3;
      positions.push(a.x+nx,a.y-.035,a.z+nz,a.x-nx,a.y-.035,a.z-nz,b.x-nx,b.y-.035,b.z-nz,a.x+nx,a.y-.035,a.z+nz,b.x-nx,b.y-.035,b.z-nz,b.x+nx,b.y-.035,b.z+nz);
    }
    if(positions.length){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color:'#c8c7b7',roughness:.95,side:T.DoubleSide}));mesh.receiveShadow=true;mesh.name='Entrance_and_quay_walkways';this.group.add(mesh);}
    this.update(0,0,new T.Vector3(),[]);
  }
  update(dt,time,focus,cars){
    let visible=0;
    this.walkers.forEach((walker,i)=>{
      let a=walker.route[walker.index],b=walker.route[walker.index+1];
      if(!b){walker.seed++;walker.route=walkingRoute(this.network,a,walker.seed);walker.index=0;walker.t=0;walker.wait=.5+(i%5)*.3;b=walker.route[1];}
      if(!b)return;
      const distance=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)||.01,crossing=a.edges.get(b.id)==='crossing';
      const occupied=crossing&&walker.t<.06&&cars.some(car=>Math.hypot(car.mesh.position.x-(a.x+b.x)/2,car.mesh.position.z-(a.z+b.z)/2)<3.2);
      const moving=walker.wait<=0&&!occupied;
      if(walker.wait>0)walker.wait-=dt;
      if(moving){walker.t+=dt*walker.speed/distance;walker.walked+=dt*walker.speed;}
      const t=Math.min(1,walker.t);walker.x=T.MathUtils.lerp(a.x,b.x,t);walker.y=T.MathUtils.lerp(a.y,b.y,t);walker.z=T.MathUtils.lerp(a.z,b.z,t);
      const angle=Math.atan2(b.x-a.x,b.z-a.z);walker.angle+=T.MathUtils.euclideanModulo(angle-walker.angle+Math.PI,Math.PI*2)-Math.PI;
      if(walker.t>=1){walker.index++;walker.t=0;}
      const near=Math.hypot(walker.x-focus.x,walker.z-focus.z)<190;if(near)visible++;
      this.pose.position.set(walker.x,walker.y+(moving?Math.abs(Math.sin(walker.walked*5))*.025:0),walker.z);this.pose.rotation.set(0,walker.angle,0);this.pose.scale.setScalar(near?1:0);this.pose.updateMatrix();
      const swing=moving?Math.sin(walker.walked*5+i)*.48:0;
      const transforms=[[0,.9,0,0],[0,1.35,0,0],[-.3,.92,0,-swing],[.3,.92,0,swing],[-.13,.31,0,swing],[.13,.31,0,-swing]];
      transforms.forEach(([x,y,z,rx],j)=>{this.part.position.set(x,y,z);this.part.rotation.set(rx,0,0);this.part.scale.setScalar(1);this.part.updateMatrix();this.matrix.multiplyMatrices(this.pose.matrix,this.part.matrix);this.parts[j].setMatrixAt(i,this.matrix);});
    });
    for(const mesh of this.parts)mesh.instanceMatrix.needsUpdate=true;this.visibleCount=visible;
  }
}
