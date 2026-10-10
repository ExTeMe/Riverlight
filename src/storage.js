const dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open('riverlight-cities',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('cities',{keyPath:'id'});
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
async function operation(mode,fn){const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction('cities',mode),request=fn(tx.objectStore('cities'));let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存已中止'));});}
export const saves={
  list:()=>operation('readonly',s=>s.getAll()), load:id=>operation('readonly',s=>s.get(id)),
  write:(id,city,camera)=>operation('readwrite',s=>s.put({id,name:city.name,date:Date.now(),data:city.snapshot(),camera})),
};
export function download(name,content,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
