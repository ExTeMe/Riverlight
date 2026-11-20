import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { registerArchitectureAsset } from './models.js';
import { CATALOG } from './catalog.js';

export async function loadArchitectureAssets(urls={}){
  const loader=new GLTFLoader(),loaded=[],failed=[],queue=CATALOG.filter(item=>!['road','bridge','path'].includes(item.id));
  await Promise.all(Array.from({length:4},async()=>{while(queue.length){const item=queue.shift();try{
    const stem=`${import.meta.env.BASE_URL}models/${item.id==='mall'?'shopping-gallery':item.id}`;
    const [nearURL,farURL]=urls[item.id]??[`${stem}.glb`,`${stem}_lod.glb`];
    const gltf=await loader.loadAsync(nearURL);registerArchitectureAsset(item.id,gltf.scene,gltf.animations);loaded.push(item.id);
    const low=await loader.loadAsync(farURL);registerArchitectureAsset(item.id,low.scene,[],true);
  }catch(error){failed.push(item.id);console.warn(`${item.name}的精细模型未完整加载`,error);}}}));
  return {loaded,failed};
}
