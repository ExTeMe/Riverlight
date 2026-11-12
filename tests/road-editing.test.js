import test from 'node:test';
import assert from 'node:assert/strict';
import {City} from '../src/core.js';
import {alignmentGeometry,readAlignment} from '../src/road-alignment.js';
import {REQUIRED_UNDERSIDE} from '../src/bridges.js';
import {ROAD_DECK_BOTTOM} from '../src/elevated-roads.js';

function chain(){
  const city=new City();
  const points=[[-100,0,-100,90],[-100,2,-60,90],[-100,2,-20,90],[-100,0,20,90]];
  const roads=points.slice(1).map((end,i)=>city.editRoadAlignment({start:points[i],end,elevated:true}).entity);
  assert.ok(roads.every(Boolean));return {city,roads};
}
const lift=(alignment,delta)=>({...alignment,start:alignment.start.map((v,i)=>i===1?v+delta:v),end:alignment.end.map((v,i)=>i===1?v+delta:v)});

test('lifting a connected span updates both neighbouring slopes in one reversible transaction',()=>{
  const {city,roads}=chain(),before=city.snapshot(),revision=city.roadRevision;
  const raw=lift(roads[1].alignment,.5),plan=city.planRoadAlignment(raw,roads[1].id,{connected:true});
  assert.equal(plan.error,null);assert.equal(plan.changes.length,3);
  assert.deepEqual(city.snapshot(),before,'preview must not mutate the city');
  assert.ok(city.editRoadAlignment(raw,roads[1].id,{connected:true}).changed);
  assert.equal(city.roadRevision,revision+1);
  assert.equal(city.entities.get(roads[0].id).alignment.end[1],2.5);
  assert.equal(city.entities.get(roads[2].id).alignment.start[1],2.5);
  assert.equal(city.roadNetwork.segments.get(roads[1].id).ports.length,2);
  const saved=city.snapshot();assert.deepEqual(new City(saved).snapshot(),saved);
  city.undo();assert.deepEqual(city.snapshot().entities.sort((a,b)=>a.id-b.id),before.entities);
  city.redo();assert.deepEqual(city.snapshot().entities,saved.entities);
});

test('an invalid connected edit fails atomically and route lift propagates to the complete component',()=>{
  const {city,roads}=chain(),before=city.snapshot();
  const invalid=city.editRoadAlignment(lift(roads[1].alignment,6),roads[1].id,{connected:true});
  assert.equal(invalid.changed,false);assert.match(invalid.error,/坡度/);assert.deepEqual(city.snapshot(),before);
  assert.ok(city.editRoadAlignment(lift(roads[1].alignment,1),roads[1].id,{connected:true,wholeRoute:true}).changed);
  for(const road of roads)assert.deepEqual(city.entities.get(road.id).alignment,lift(road.alignment,1));
  assert.equal(city.roadNetwork.segments.get(roads[1].id).ports.length,2);
});

test('automatic bridge slopes keep both ground ports and put the high plateau above water',()=>{
  const city=new City(),height=Math.ceil((REQUIRED_UNDERSIDE-ROAD_DECK_BOTTOM+.1)*10)/10;
  const raw={start:[-60,.04,0,0],end:[60,.04,0,0],elevated:true,deckHeight:height};
  const result=city.editRoadAlignment(raw);assert.ok(result.changed,result.error);
  const geometry=alignmentGeometry(result.entity.alignment);
  assert.deepEqual(geometry.samples[0].point,raw.start.slice(0,3));
  assert.deepEqual(geometry.samples.at(-1).point,raw.end.slice(0,3));
  for(let i=1;i<geometry.samples.length;i++){
    const a=geometry.samples[i-1].point,b=geometry.samples[i].point;
    assert.ok(Math.abs(b[1]-a[1])/Math.hypot(b[0]-a[0],b[2]-a[2])<=.12+1e-9);
  }
  assert.ok(city.roadNetwork.bridges.crossings.every(c=>c.passable));
  const saved=city.snapshot();assert.equal(saved.version,8);assert.deepEqual(new City(saved).snapshot(),saved);
  assert.throws(()=>city.snapshot(7),/无法导出/);
  assert.throws(()=>new City({...saved,version:7}),/自动桥坡需要 v8/);
  const higher=city.editRoadAlignment({...raw,deckHeight:height+.5},result.entity.id,{connected:true});
  assert.ok(higher.changed,higher.error);assert.deepEqual(higher.entity.alignment.start,raw.start);
  city.undo();assert.equal(city.entities.get(result.entity.id).alignment.deckHeight,height);
});

test('short bridge approaches and malformed profiles are rejected without destroying old data',()=>{
  const city=new City(),before=city.snapshot();
  const result=city.editRoadAlignment({start:[-110,0,-80,0],end:[-90,0,-80,0],elevated:true,deckHeight:4});
  assert.match(result.error,/引桥长度不足/);assert.deepEqual(city.snapshot(),before);
  for(const deckHeight of [NaN,-1,33,'2'])assert.throws(()=>readAlignment({start:[-110,0,-80,0],end:[-90,0,-80,0],elevated:true,deckHeight}),/桥面高度/);
  const old=city.editRoadAlignment({start:[-110,0,-80,0],end:[-90,0,-80,0]});assert.ok(old.changed);
  const v7=city.snapshot(7);assert.deepEqual(new City(v7).entities.get(old.entity.id).alignment,old.entity.alignment);
});

test('right-angle approaches use actual curvature and do not reject valid geometry by chord angle',()=>{
  const a=readAlignment({start:[-180,0,-100,90],end:[-80,0,-100,270]});
  const geometry=alignmentGeometry(a);assert.equal(geometry.error,null);assert.ok(geometry.minRadius>=6);
  assert.ok(Math.abs(geometry.samples[0].direction[0])<1e-12);
  assert.ok(Math.abs(geometry.samples[0].direction[1]-1)<1e-12);
  const hairpin=alignmentGeometry(readAlignment({start:[-180,0,-100,180],end:[-160,0,-100,0]}));
  assert.ok(hairpin.error);
});

test('explicit street clearing is previewed and committed with the road, while buildings stay protected',()=>{
  const city=new City();
  const path=city.place('path',-25,-20),tree=city.place('tree',-23,-20);
  assert.ok(path&&tree);
  const raw={start:[-110,0,-80,0],end:[-80,0,-80,0]},before=city.snapshot();
  assert.ok(city.planRoadAlignment(raw).error);
  const plan=city.planRoadAlignment(raw,undefined,{clearStreet:true});
  assert.equal(plan.error,null);assert.equal(plan.removed.length,2);assert.deepEqual(city.snapshot(),before);
  const result=city.editRoadAlignment(raw,undefined,{clearStreet:true});assert.ok(result.changed);
  assert.equal(city.entities.size,1);city.undo();
  assert.deepEqual(city.snapshot().entities.sort((a,b)=>a.id-b.id),before.entities);
  const other=new City();assert.ok(other.place('cottage',-25,-20));
  const rejected=other.editRoadAlignment(raw,undefined,{clearStreet:true});
  assert.ok(rejected.error);assert.equal(other.entities.size,1);
});

test('whole-route elevation preserves fixed grid junctions while reshaping the connecting slopes',()=>{
  // Attach grid roads at each outer end (grid edges are 2 m off their centres).
  const c=new City();assert.ok(c.place('road',-25,-25));assert.ok(c.place('road',-25,6));
  const p=[[-100,.04,-98,90],[-100,2,-58,90],[-100,2,-18,90],[-100,.04,22,90]];
  const entities=p.slice(1).map((end,i)=>c.editRoadAlignment({start:p[i],end,elevated:true}).entity);
  assert.ok(entities.every(Boolean));
  const result=c.editRoadAlignment(lift(entities[1].alignment,.5),entities[1].id,{connected:true,wholeRoute:true,routeDelta:.5});
  assert.ok(result.changed,result.error);
  assert.equal(c.entities.get(entities[0].id).alignment.start[1],.04);
  assert.equal(c.entities.get(entities[2].id).alignment.end[1],.04);
  assert.ok(entities.every(e=>c.roadNetwork.segments.get(e.id).ports.length===2));
  assert.deepEqual(new City(c.snapshot()).snapshot(),c.snapshot());
});
