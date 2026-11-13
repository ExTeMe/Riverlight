import { BoxGeometry, Mesh, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRIDGE_STYLES } from './bridge-styles.js';

const axis=new Vector3(0,1,0);
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);

export function addBridgeDetails(group,appearance,samples,half,material,detail=true) {
  const {key,span,offset=0}=appearance,style=BRIDGE_STYLES[key];
  const pieces=[];
  const start=appearance.from??0,end=appearance.to??samples.length-1;
  const path=samples.slice(start,end+1),distances=[0];
  for(let i=1;i<path.length;i++){
    const a=path[i-1].point,b=path[i].point;
    distances.push(distances.at(-1)+Math.hypot(b[0]-a[0],b[2]-a[2]));
  }
  const length=distances.at(-1);
  if(!length)return;
  function point(distance,side,y){
    const d=Math.max(0,Math.min(length,distance));
    const i=Math.max(1,distances.findIndex(value=>value>=d));
    const a=path[i-1],b=path[i],t=(d-distances[i-1])/(distances[i]-distances[i-1]);
    const [x,h,z]=mix(a.point,b.point,t);
    const [dx,dz]=mix(a.direction,b.direction,t),norm=Math.hypot(dx,dz)||1;
    return [x-side*dz/norm,h+y,z+side*dx/norm];
  }
  function beam(a,b,width,depth=width){
    const start=new Vector3(...a),end=new Vector3(...b),direction=end.clone().sub(start);
    const length=direction.length();
    if(length<1e-5)return;
    const rotation=new Quaternion().setFromUnitVectors(axis,direction.divideScalar(length));
    pieces.push(new BoxGeometry(width,length,depth).applyQuaternion(rotation).translate(...start.lerp(end,.5).toArray()));
  }
  const x=half-.2;
  const archLength=appearance.ends?span:length;
  const rise=Math.min(7.2,span*.12);
  function archHeight(distance){
    const t=(offset+distance)/archLength;
    return .16+4*rise*t*(1-t);
  }
  for(const side of [-x,x]){
    if(key==='arch'){
      const count=Math.ceil(length/(detail?1.6:3.2));
      for(let i=1;i<=count;i++){
        const a=length*(i-1)/count,b=length*i/count;
        beam(point(a,side,archHeight(a)),point(b,side,archHeight(b)),.18,.22);
      }
      const spacing=detail?3.2:6.4;
      for(let d=Math.ceil((offset+.01)/spacing)*spacing-offset;d<length-.01;d+=spacing){
        beam(point(d,side,.12),point(d,side,archHeight(d)),.065);
      }
    }else if(key==='timber'){
      if(detail)for(let d=Math.ceil((offset+.01)/2)*2-offset;d+.1<length;d+=2){
        beam(point(d,side,.12),point(Math.min(length,d+1.6),side,.7),.09,.11);
        beam(point(d,side,.7),point(Math.min(length,d+1.6),side,.12),.09,.11);
      }
    }else if(key==='stone'){
      const spacing=detail?2:4;
      for(let d=Math.ceil((offset+.01)/spacing)*spacing-offset;d<length;d+=spacing){
        beam(point(d,side,.02),point(d,side,.96),.24,.27);
        beam(point(d,side,.88),point(d,side,1.03),.34,.35);
        if(detail&&d+.55<length)beam(point(d+.55,side,.1),point(d+.55,side,.78),.10);
      }
    }else{
      // The steel girder runs outside the pavement but inside the deck envelope.
      const count=Math.ceil(length/(detail?1.5:3));
      for(let i=1;i<=count;i++){
        beam(point(length*(i-1)/count,side,-.17),point(length*i/count,side,-.17),.12,.14);
      }
      if(detail)for(let d=Math.ceil((offset+.01)/2)*2-offset;d+.5<length;d+=2){
        beam(point(d,side,.14),point(d+.5,side,.73),.055);
      }
    }
  }
  if(key==='arch'){
    const spacing=detail?6.4:12.8;
    for(let d=Math.ceil((offset+.01)/spacing)*spacing-offset;d<length-.01;d+=spacing){
      const height=archHeight(d);
      if(height>4.1)beam(point(d,-x,height),point(d,x,height),.13);
    }
  }
  if(!pieces.length)return;
  const geometry=mergeGeometries(pieces);
  for(const part of pieces)part.dispose();
  const mesh=new Mesh(geometry,material(style.railing,'ground'));
  mesh.castShadow=detail;mesh.receiveShadow=true;group.add(mesh);
}
