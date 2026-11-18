import * as T from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { getTemplate, updateMaterials } from './models.js';
import { CELL, entityDimensions } from './catalog.js';
import { WATER_Y, QUAY, quayCenter, riverBanks, riverSections } from './river.js';
import { placementAnchor, placementOf } from './parcel.js';
import { Puddles } from './puddles.js';

export function riverWaterGeometry(terrain,center=0){
  const positions=[];
  for(const {from,to,a:[west,east],b:[nextWest,nextEast]} of riverSections(center-4000,center+4000,terrain)){
    positions.push(west,-from,0,nextWest,-to,0,east,-from,0,east,-from,0,nextWest,-to,0,nextEast,-to,0);
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
  return geometry;
}

export const PRESETS = [
  {id:'riverside',name:'河畔晴日',caption:'微风 · 日光 · 慢生活',hour:15.5,season:'summer',weather:'clear',wind:.35,color:'#c9ddc2'},
  {id:'golden',name:'秋日来信',caption:'暖阳 · 落叶 · 咖啡香',hour:17,season:'autumn',weather:'clear',wind:.55,color:'#dfc393'},
  {id:'rainy',name:'雨夜街角',caption:'灯火 · 涟漪 · 雨声',hour:20,season:'summer',weather:'rain',wind:.45,color:'#91a8b0'},
  {id:'snowy',name:'冬日絮语',caption:'飘雪 · 暖窗 · 寂静',hour:16,season:'winter',weather:'snow',wind:.2,color:'#d7dedb'},
];
const skyVertex=`varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const skyFragment=`
varying vec3 vDirection;
uniform vec3 topColor;uniform vec3 bottomColor;uniform vec3 sunDirection;uniform float uTime;uniform float clouds;uniform float night;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
void main(){vec3 d=normalize(vDirection);float h=max(d.y,0.);vec3 c=mix(bottomColor,topColor,pow(h,.6));
vec2 uv=d.xz/max(.15,d.y)*1.2+vec2(uTime*.003,0.);float n=noise(uv)*.6+noise(uv*2.3)*.28+noise(uv*4.5)*.12;
float cloud=smoothstep(.56-clouds*.16,.77-clouds*.12,n)*smoothstep(.03,.28,h);c=mix(c,mix(vec3(.96,.94,.87),vec3(.24,.31,.36),night),cloud*(.28+clouds*.65));
float sun=pow(max(dot(d,sunDirection),0.),450.);c+=vec3(1.,.79,.48)*sun*(1.-night)*(1.-clouds*.7);
float star=step(.9987,hash(floor(d.xz/max(.1,d.y)*650.)))*night*smoothstep(.1,.5,h);c+=star*.65;
gl_FragColor=vec4(c,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
function normalTexture(){
  const s=128,data=new Uint8Array(s*s*4),hash=(x,y,p)=>{const n=Math.sin(((x%p+p)%p)*127.1+((y%p+p)%p)*311.7)*43758.5453;return n-Math.floor(n);};
  const noise=(x,y,p)=>{x=x/s*p;y=y/s*p;const ix=Math.floor(x),iy=Math.floor(y);let u=x-ix,v=y-iy;u=u*u*(3-2*u);v=v*v*(3-2*v);return T.MathUtils.lerp(T.MathUtils.lerp(hash(ix,iy,p),hash(ix+1,iy,p),u),T.MathUtils.lerp(hash(ix,iy+1,p),hash(ix+1,iy+1,p),u),v);};
  const height=(x,y)=>noise(x,y,4)*.55+noise(x,y,8)*.3+noise(x,y,16)*.15;
  for(let y=0;y<s;y++)for(let x=0;x<s;x++){const i=(y*s+x)*4;data[i]=128+(height(x-1,y)-height(x+1,y))*240;data[i+1]=128+(height(x,y-1)-height(x,y+1))*240;data[i+2]=254;data[i+3]=255;}
  const t=new T.DataTexture(data,s,s);t.wrapS=t.wrapT=T.RepeatWrapping;t.needsUpdate=true;return t;
}
function spriteTexture(kind){const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');if(kind==='rain'){const g=ctx.createLinearGradient(0,0,0,64);g.addColorStop(0,'rgba(215,235,237,0)');g.addColorStop(1,'rgba(215,235,237,.7)');ctx.fillStyle=g;ctx.fillRect(30,0,3,64);}else{const g=ctx.createRadialGradient(32,32,0,32,32,28);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.4,'rgba(255,255,255,.85)');g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);}return new T.CanvasTexture(c);}
export class Environment {
  constructor(scene,renderer,city){
    this.scene=scene;this.renderer=renderer;this.city=city;this.wet=0;this.snow=0;this.night=0;this.time=0;this.lastSeason='';this.lastEnvHour=-1;this.leafSources=[];scene.environmentIntensity=.3;
    this.sun=new T.DirectionalLight('#fff0d5',3);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-145,right:145,top:145,bottom:-145,near:1,far:500});this.sun.shadow.bias=-.00018;this.sun.shadow.normalBias=.18;this.sun.shadow.radius=3;scene.add(this.sun,this.sun.target);
    this.hemi=new T.HemisphereLight('#cde0e6','#9d9b78',2.2);scene.add(this.hemi);
    scene.fog=new T.FogExp2('#dce0cc',.0016);
    this.skyUniforms={topColor:{value:new T.Color('#86b6c2')},bottomColor:{value:new T.Color('#e7e6d3')},sunDirection:{value:new T.Vector3()},uTime:{value:0},clouds:{value:.2},night:{value:0}};
    this.sky=new T.Mesh(new T.SphereGeometry(2200,24,16),new T.ShaderMaterial({vertexShader:skyVertex,fragmentShader:skyFragment,uniforms:this.skyUniforms,side:T.BackSide,depthWrite:false}));scene.add(this.sky);
    this.water=new Water(riverWaterGeometry(city.terrain),{textureWidth:512,textureHeight:512,waterNormals:normalTexture(),sunDirection:new T.Vector3(.3,1,.4),sunColor:0xfff5d7,waterColor:0x528f82,distortionScale:1.4,fog:true,alpha:1});this.water.rotation.x=-Math.PI/2;this.water.position.y=WATER_Y;scene.add(this.water);
    this.waterTerrain=city.terrain;this.waterCenter=0;
    this.particles={};
    for(const kind of ['rain','snow']){const count=kind==='rain'?2500:1500;const positions=new Float32Array(count*3);for(let i=0;i<count;i++){positions[i*3]=(Math.random()-.5)*210;positions[i*3+1]=Math.random()*100;positions[i*3+2]=(Math.random()-.5)*210;}const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(positions,3));const m=new T.PointsMaterial({color:kind==='rain'?'#c9dcdd':'#fff9e9',size:kind==='rain'?1.6:.55,map:spriteTexture(kind),transparent:true,opacity:.7,depthWrite:false,sizeAttenuation:true});const mesh=new T.Points(g,m);mesh.frustumCulled=false;mesh.visible=false;scene.add(mesh);this.particles[kind]={mesh,positions};}
    const leafGeo=new T.PlaneGeometry(.28,.15);this.leaves=new T.InstancedMesh(leafGeo,new T.MeshStandardMaterial({color:'#c79145',side:T.DoubleSide,roughness:1}),100);this.leaves.instanceMatrix.setUsage(T.DynamicDrawUsage);this.leaves.frustumCulled=false;scene.add(this.leaves);
    this.ripples=new T.InstancedMesh(new T.RingGeometry(.8,1,20),new T.MeshBasicMaterial({color:'#d0e3d7',transparent:true,opacity:.16,depthWrite:false,side:T.DoubleSide}),85);this.ripples.frustumCulled=false;scene.add(this.ripples);
    this.pmrem=new T.PMREMGenerator(renderer);this.envScene=new T.Scene();this.envSky=this.sky.clone();this.envSky.scale.setScalar(.001);this.envScene.add(this.envSky);this.envTexture=null;
    this.puddles=new Puddles(scene,this.water);
    this.glows=new T.InstancedMesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({color:'#ffd08c',map:spriteTexture('glow'),transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending}),600);this.glows.rotation.x=-Math.PI/2;this.glows.frustumCulled=false;scene.add(this.glows);
    this.localLights=Array.from({length:8},()=>{const light=new T.PointLight('#ffcc8d',0,24,2);scene.add(light);return light;});
    this.visualHour=city.environment.hour;this.refreshSources();
  }
  refreshSources(){
    this.leafSources=[...this.city.entities.values()].filter(e=>['tree','cherry','park','grove','cottage','sage-house'].includes(e.type))
      .map(e=>e.pose?placementOf(e):{x:e.x*CELL,z:e.z*CELL});this.puddles.refresh(this.city);
    const sources=[...this.city.entities.values()].filter(e=>e.type==='lamp'||(e.type==='road'&&(e.x+e.z)%6===0));const m=new T.Matrix4();let count=0;
    for(const e of sources.slice(0,600)){m.compose(new T.Vector3(e.x*CELL,-e.z*CELL,.13),new T.Quaternion(),new T.Vector3(5,5,1));this.glows.setMatrixAt(count++,m);}this.glows.count=count;this.glows.instanceMatrix.needsUpdate=true;
    this.lightSources=[];
    const addLight=(position,intensity=34,distance=24)=>this.lightSources.push({position,intensity,distance});
    for(const e of this.city.entities.values()){
      if(e.type==='park'||e.type==='bridge-court'){
        const anchor=getTemplate(e.type).userData.anchors?.light;
        if(!anchor)continue;
        addLight(new T.Vector3(...placementAnchor(e,anchor)),e.type==='park'?18:12,e.type==='park'?8:6);
      }else if(['cafe','bakery','bookshop','mall','amusement','museum','pier'].includes(e.type)){
        const [w,d]=entityDimensions(e);
        if(e.pose){
          const p=placementOf(e),front=(d-1)*CELL/2;
          addLight(new T.Vector3(p.x+Math.sin(p.radians)*front,3.2,p.z+Math.cos(p.radians)*front));
        }else addLight(new T.Vector3((e.x+(w-1)/2)*CELL,3.2,(e.z+d-1)*CELL));
      }
    }
    for(let z=-96;z<=96;z+=24)for(const side of [-1,1])addLight(new T.Vector3(quayCenter(z,side,this.city.terrain)[0]+side*QUAY.width,2.8,z));
  }
  update(dt,camera,focus){
    this.time+=dt;const e=this.city.environment;
    const waterCenter=Math.round(focus.z/512)*512;
    if(this.waterTerrain!==this.city.terrain||this.waterCenter!==waterCenter){
      this.water.geometry.dispose();this.water.geometry=riverWaterGeometry(this.city.terrain,waterCenter);
      this.waterTerrain=this.city.terrain;this.waterCenter=waterCenter;
    }
    if(e.playing)e.hour=(e.hour+dt*.018*e.speed)%24;
    const hourDelta=T.MathUtils.euclideanModulo(e.hour-this.visualHour+12,24)-12;this.visualHour=T.MathUtils.euclideanModulo(this.visualHour+hourDelta*(1-Math.exp(-dt*1.8)),24);
    const h=this.visualHour,daylight=T.MathUtils.smoothstep(Math.sin((h-6)/24*Math.PI*2),-.12,.35),night=1-daylight;
    this.night=T.MathUtils.damp(this.night,night,1.8,dt);
    const cloudy=['cloudy','rain','snow','fog'].includes(e.weather),storm=e.weather==='rain';
    this.cloudiness=T.MathUtils.damp(this.cloudiness??(cloudy?1:0),cloudy?1:0,1,dt);
    this.wet=T.MathUtils.damp(this.wet,storm?1:0,storm?.28:.035,dt);
    this.snow=T.MathUtils.damp(this.snow,e.season==='winter'||e.weather==='snow'?1:0,.12,dt);
    const warm=Math.max(0,1-Math.abs(h-17)/2.1)*daylight;
    const angle=(h-6)/24*Math.PI*2,sunDir=new T.Vector3(Math.cos(angle)*.8,Math.max(.12,Math.sin(angle)),.48).normalize();
    this.sun.position.copy(focus).addScaledVector(sunDir,230);this.sun.target.position.copy(focus);this.sun.target.updateMatrixWorld();
    this.sun.color.set('#fff0d4').lerp(new T.Color('#ffb778'),warm*.48);this.sun.intensity=(3.1-this.cloudiness*2.3)*daylight+.13*night;
    this.hemi.intensity=1.1*daylight+.4*night;this.hemi.color.set('#c9e0e1').lerp(new T.Color('#7895bd'),night);
    this.skyUniforms.topColor.value.set('#93bac5').lerp(new T.Color('#829b9f'),this.cloudiness*.65).lerp(new T.Color('#d8af92'),warm*.45).lerp(new T.Color('#172c40'),night);
    this.skyUniforms.bottomColor.value.set('#e4e4d0').lerp(new T.Color('#b9c4be'),this.cloudiness*.65).lerp(new T.Color('#eed1a5'),warm*.55).lerp(new T.Color('#52616b'),night);
    this.skyUniforms.sunDirection.value.copy(sunDir);this.skyUniforms.uTime.value=this.time;this.skyUniforms.clouds.value=.15+this.cloudiness*.75;this.skyUniforms.night.value=night;this.sky.position.copy(camera.position);
    this.scene.fog.color.copy(this.skyUniforms.bottomColor.value);this.scene.fog.density=T.MathUtils.damp(this.scene.fog.density,e.weather==='fog'?.007:storm?.002:.00085,1,dt);
    this.water.material.uniforms.time.value+=dt*.32;this.water.material.uniforms.sunDirection.value.copy(sunDir);this.water.material.uniforms.sunColor.value.copy(this.sun.color).multiplyScalar(.12+daylight*.25);this.water.material.uniforms.waterColor.value.set(e.season==='winter'?'#658f88':'#267f73').lerp(new T.Color('#243b46'),night*.6);
    this.water.material.uniforms.distortionScale.value=.24+e.wind*.7;
    updateMaterials(e.season,this.night,this.wet,this.snow,this.time,e.wind,dt);
    this.puddles.update(this.wet,this.time,e.quality,focus);this.glows.visible=this.night>.02;this.glows.material.opacity=this.night*.3;
    const nearby=this.lightSources.slice().sort((a,b)=>a.position.distanceToSquared(focus)-b.position.distanceToSquared(focus));
    this.localLights.forEach((light,i)=>{
      const source=nearby[i];
      if(source){light.position.copy(source.position);light.distance=source.distance;}
      light.intensity=source?this.night*source.intensity:0;
    });
    for(const [kind,{mesh,positions}]of Object.entries(this.particles)){
      mesh.userData.amount=T.MathUtils.damp(mesh.userData.amount||0,e.weather===kind?1:0,1.3,dt);mesh.material.opacity=.7*mesh.userData.amount;mesh.visible=mesh.userData.amount>.01;if(!mesh.visible)continue;mesh.position.set(focus.x,0,focus.z);
      for(let i=0;i<positions.length;i+=3){positions[i+1]-=dt*(kind==='rain'?43:3.4);positions[i]+=dt*e.wind*(kind==='rain'?5:2)+Math.sin(this.time+i)*dt*.3;if(positions[i+1]<0){positions[i+1]=100;positions[i]=(Math.random()-.5)*210;positions[i+2]=(Math.random()-.5)*210;}if(positions[i]>105)positions[i]=-105;}mesh.geometry.attributes.position.needsUpdate=true;
    }
    const matrix=new T.Matrix4(),q=new T.Quaternion(),pos=new T.Vector3(),scale=new T.Vector3();
    this.leaves.visible=e.season==='autumn'&&this.leafSources.length>0;
    if(this.leaves.visible)for(let i=0;i<100;i++){const src=this.leafSources[i%this.leafSources.length],phase=(this.time*.22+i*.613)%1;pos.set(src.x+Math.sin(i+this.time*.7)*1.7+phase*e.wind*3,4.4*(1-phase)+.05,src.z+Math.cos(i+this.time*.6));q.setFromEuler(new T.Euler(this.time+i,phase*5,i));matrix.compose(pos,q,scale.setScalar(1));this.leaves.setMatrixAt(i,matrix);}this.leaves.instanceMatrix.needsUpdate=true;
    this.ripples.visible=storm;
    if(storm)for(let i=0;i<85;i++){const phase=(this.time*.9+i*.347)%1,z=focus.z+Math.sin(i*71.1)*70;
      const [west,east]=riverBanks(z,this.city.terrain),x=T.MathUtils.lerp(west+2,east-2,(Math.sin(i*23.7)+1)/2);
      pos.set(x,WATER_Y+.01,z);q.setFromEuler(new T.Euler(-Math.PI/2,0,0));matrix.compose(pos,q,scale.setScalar(phase*.5));this.ripples.setMatrixAt(i,matrix);}this.ripples.instanceMatrix.needsUpdate=true;
    const envKey=`${Math.floor(h/2)}-${e.weather}`;
    if(this.lastEnvHour!==envKey){this.lastEnvHour=envKey;const result=this.pmrem.fromScene(this.envScene,.04,.01,10);this.scene.environment=result.texture;this.envTexture?.dispose();this.envTexture=result;}
  }
}
