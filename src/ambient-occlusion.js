import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
// Transparent atmospheric meshes must not become solid surfaces in the AO depth pass.
export class CityAOPass extends GTAOPass {
  constructor(scene,camera,width,height,atmosphere){super(scene,camera,width,height);this.atmosphere=atmosphere;}
  render(...args){const objects=[this.atmosphere.sky,this.atmosphere.water,this.atmosphere.puddles.mesh,this.atmosphere.ripples,this.atmosphere.leaves,this.atmosphere.glows];const visibility=objects.map(o=>o.visible);objects.forEach(o=>o.visible=false);try{super.render(...args);}finally{objects.forEach((o,i)=>o.visible=visibility[i]);}}
}
