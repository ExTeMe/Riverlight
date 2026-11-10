import { test, expect } from '@playwright/test';
import { createBaseline } from '../../src/baseline.js';

// Software-rendered browsers need time for input between expensive WebGL frames.
// Keep real assets and high-quality effects at reduced test pixel density.
// These are interaction checks, not visual-quality or performance measurements.
test.use({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 0.5 });
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 1000);
    window.cancelAnimationFrame = id => clearTimeout(id);
  });
});

async function ready(page) {
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 60000 });
  await page.waitForFunction(() => !!window.riverlight);
}

// Saving completes asynchronously before location.assign, including same-URL reloads.
// Observe the new document before checking readiness; the old one is already ready.
async function navigate(page, button) {
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    button.click(),
  ]);
  await ready(page);
}

test('T01 parcel import preserves old files and restores an angled building on reload', async ({page}, testInfo) => {
  test.setTimeout(180000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?scene=T01');await ready(page);
  const importCity=async input=>{
    await page.locator('#import-file').setInputFiles({name:'city.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});
  };
  const legacy=createBaseline();
  await importCity(legacy);
  await expect(page.locator('#city-name')).toHaveText(legacy.city.name);
  const saved=await page.evaluate(async()=>{
    const {createSaveStore}=await import('/src/storage.js');
    const store=createSaveStore({name:'riverlight-scenes-T01-standard'});
    const archived=(await store.list()).find(row=>row.kind==='original');
    return {original:await store.load(archived.id),current:await store.load('autosave')};
  });
  expect(saved.original.input).toEqual(legacy);
  expect(saved.current.data).toMatchObject({version:3,terrain:legacy.city.terrain});
  expect(saved.current.data.parcels.length).toBeGreaterThan(0);

  const a=18*Math.PI/180,x=-84.25+.75*Math.cos(a)-1.25*Math.sin(a),z=-30.5-.75*Math.sin(a)-1.25*Math.cos(a);
  const city={...saved.current.data,name:'斜角庭院',nextId:2,
    parcels:[{id:'angled-lot',x:-84.25,z:-30.5,width:16,depth:18,angle:18}],
    entities:[{id:1,type:'cottage',color:2,parcelId:'angled-lot',offsetX:.75,offsetZ:-1.25,angle:17}]};
  await importCity({city,camera:{position:[x+14,19,z+23],target:[x,0,z]}});
  await expect(page.locator('#city-name')).toHaveText(city.name);
  await page.goto('/?scene=T01&resume=1');await ready(page);
  await expect(page.locator('#city-name')).toHaveText(city.name);
  await expect.poll(()=>page.evaluate(()=>window.riverlight.getStats().drawCalls)).toBeGreaterThan(0);
  await page.locator('#scene').click({position:{x:480,y:320}});
  await expect(page.locator('#selected-name')).toHaveText('河畔小屋');
  await page.screenshot({path:testInfo.outputPath('angled-lot.png')});

  await importCity({city:{...city,entities:[{...city.entities[0],offsetX:100}]}});
  await expect(page.getByRole('status')).toContainText('无法导入');
  await page.getByRole('button',{name:'我的城市',exact:true}).click();
  const exported=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出城市',exact:true}).click();
  const download=await exported;
  expect(JSON.parse(Buffer.concat(await (await download.createReadStream()).toArray()).toString()).city).toEqual(city);
  expect(errors).toEqual([]);
});

test('scene exploration preserves the original city and supports weather, views, reset and resume', async ({ page }) => {
  test.setTimeout(240000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await ready(page);
  await page.getByRole('button',{name:'保存城市 Ctrl+S',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText('已保存');
  const original=await page.evaluate(async()=>{
    const {saves}=await import('/src/storage.js');return (await saves.load('autosave')).data;
  });
  await page.getByRole('button',{name:'探索场景',exact:true}).click();
  await expect(page.locator('.scene-card')).toHaveCount(7);
  await navigate(page, page.locator('[data-scene="T06"]'));
  await expect(page.locator('.scene-panel h2')).toHaveText('河光小街');
  expect((await page.evaluate(()=>window.riverlight.getStats())).entities).toBe(135);
  await page.screenshot({path:'test-results/t06-street.png'});
  for(const [id,weather,season] of [['day','clear','summer'],['dusk','clear','summer'],['rain','rain','summer'],['autumn','clear','autumn'],['snow','snow','winter']]){
    await page.locator(`[data-weather-id="${id}"]`).click();
    await expect.poll(()=>page.evaluate(()=>window.riverlight.getStats().environment)).toMatchObject({weather,season,playing:false});
  }
  await page.locator('[data-weather-id="rain"]').click();
  await page.locator('[data-view="near"]').click();
  await page.getByText('观察与记录',{exact:true}).click();
  const evidenceDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出资源快照',exact:true}).click();
  const download=await evidenceDownload;
  const evidence=JSON.parse(await (await download.createReadStream()).toArray().then(chunks=>Buffer.concat(chunks).toString()));
  expect(evidence.scene).toMatchObject({id:'T06',version:3});
  expect(evidence.drawCalls).toBeGreaterThan(0);
  expect(evidence.rendererMemory.geometries).toBeGreaterThan(0);
  expect(evidence.frameTime).toBeNull();
  await navigate(page, page.getByRole('button',{name:'保存并重载',exact:true}));
  expect((await page.evaluate(()=>window.riverlight.getStats())).environment.weather).toBe('rain');
  await navigate(page, page.getByRole('button',{name:'重置场景',exact:true}));
  expect((await page.evaluate(()=>window.riverlight.getStats())).environment.weather).toBe('clear');
  await navigate(page, page.getByRole('button',{name:'返回我的城市',exact:true}));
  const restored=await page.evaluate(async()=>{
    const {saves}=await import('/src/storage.js');return (await saves.load('autosave')).data;
  });
  expect(restored).toEqual(original);
  await expect(page.locator('.scene-panel')).toHaveCount(0);
  expect(errors).toEqual([]);
});

for(const [id,count] of [['T01',80],['T02',76],['T03',61],['T04',60],['T05',78],['T06',135],['T07',841]])
test(`${id} renders its fixed scene`, async ({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`/?scene=${id}`);await ready(page);
    expect((await page.evaluate(()=>window.riverlight.getStats())).entities).toBe(count);
    await expect(page.locator('.scene-panel')).toBeVisible();
    if(id==='T01'){
      await page.getByText('观察与记录',{exact:true}).click();
      const result=page.waitForEvent('download');
      await page.getByRole('button',{name:'导出资源快照',exact:true}).click();
      const download=await result;
      const evidence=JSON.parse(Buffer.concat(await (await download.createReadStream()).toArray()).toString());
      expect(evidence.scene).toMatchObject({id:'T01',version:2});
      const [west,east]=evidence.spatial.samples;
      expect(west.objects).toHaveLength(1);
      expect(west.objects[0]).toMatchObject({type:'library',bounds:{minX:-70,maxX:-58,minZ:-16,maxZ:-6}});
      expect(east.objects.map(e=>e.type)).toEqual(['library','office','mall']);
      expect(east.objects[0]).toEqual(west.objects[0]);
      expect(evidence.spatial).toMatchObject({land:{groundY:0,waterY:null},river:{groundY:null,waterY:-.4}});
      await page.screenshot({path:'test-results/t01-world-space.png'});
    }
  expect(errors).toEqual([]);
});

test('density switching uses distinct layouts',async({page})=>{
  test.setTimeout(180000);
  await page.goto('/?scene=T07&density=sparse');await ready(page);
  await navigate(page, page.locator('[data-density="dense"]'));
  expect((await page.evaluate(()=>window.riverlight.getStats())).entities).toBe(1053);
  await navigate(page, page.locator('[data-density="sparse"]'));
  expect((await page.evaluate(()=>window.riverlight.getStats())).entities).toBe(78);
});
