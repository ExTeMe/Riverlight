import * as T from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CELL } from './catalog.js';

/** One masked reflection pass for all road puddles. */
export class Puddles {
  constructor(scene,water){
    this.water=water;this.canvas=document.createElement('canvas');this.canvas.width=this.canvas.height=1024;
    this.mask=new T.CanvasTexture(this.canvas);this.mask.colorSpace=T.NoColorSpace;
    const shader={...Reflector.ReflectorShader,uniforms:{...Reflector.ReflectorShader.uniforms,puddleMask:{value:this.mask},wetness:{value:0},uTime:{value:0}},
      vertexShader:`uniform mat4 textureMatrix;varying vec4 vReflection;varying vec2 vMap;void main(){vMap=uv;vReflection=textureMatrix*vec4(position,1.);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform sampler2D tDiffuse;uniform sampler2D puddleMask;uniform float wetness;uniform float uTime;varying vec4 vReflection;varying vec2 vMap;
      void main(){float m=texture2D(puddleMask,vMap).r;float opacity=smoothstep(.1,.7,m)*wetness*.62;if(opacity<.015)discard;vec4 reflected=vReflection;reflected.xy+=vec2(sin(vMap.y*300.+uTime*2.),cos(vMap.x*330.+uTime*1.7))*.00015*reflected.w;vec3 col=texture2DProj(tDiffuse,reflected).rgb;gl_FragColor=vec4(mix(col,vec3(.12,.17,.18),.12),opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`};
    this.mesh=new Reflector(new T.PlaneGeometry(1,1),{textureWidth:512,textureHeight:512,clipBias:.002,shader,multisample:0});
    this.mesh.rotation.x=-Math.PI/2;this.mesh.position.y=.12;this.mesh.material.transparent=true;this.mesh.material.depthWrite=false;this.mesh.renderOrder=2;this.mesh.visible=false;this.mesh.material.uniforms.puddleMask.value=this.mask;
    const renderReflection=this.mesh.onBeforeRender;
    this.mesh.onBeforeRender=(renderer,world,camera,...rest)=>{if(world.overrideMaterial)return;const visible=this.water.visible;this.water.visible=false;try{renderReflection.call(this.mesh,renderer,world,camera,...rest);}finally{this.water.visible=visible;}};
    const renderWater=water.onBeforeRender;
    water.onBeforeRender=(renderer,world,camera,...rest)=>{if(world.overrideMaterial)return;const visible=this.mesh.visible;this.mesh.visible=false;try{renderWater.call(water,renderer,world,camera,...rest);}finally{this.mesh.visible=visible;}};
    scene.add(this.mesh);
  }
  refresh(city,focus=this.center||{x:0,z:0}){
    this.city=city;this.center={x:Math.round(focus.x/128)*128,z:Math.round(focus.z/128)*128};
    const size=512;this.mesh.scale.set(size,size,1);this.mesh.position.x=this.center.x;this.mesh.position.z=this.center.z;
    const c=this.canvas,ctx=c.getContext('2d'),s=c.width/size;ctx.fillStyle='black';ctx.fillRect(0,0,c.width,c.height);
    for(const e of city.entities.values())if(e.type==='road'&&e.id%3!==0){
      const x=(e.x*CELL-this.center.x+size/2)*s,z=(e.z*CELL-this.center.z+size/2)*s;if(x<0||z<0||x>c.width||z>c.height)continue;
      const r=(.65+(e.id%5)*.13)*s,g=ctx.createRadialGradient(x,z,.1,x,z,r);g.addColorStop(0,'white');g.addColorStop(.65,'#ddd');g.addColorStop(1,'black');
      ctx.fillStyle=g;ctx.save();ctx.translate(x,z);ctx.scale(1,.65);ctx.translate(-x,-z);ctx.beginPath();ctx.arc(x,z,r,0,Math.PI*2);ctx.fill();ctx.restore();
    }
    this.mask.needsUpdate=true;
  }
  update(wet,time,quality,focus){if(this.city&&(Math.abs(focus.x-this.center.x)>128||Math.abs(focus.z-this.center.z)>128))this.refresh(this.city,focus);this.mesh.visible=wet>.04&&quality==='high';this.mesh.material.uniforms.wetness.value=wet;this.mesh.material.uniforms.uTime.value=time;}
}
