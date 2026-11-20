const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));

// Build transferable JSON in bounded slices. The worker does the full decode and database write.
export async function encodeSnapshot(city,current,{yieldTurn=yieldTask,batchSize=128,sliceBudget=4}={}){
  if(!current())return null;
  const encoder=new TextEncoder(),header=JSON.stringify(city.snapshotHeader());
  const entities=[],parcels=[],entityBatch=[],parcelBatch=[];
  function append(parts,batch){
    if(!batch.length)return;
    parts.push(encoder.encode((parts.length?',':'')+batch.map(row=>JSON.stringify(row)).join(',')).buffer);
    batch.length=0;
  }
  let count=0,slice=performance.now();
  for(const {entity,parcel} of city.snapshotEntries()){
    if(entity)entityBatch.push(entity);
    if(parcel)parcelBatch.push(parcel);
    if(++count<batchSize)continue;
    append(entities,entityBatch);append(parcels,parcelBatch);count=0;
    if(performance.now()-slice>=sliceBudget){
      await yieldTurn();
      if(!current())return null;
      slice=performance.now();
    }
  }
  append(entities,entityBatch);append(parcels,parcelBatch);
  const text=value=>encoder.encode(value).buffer;
  return [text(header.slice(0,-1)+',"entities":['),...entities,text('],"parcels":['),...parcels,text(']}')];
}

export function createSaveWriter(store,name,{allowRiverfront=false}={}){
  let worker,unavailable=false;
  return async (id,parts,camera)=>{
    if(!worker&&!unavailable&&typeof Worker!=='undefined'){
      try{worker=new Worker(new URL('./save-worker.js',import.meta.url),{type:'module'});}
      catch{unavailable=true;}
    }
    if(!worker)return store.write(id,JSON.parse(await new Blob(parts).text()),camera);
    return new Promise((resolve,reject)=>{
      worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve();
      worker.onerror=event=>{
        worker.terminate();worker=undefined;unavailable=true;
        reject(new Error(event.message||'后台保存失败'));
      };
      worker.postMessage({name,id,parts,camera,allowRiverfront},parts);
    });
  };
}

export class Autosave {
  constructor({capture,write,available,onStart,onFinish,delay=1100}){
    Object.assign(this,{capture,write,available,onStart,onFinish,delay});
    this.revision=0;this.saved=0;
  }
  mark(){this.revision++;this.schedule();}
  cancel(){clearTimeout(this.timer);this.timer=null;}
  reset(){this.cancel();this.saved=++this.revision;}
  schedule(){
    this.cancel();
    if(this.saved!==this.revision&&this.available())this.timer=setTimeout(()=>this.flush(),this.delay);
  }
  async flush(force=false){
    this.cancel();
    while(this.running)if(await this.running===false)return false;
    if(!this.available())return false;
    if(!force&&this.saved===this.revision)return true;
    do {
      const revision=this.revision;
      this.running=this.save(revision).finally(()=>{
        this.running=null;
        if(!this.timer&&revision!==this.revision)this.schedule();
      });
      const result=await this.running;
      if(result!==null||!force)return result!==false;
    }while(this.available());
    return false;
  }
  async save(revision){
    const current=()=>revision===this.revision&&this.available();
    try {
      const payload=await this.capture(current);
      if(!payload||!current())return null;
      this.onStart();
      await this.write(payload);
      this.saved=Math.max(this.saved,revision);
      this.onFinish();
      return true;
    }catch(error){this.onFinish(error);return false;}
  }
}
