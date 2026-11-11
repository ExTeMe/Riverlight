import { test, expect } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { writeFile } from 'node:fs/promises';
import { createScene } from '../../src/baseline.js';

const viewport={width:1440,height:900};
test.use({viewport,deviceScaleFactor:1,video:{mode:'on',size:viewport}});

async function openScene(page,id,view){
  await page.goto(`/?scene=${id}`);
  await expect(page.locator('#loading')).toHaveCount(0,{timeout:60000});
  await page.locator(`[data-view="${view}"]`).click();
}

function canvasPoint(id,view,point){
  const {position,target}=createScene(id).cameras[view];
  const camera=new PerspectiveCamera(39,viewport.width/viewport.height,.5,4500);
  camera.position.fromArray(position);
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  const {x,y}=new Vector3(...point).project(camera);
  return {x:(1+x)*viewport.width/2,y:(1-y)*viewport.height/2};
}

function stats(page){
  return page.evaluate(()=>window.riverlight.getStats());
}

async function capture(page,info,label){
  // Let the renderer present the new road mesh and overlays before capturing.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:info.outputPath(`${label}.png`)});
}

async function riverSnapshot(page){
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出资源快照',exact:true}).click();
  const stream=await (await downloading).createReadStream();
  return JSON.parse(Buffer.concat(await stream.toArray()).toString());
}

test('ROAD-05 T02 keeps four turn orientations and rebuilds the cross-chunk seam',async({page},info)=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await openScene(page,'T02','corners');
  const before=await stats(page);
  expect(before).toMatchObject({entities:85,baseline:{id:'T02',sceneVersion:4}});
  await capture(page,info,'t02-corners');
  await page.keyboard.press('x');
  await page.locator('#scene').click({position:canvasPoint('T02','corners',[-64,.07,-24])});
  const removed=await stats(page);
  const revision=before.roadRevision;
  expect(removed).toMatchObject({entities:before.entities-1,roadRevision:revision+1,walkRoadRevision:revision+1,laneRoadRevision:revision+1});
  expect(removed.laneEdges).toBeLessThan(before.laneEdges);
  expect(removed.walkNodes).toBeLessThan(before.walkNodes);
  await capture(page,info,'t02-seam-removed');
  await page.keyboard.press('Control+z');
  const restored=await stats(page);
  expect(restored).toMatchObject({entities:before.entities,laneEdges:before.laneEdges,walkNodes:before.walkNodes,
    roadRevision:revision+2,walkRoadRevision:revision+2,laneRoadRevision:revision+2});
  await capture(page,info,'t02-seam-restored');
  await page.locator('[data-view="ramp"]').click();
  await capture(page,info,'t02-ramp');
  await writeFile(info.outputPath('t02-observations.json'),JSON.stringify({before,removed,restored},null,2));
  expect(errors).toEqual([]);
});

test('ROAD-05 T04 closes navigation after an approach is removed and reopens it on undo',async({page},info)=>{
  test.setTimeout(240000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await openScene(page,'T04','walk');
  await page.locator('[data-weather-id="day"]').click();
  const before=await stats(page);
  await page.keyboard.press('h');
  await page.keyboard.press('x');
  // The outermost west approach is centered 10 m from the deck edge.
  await page.locator('#scene').click({position:canvasPoint('T04','walk',[-28,.31,0]),timeout:10000});
  const revision=before.roadRevision;
  const removed=await stats(page);
  expect(removed).toMatchObject({entities:before.entities-1,roadRevision:revision+1,walkRoadRevision:revision+1,laneRoadRevision:revision+1});
  expect(removed.laneEdges).toBeLessThan(before.laneEdges);
  expect(removed.walkNodes).toBeLessThan(before.walkNodes);
  await capture(page,info,'t04-approach-removed');
  await page.keyboard.press('h');
  await page.locator('[data-view="river"]').click();
  await page.getByText('观察与记录',{exact:true}).click();
  const closed=await riverSnapshot(page);
  expect(closed.river.bridges).toMatchObject([{passable:false,reason:'approach'}]);
  expect(closed.river.reaches).toHaveLength(2);
  const stopZ=closed.river.reaches[0][1];
  expect(stopZ).toBeLessThan(closed.river.bridges[0].bounds.minZ-closed.river.radius);
  const waiting=page.getByText('航道受阻 · 船只正在等待',{exact:true});
  await expect(waiting).toBeVisible({timeout:70000});
  const stopped=(await stats(page)).sailing;
  expect(stopped).toMatchObject({speed:0,direction:1,state:'waiting',blocked:true});
  expect(stopped.point[2]).toBeCloseTo(stopZ,5);
  await page.screenshot({path:info.outputPath('t04-boat-waiting.png')});
  await page.keyboard.press('Control+z');
  const reopened=await riverSnapshot(page);
  expect(reopened).toMatchObject({entities:before.entities,laneEdges:before.laneEdges,walkNodes:before.walkNodes,
    roadRevision:revision+2,walkRoadRevision:revision+2,laneRoadRevision:revision+2});
  expect(reopened.river.bridges).toMatchObject([{passable:true,bottomY:1.23}]);
  expect(reopened.river.reaches).toEqual([[-105,105]]);
  const exitZ=reopened.river.bridges[0].bounds.maxZ+reopened.river.radius;
  expect(reopened.sailing).toMatchObject({direction:1,blocked:false});
  expect(reopened.sailing.point[2]).toBeGreaterThanOrEqual(stopZ);
  expect(reopened.sailing.point[2]).toBeLessThan(exitZ);
  await expect.poll(async()=> (await stats(page)).sailing.point[2],{timeout:60000}).toBeGreaterThan(exitZ);
  const crossed=(await stats(page)).sailing;
  expect(crossed).toMatchObject({direction:1,state:'sailing',blocked:false});
  await page.screenshot({path:info.outputPath('t04-boat-crossed.png')});
  await page.locator('[data-view="walk"]').click();
  await capture(page,info,'t04-approach-restored');
  await writeFile(info.outputPath('t04-observations.json'),JSON.stringify({before,closed,stopped,reopened,crossed},null,2));
  expect(errors).toEqual([]);
});
