import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Scene } from 'three';
import { City } from '../src/core.js';
import { chooseBridgeStyle, continuousBridgeAppearance, bridgeAppearances } from '../src/bridge-styles.js';
import { createAlignmentMesh } from '../src/roads.js';
import { material } from '../src/models.js';
import { World } from '../src/world.js';

test('short wooded, traditional, urban, and long crossings choose different structures',()=>{
  const site={span:22,straight:true,complete:true,passable:true};
  assert.equal(chooseBridgeStyle(site,[{type:'tree'},{type:'pine'},{type:'park'}]),'timber');
  assert.equal(chooseBridgeStyle(site,[{type:'library'}]),'stone');
  assert.equal(chooseBridgeStyle(site,[{type:'office'},{type:'apartment'}]),'girder');
  assert.equal(chooseBridgeStyle({...site,span:72}),'arch');
  assert.equal(chooseBridgeStyle({...site,span:72,straight:false}),'girder');
  assert.equal(chooseBridgeStyle({...site,span:72,passable:false}),'girder');
});

test('bridge preview follows the draft and removes its geometry when blocked or cancelled',()=>{
  const city=new City();city.terrain='strait';
  const world=new World(new Scene(),city);
  const draft=height=>city.planRoadAlignment({start:[-118,height,0,0],end:[118,height,0,0],elevated:true});
  function preview(height,error=null){
    const {geometry,structure}=draft(height);
    const appearance=continuousBridgeAppearance(geometry,structure,city.terrain,()=>[]);
    world.showRoadPreviews([geometry.samples],error,null,[],[{appearance,samples:geometry.samples}]);
    return world.bridgePreview.children[0];
  }
  const first=preview(7),initial=new Box3().setFromObject(first);
  let disposed=false;first.geometry.addEventListener('dispose',()=>{disposed=true;});
  const raised=preview(8);
  assert.ok(disposed);
  assert.ok(Math.abs(new Box3().setFromObject(raised).max.y-initial.max.y-1)<1e-5);
  assert.equal(preview(8,'blocked'),undefined);
  assert.ok(preview(8));
  world.clearPreview();
  assert.equal(world.bridgePreview.children.length,0);
  assert.equal(city.entities.size,0);
  world.clear();
});

test('a wide bridge can carry an arch without lowering its deck or changing its ports',()=>{
  const city=new City();city.terrain='strait';
  const {entity,error}=city.editRoadAlignment({start:[-118,7,0,0],end:[118,7,0,0],elevated:true});
  assert.ok(entity,error);
  const network=city.roadNetwork,segment=network.segments.get(entity.id);
  const appearance=bridgeAppearances(network,city.terrain,b=>city.queryFootprints(b)).get(entity.id);
  assert.equal(appearance.key,'arch');
  const plain=createAlignmentMesh(segment.geometry,segment.ports,material,segment.structure,city.terrain);
  const styled=createAlignmentMesh(segment.geometry,segment.ports,material,segment.structure,city.terrain,appearance);
  const a=new Box3().setFromObject(plain),b=new Box3().setFromObject(styled);
  assert.equal(a.min.y,b.min.y);
  assert.ok(b.max.y>a.max.y+5);
  assert.ok(network.bridges.crossings[0].passable);
  for(const model of [plain,styled])for(const mesh of model.children)mesh.geometry.dispose();

  const upper={id:100,type:'road',alignment:{start:[-5,12,-40,90],end:[-5,12,40,90],elevated:true}};
  const obstructed=continuousBridgeAppearance(segment.geometry,segment.structure,city.terrain,()=>[upper],entity.id);
  assert.equal(obstructed.key,'girder');
});
