import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3 } from 'three';
import { City } from '../src/core.js';
import { chooseBridgeStyle, continuousBridgeAppearance, bridgeAppearances } from '../src/bridge-styles.js';
import { createAlignmentMesh } from '../src/roads.js';
import { material } from '../src/models.js';

test('short wooded, traditional, urban, and long crossings choose different structures',()=>{
  const site={span:22,straight:true,complete:true,passable:true};
  assert.equal(chooseBridgeStyle(site,[{type:'tree'},{type:'pine'},{type:'park'}]),'timber');
  assert.equal(chooseBridgeStyle(site,[{type:'library'}]),'stone');
  assert.equal(chooseBridgeStyle(site,[{type:'office'},{type:'apartment'}]),'girder');
  assert.equal(chooseBridgeStyle({...site,span:72}),'arch');
  assert.equal(chooseBridgeStyle({...site,span:72,straight:false}),'girder');
  assert.equal(chooseBridgeStyle({...site,span:72,passable:false}),'girder');
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
