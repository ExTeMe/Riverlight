import assert from 'node:assert/strict';
import test from 'node:test';
import { Autosave, encodeSnapshot } from '../src/autosave.js';
import { createScene } from '../src/baseline.js';
import { City } from '../src/core.js';

test('sliced save matches the synchronous mixed-road and parcel snapshot and cancels after an edit',async()=>{
  const city=new City(createScene('T02').city);
  let yields=0;
  const options={batchSize:8,sliceBudget:0,yieldTurn:async()=>{yields++;}};
  const parts=await encodeSnapshot(city,()=>true,options);
  assert.ok(yields>1);
  assert.deepEqual(JSON.parse(await new Blob(parts).text()),city.snapshot());
  let current=true;
  assert.equal(await encodeSnapshot(city,()=>current,{...options,yieldTurn:async()=>{current=false;}}),null);
});

test('clean flushes skip writes and edits during capture or failure remain saveable',async()=>{
  const writes=[];let updateDuringCapture=false,fail=false,starts=0;
  const autosave=new Autosave({available:()=>true,delay:60000,
    capture:async current=>{
      if(updateDuringCapture){updateDuringCapture=false;autosave.mark();}
      return current()?autosave.revision:null;
    },
    write:async value=>{if(fail)throw new Error('unavailable');writes.push(value);},
    onStart:()=>{starts++;},onFinish:()=>{},
  });
  try {
    assert.ok(await autosave.flush());assert.equal(starts,0);
    autosave.mark();autosave.mark();updateDuringCapture=true;
    assert.ok(await autosave.flush());assert.deepEqual(writes,[]);
    fail=true;assert.equal(await autosave.flush(),false);assert.deepEqual(writes,[]);
    fail=false;assert.ok(await autosave.flush());assert.deepEqual(writes,[3]);
    assert.ok(await autosave.flush());assert.deepEqual(writes,[3]);
    autosave.mark();autosave.reset();assert.ok(await autosave.flush());assert.deepEqual(writes,[3]);
    assert.ok(await autosave.flush(true));assert.equal(writes.length,2);
  }finally{autosave.cancel();}
});
