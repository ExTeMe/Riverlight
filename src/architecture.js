import * as T from 'three';

// Each address has its own massing and purpose. Shared construction helpers do
// not determine the silhouette; the individual architects below do.
const glyphs={A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['111','010','010','010','010','010','111'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],Y:['10001','10001','01010','00100','00100','00100','00100']};

export function createArchitecture(item,color,kit,detail=true){
  const {Builder,material,wallMaterial,tree,bench,lamp,roof}=kit;
  const b=new Builder(),W=item.w*4,D=item.d*4,wall=wallMaterial(item,color);
  const stone=material('#e2dac6','roof'),white=material('#ece8dd','roof'),metal=material('#465860'),timber=material('#a5744f'),glass=material('#426775','glass'),paving=material('#bfb6a0','ground'),green=material('#79936b','leaf');
  const seed=[...item.id].reduce((s,c)=>s+c.charCodeAt(0),0);
  const extra=[];
  const sign=(text,x,y,z,width=4,bg=metal)=>{
    b.box(width,.95,.13,x,y,z,bg);if(!detail)return;
    const s=Math.min(.105,width/(text.length*6+2));
    [...text].forEach((c,i)=>(glyphs[c]||glyphs.I).forEach((row,j)=>[...row].forEach((pixel,k)=>{if(pixel==='1')b.box(s*.84,s*.84,.025,x+(i*6+k-text.length*3+1)*s,y+(3-j)*s,z+.08,material('#f1d6a0','sign'));})));
  };
  const window=(x,y,z,w,h,side=0,index=0)=>{
    const random=Math.abs(Math.sin(x*12.8+y*7.2+z*3.1+seed+index)*437.4)%1;
    const role=random>.76?'windowWarm':random>.65?'windowSoft':'glass';
    const m=material(role==='glass'?'#486672':role==='windowWarm'?'#6d7b7a':'#657c84',role);
    b.box(side?.07:w,h,side?w:.07,x,y,z,m);
    if(detail){b.box(side?.13:w+.12,.085,side?w+.12:.13,x,y-h/2,z,stone);if(w>1.5)b.box(side?.12:.065,h,side?.065:.12,x,y,z,metal);}
  };
  const facade=(w,h,d,x=0,z=0,y=.3,step=2.5)=>{
    if(!detail)return;
    for(let f=0;f<Math.floor(h/step);f++){
      const yy=y+f*step+step*.55,nx=Math.max(1,Math.floor(w/1.9)),nz=Math.max(1,Math.floor(d/1.9));
      for(let i=0;i<nx;i++)for(const side of [-1,1])window(x+(i-(nx-1)/2)*w/nx,yy,z+side*(d/2+.05),w/nx*.58,step*.53,0,i+f*11);
      for(let i=0;i<nz;i++)for(const side of [-1,1])window(x+side*(w/2+.05),yy,z+(i-(nz-1)/2)*d/nz,d/nz*.58,step*.53,1,i+f*7);
    }
  };
  const block=(w,h,d,x=0,z=0,y=.3,m=wall,windows=true)=>{b.box(w,h,d,x,y+h/2,z,m);b.box(w+.18,.16,d+.18,x,y+h+.08,z,stone);if(windows)facade(w,h,d,x,z,y);};
  const base=()=>b.box(W-.2,.22,D-.2,0,.11,0,paving);
  const planter=(x,z,w=1.7,d=1,y=.3)=>{b.box(w,.5,d,x,y+.25,z,stone);b.box(w-.14,.28,d-.14,x,y+.57,z,green);};
  const terrace=(w,d,x,z,y)=>{b.box(w,.18,d,x,y,z,white);if(detail){for(const sx of [-1,1])b.box(.07,.55,d,x+sx*w/2,y+.35,z,metal);b.box(w,.55,.06,x,y+.35,z+d/2,material('#82a0a4','glass'));}};
  const table=(x,z,umbrella=false)=>{b.cylinder(.62,.62,.1,x,.85,z,timber,12);b.cylinder(.07,.07,.8,x,.4,z,metal,6);if(detail)for(const s of [-1,1]){b.box(.48,.12,.48,x+s*.85,.45,z,timber);b.box(.48,.55,.09,x+s*.85,.72,z-.22,timber);}if(umbrella){b.cylinder(.035,.035,2.7,x,1.35,z,white,6);b.cylinder(0,1.3,.55,x,2.85,z,material('#c47654','roof'),10);}};
  const door=(x,z,y=.3)=>{b.box(1.05,1.9,.1,x,y+.95,z,material('#7a847d','windowWarm'));b.box(.08,1.9,.16,x,y+.95,z+.02,metal);};
  base();

  switch(item.id){
    case 'cottage':{
      block(5.4,2.65,4.3,0,-.7);roof(b,5.9,4.9,3.1,material(item.roof,'roof'));b.box(.6,2,.65,1.4,4,-1.5,wall);
      b.box(4,.15,1.8,0,.45,2.2,stone);b.box(4.4,.16,1.85,0,2.65,2.2,white);for(const x of [-1.8,1.8])b.cylinder(.1,.13,2.2,x,1.5,2.85,white,8);door(0,1.55);planter(-2.8,2.8,.65,1.3);break;
    }
    case 'sage-house':{
      block(4.6,3,4.6,0,-.6);const roofMat=material('#42606a','roof');const shape=new T.Shape();shape.moveTo(-3,0);shape.lineTo(0,4.2);shape.lineTo(3,0);shape.closePath();const g=new T.ExtrudeGeometry(shape,{depth:5.2,bevelEnabled:false});b.geo(g,roofMat,0,2.1,-3.2);
      b.box(2,2.7,.1,0,3.4,2.05,glass);b.box(.1,2.7,.15,0,3.4,2.13,white);b.box(3.4,.22,1.3,0,.3,2.65,timber);door(0,2.18);break;
    }
    case 'rose-house':{
      block(4.6,3,4.4,-.65,-.6);block(2.2,2.4,3.2,2,1);roof(b,5.1,4.8,3.45,material(item.roof,'roof'));
      b.cylinder(1.05,1.05,2.15,-.7,1.4,2.1,glass,5);b.cylinder(0,1.3,1,-.7,2.95,2.1,material(item.roof,'roof'),5);door(2,2.65);planter(-2.9,2.9,.65,1.2);break;
    }
    case 'villa':{
      block(7.7,2.7,4.3,-1,-.8);block(6.3,2.8,3.3,1,-1,3.15);b.box(5.8,2.1,.08,1,4.55,.72,glass);terrace(5.6,2.2,1,1.7,3.02);
      b.box(3.1,.12,2.6,-3.4,.34,2.1,material('#559eac','glass'));for(const z of [-1.8,-.8,.2])b.box(3.6,.14,.12,-3.5,6.25,z,timber);planter(4.6,2.5,1.3,1.5);break;
    }
    case 'townhouse':{
      for(let i=0;i<3;i++){const x=(i-1)*2.35;block(2.22,6.2,5.4,x,-.3,.3,i===1?wall:material(i?'#cda375':'#a75c4f'));const shape=new T.Shape();shape.moveTo(-1.18,0);shape.lineTo(0,1.25);shape.lineTo(1.18,0);shape.closePath();b.geo(new T.ExtrudeGeometry(shape,{depth:.15,bevelEnabled:false}),stone,x,6.6,2.45);door(x,2.5);b.box(2.15,.15,1,x,.3,2.8,stone);}break;
    }
    case 'apartment':case 'mint-apartment':{
      const mint=item.id==='mint-apartment',h=mint?10.4:13;block(mint?4.8:6.1,h,4.9,mint?-1:0,-.5);
      if(mint)block(2.6,6,3.8,2.15,.5,.3,white);
      for(let f=1;f<(mint?4:5);f++){const x=mint?-1:(f%2?1.1:-1.1);terrace(mint?4.9:3.5,1.25,x,2.4,f*2.6+.35);if(detail)planter(x-1,2.65,.6,.45,f*2.6+.44);}
      b.box(3,.2,1.2,0,2.5,2.6,stone);door(0,2);break;
    }
    case 'residence':case 'terrace-tower':{
      const residence=item.id==='residence';for(let level=0;level<4;level++){const w=9.8-level*1.7,d=8.2-level*1.1,h=residence?5.1:6.2,y=.3+level*h;block(w,h,d,-level*.5,-level*.35,y);terrace(w+.25,1.5,-level*.5,d/2-level*.35+.4,y+.2);if(detail)for(const x of [-w*.3,w*.3]){planter(x-level*.5,d/2-level*.35,.9,.8,y+.25);}}
      if(detail){tree(b,-4.7,4.7,.5);tree(b,4.7,4.7,.5);}break;
    }
    case 'office':{
      block(9.8,3.2,8.7,0,0,.3,stone);block(4.1,23,6,-2.7,-.7,3.5);block(3.5,17,5.3,2.8,.7,3.5,material('#7c979e'));
      b.box(3.1,2.6,2.8,.1,13,-.4,glass);b.box(3.2,.18,3,.1,14.35,-.4,white);for(const x of [-4,-1.4])b.box(.18,22,6.2,x,14.5,-.7,white);sign('OFFICE',0,2.55,4.45,5);break;
    }
    case 'glass-tower':{
      block(9.8,2.8,8.8,0,0,.3,stone,false);
      const tower=new T.CylinderGeometry(3.3,4.2,34,detail?32:12);tower.scale(1,1,.8);b.geo(tower,glass,0,20,0);
      for(let f=0;f<14;f++){const y=3.4+f*2.5,r=4.2-f*.064;const ring=new T.CylinderGeometry(r+.06,r+.06,.13,detail?32:12);ring.scale(1,1,.8);b.geo(ring,stone,0,y,0);if(detail)for(let k=0;k<16;k++){const a=k*Math.PI/8;const m=k%5===0&&f%3!==0?material('#6c8589','windowSoft'):metal;b.box(.09,2.3,.1,Math.sin(a)*r,y+1.2,Math.cos(a)*r*.8,m,a);}}
      b.cylinder(1.6,3.3,2.8,0,38,0,material('#789a9d','roof'),20);b.cylinder(.06,.13,4,0,41,0,metal,8);break;
    }
    case 'hotel':{
      block(10,3.1,6.4,0,0,.3,stone);block(7.5,17,4.2,-.6,-.7,3.4);for(const x of [-3.3,2.1])b.box(.35,17,4.4,x,12,-.7,white);
      terrace(8.1,2.1,-.6,2.05,6.1);b.box(3,.12,1.5,3.1,3.58,1.5,material('#54a8b1','glass'));sign('HOTEL',-.6,21.2,1.52,5);b.box(4,.18,2.3,0,2.55,2.6,material('#ae7354','roof'));door(0,3.25);break;
    }
    case 'cafe':case 'bakery':case 'bookshop':{
      const bakery=item.id==='bakery',books=item.id==='bookshop';block(5.7,books?6.5:4.9,4.2,0,-1);
      if(bakery||books)roof(b,6.2,4.8,books?6.95:5.35,material(bakery?'#b1714d':'#42606a','roof'));
      b.box(4.9,1.75,.1,0,1.5,1.17,material('#93876d','windowWarm'));door(1.7,1.3);
      if(books){for(let i=0;i<8;i++)b.box(.44,.6+i%3*.2,.18,-1.7+i*.48,3.1,1.3,material(['#b86a50','#527a80','#bc9a56'][i%3]));sign('BOOKS',0,4.05,1.3,4.5);}
      else{for(let i=0;i<10;i++)b.box(.57,.16,1.4,-2.57+i*.57,2.7,1.65,material(i%2?'#eee4ce':bakery?'#c1744e':'#587b68','roof'));sign(bakery?'BAKERY':'CAFE',0,3.4,1.3,4.2);}
      if(detail){table(-1.7,2.8,!bakery&&!books);table(1,2.8);planter(-3.2,2,.45,2.5);}break;
    }
    case 'market':{
      for(const x of [-3.6,0,3.6]){b.box(2.9,1,1.55,x,.8,-1,timber);for(const z of [-1.8,-.2])for(const dx of [-1.4,1.4])b.cylinder(.07,.07,2.2,x+dx,1.2,z,white,6);roof(b,3.2,2.2,2.5,material(x===0?'#698477':'#c57a4e','roof'));if(detail)for(let i=0;i<8;i++)b.sphere(.17,x+(i%4-1.5)*.5,1.45,-1+(i>3?.35:-.35),material(i%2?'#d3a745':'#b66d50'));}sign('MARKET',0,3.5,.25,4.6);bench(b,-3.2,2.65);break;
    }
    case 'mall':{
      for(const x of [-6.6,6.6]){block(5.4,6.2,12.5,x,-.6,.3,wall,false);for(let f=0;f<2;f++){b.box(5,1.9,.09,x,1.65+f*3,5.72,material('#79837a',f?'windowSoft':'windowWarm'));b.box(5.5,.2,.45,x,3.3+f*3,5.95,white);}terrace(5.6,12.8,x,-.6,6.72);if(detail)for(const z of [-4,0,3.5])planter(x,z,2,1.5,6.85);}
      b.box(7,4.5,11.3,0,2.55,-.6,glass);
      b.geo(new T.CylinderGeometry(3.5,3.5,11.4,detail?24:10,1,true,Math.PI/2,Math.PI),material('#91adb1','glass'),0,4.8,-.6,Math.PI/2);
      if(detail)for(let z=-6;z<6;z+=1.3)b.geo(new T.TorusGeometry(3.53,.065,6,24,Math.PI),white,0,4.8,z,0,0,0);
      b.box(8,.2,2.4,0,3.35,5.65,white);for(const x of [-3,3])b.cylinder(.13,.13,3,x,1.7,6.4,stone,8);
      sign('MALL',0,4.05,6.8,6,material('#50797b'));door(-1,5.15);door(1,5.15);if(detail){table(-6.5,6.9,true);table(6.5,6.9,true);}break;
    }
    case 'library':{
      block(9.7,2.7,8,0,0,.3,glass,false);block(10.2,2.5,5.5,-.4,-1,3,wall,false);b.box(7.8,1.7,.08,-.5,4.2,1.82,glass);
      for(let i=0;i<15;i++)b.box(.13,2.5,5.7,-5+i*.66,4.3,-1,timber);terrace(7.5,2.6,.6,3.3,3.02);sign('LIBRARY',0,2.5,4.1,5.5);if(detail){bench(b,-3,4.8);bench(b,3,4.8);}break;
    }
    case 'museum':{
      block(9.6,3,5.3,0,0,.3,white,false);for(const x of [-3.2,0,3.2]){const roofShape=new T.Shape();roofShape.moveTo(-1.8,0);roofShape.lineTo(1.8,2.8);roofShape.lineTo(1.8,0);roofShape.closePath();b.geo(new T.ExtrudeGeometry(roofShape,{depth:5.9,bevelEnabled:false}),stone,x,3.4,-3);b.box(.09,2.45,5.6,x+1.65,4.65,-.05,glass);}b.box(8,2.2,.1,0,1.6,2.72,glass);sign('MUSEUM',0,2.9,2.85,4.9);if(detail)b.geo(new T.TorusKnotGeometry(.7,.15,40,6),material('#bc8753'),-3.7,1.6,3.4);break;
    }
    case 'school':{
      block(10.5,5,2.8,0,-2);for(const x of [-4,4])block(2.4,3.2,3.1,x,.8,.3,wall);
      b.box(4.8,.05,3.2,0,.26,1.1,material('#a77760','ground'));b.box(.07,.012,3,0,.3,1.1,white);b.geo(new T.TorusGeometry(.65,.035,4,20),white,0,.31,1.1,Math.PI/2);sign('SCHOOL',0,5.2,-.5,4.8);
      if(detail){b.cylinder(.04,.05,5,-2.1,2.7,2.7,metal,6);b.box(1,.55,.06,-1.6,4.85,2.7,material('#d59c5c'));}break;
    }
    case 'clinic':{
      block(5.8,5.7,5.3,0,-.55,.3,white);b.box(1.6,.42,.1,0,5,2.18,material('#b96458','sign'));b.box(.42,1.6,.12,0,5,2.18,material('#b96458','sign'));b.box(5.1,.16,1.7,0,2.65,2.15,material('#79a6a7','roof'));door(0,2.15);sign('CLINIC',0,3.35,2.2,3.8);break;
    }
    case 'clocktower':{
      block(5.4,2,5.4);block(3.4,9,3.4,0,0,2.3,wall,false);b.box(4.1,.4,4.1,0,10.4,0,stone);
      for(const side of [-1,1]){b.geo(new T.CylinderGeometry(.9,.9,.14,detail?24:12),material('#ede0b8','windowSoft'),0,9,side*1.79,Math.PI/2);b.box(.08,.68,.1,0,9.2,side*1.9,metal);b.box(.5,.08,.1,.2,9,side*1.9,metal);}
      b.cylinder(0,3,4.2,0,13.1,0,material('#527e78','roof'),4);b.cylinder(.08,.12,1.8,0,16,0,metal,6);break;
    }
    case 'amusement':{
      b.cylinder(7.4,7.4,.08,-3.5,.28,-2.2,material('#d8c7a9','ground'),40);const wheel=new T.Group();wheel.name='ferris-wheel';wheel.userData.animation='ferris';wheel.position.set(-3.5,9,-2.2);
      for(const z of [-3.4,-1])for(const dx of [-3,3]){const a=new T.Vector3(-3.5+dx,.35,z),end=new T.Vector3(-3.5,9,z),g=new T.CylinderGeometry(.16,.25,a.distanceTo(end),8);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),end.clone().sub(a).normalize()));b.geo(g,white,...a.add(end).multiplyScalar(.5).toArray());}
      const rotor=new T.Group();rotor.name='rotor';wheel.add(rotor);const wb=new Builder();for(const z of [-.45,.45])wb.geo(new T.TorusGeometry(7,.12,6,detail?64:24),white,0,0,z);
      for(let i=0;i<12;i++){const a=i*Math.PI/6;wb.geo(new T.BoxGeometry(.08,14,.08),metal,0,0,0,0,0,a);const gb=new Builder(),cab=material(['#c17d5d','#648f91','#c5a25b','#9c7e8a'][i%4]);gb.box(1.5,1.05,1.35,0,-.65,0,cab);gb.box(1.35,.65,1.2,0,.15,0,glass);gb.box(1.6,.15,1.45,0,.57,0,stone);const gondola=gb.finish();gondola.name='gondola';gondola.userData.angle=a;rotor.add(gondola);if(detail)for(let k=0;k<5;k++){const angle=a+k*Math.PI/30;wb.sphere(.09,Math.cos(angle)*7,Math.sin(angle)*7,.54,material(i%2?'#f0c88b':'#83b5ba','festival'));}}
      rotor.add(wb.finish());extra.push(wheel);
      const carousel=new T.Group();carousel.name='carousel';carousel.userData.animation='carousel';carousel.position.set(6.1,0,3.1);const cb=new Builder();cb.cylinder(3.1,3.3,.38,0,.48,0,material('#ba8771'));cb.cylinder(.25,.35,3.8,0,2,0,white,12);cb.cylinder(0,3.6,1.6,0,4.8,0,material('#bf735e','roof'),12);cb.cylinder(3.6,3.6,.25,0,4,0,material('#e8ca91','festival'),24);
      for(let i=0;i<8;i++){const a=i*Math.PI/4,x=Math.sin(a)*2.3,z=Math.cos(a)*2.3;cb.cylinder(.045,.045,3.6,x,2.1,z,metal,6);const horse=new Builder();horse.sphere(.52,0,1.3,0,material('#eee0b9'),1.25,.7,.6);horse.box(.3,.9,.35,.38,1.7,0,white);horse.sphere(.22,.5,2.12,0,white,1.5,.7,.7);for(const dx of [-.35,.35])horse.box(.1,.5,.1,dx,.9,0,timber);const mesh=horse.finish();mesh.position.set(x,0,z);mesh.rotation.y=a;mesh.name='horse';mesh.userData.phase=a;carousel.add(mesh);}
      carousel.add(cb.finish());extra.push(carousel);block(3,2.5,2.6,-7,7,.3,material('#739998'),false);sign('PLAY',-1,3,8.6,5);for(const x of [-4,2])b.cylinder(.1,.15,3.4,x,1.8,8.6,white,8);b.box(6.3,.15,.3,-1,3.6,8.6,material('#cdab63','festival'));if(detail){bench(b,6,-5.9);planter(8,-5.5,3,1);table(7,7,true);}break;
    }
    default:return null;
  }
  const model=b.finish();for(const object of extra){object.userData.dynamic=true;model.add(object);}model.userData.architecture=item.id;model.userData.detail=detail;return model;
}

export function animateArchitecture(root,time){
  root.traverse(object=>{
    if(object.userData.animation==='ferris'){
      const rotor=object.getObjectByName('rotor'),angle=time*.075;rotor.rotation.z=angle;
      for(const child of rotor.children)if(child.name==='gondola'){const a=child.userData.angle;child.position.set(Math.cos(a)*7,Math.sin(a)*7,0);child.rotation.z=-angle;}
    }else if(object.userData.animation==='mall-door')object.rotation.y=time*.6;
    else if(object.userData.animation==='carousel'){
      object.rotation.y=time*.23;for(const child of object.children)if(child.name==='horse')child.position.y=Math.sin(time*1.6+child.userData.phase)*.24;
    }
  });
}
