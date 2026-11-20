import { createSaveStore } from './storage.js';

let store;
self.onmessage=async ({data:{name,id,parts,camera,allowRiverfront}})=>{
  try {
    store??=createSaveStore({name,allowRiverfront});
    const city=JSON.parse(await new Blob(parts).text());
    await store.write(id,city,camera);
    self.postMessage({});
  }catch(error){self.postMessage({error:error.message||'后台保存失败'});}
};
