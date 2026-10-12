import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { registerArchitectureAsset } from './models.js';
import { CATALOG } from './catalog.js';

export async function loadArchitectureAssets(){
  const loader=new GLTFLoader(),loaded=[],failed=[],queue=CATALOG.filter(item=>!['road','bridge','path'].includes(item.id));
  loader.setPath(`${import.meta.env.BASE_URL}models/`);
  await Promise.all(Array.from({length:4},async()=>{while(queue.length){const item=queue.shift();try{
    const stem=item.id==='mall'?'shopping-gallery':item.id;
    const gltf=await loader.loadAsync(`${stem}.glb`);registerArchitectureAsset(item.id,gltf.scene,gltf.animations);loaded.push(item.id);
    const low=await loader.loadAsync(`${stem}_lod.glb`);registerArchitectureAsset(item.id,low.scene,[],true);
  }catch(error){failed.push(item.id);console.warn(`${item.name}的精细模型未完整加载`,error);}}}));
  return {loaded,failed};
}
