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

test('T01 edits parcel and building transforms independently through the UI', async ({page},testInfo)=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?scene=T01');await ready(page);
  const editor=page.getByRole('form',{name:'地块与建筑编辑'});
  const field=name=>editor.getByLabel(name,{exact:true});
  const confirm=editor.getByRole('button',{name:'确认'});
  const read=()=>page.evaluate(async()=>{
    const {createSaveStore}=await import('/src/storage.js');
    return (await createSaveStore({name:'riverlight-scenes-T01-standard'}).load('autosave'))?.data;
  });
  const save=async()=>{
    await page.getByRole('button',{name:'保存城市 Ctrl+S',exact:true}).click();
    await expect(page.getByRole('status')).toHaveText('这一刻，已经为你保存');
    return read();
  };
  const selected=page.locator('.selection-panel');
  await page.getByRole('button',{name:'建造河畔小屋',exact:true}).click();
  await expect(field('15° 角度吸附')).toBeChecked();
  await field('中心 X').fill('-120.24');await field('中心 Z').fill('48.24');
  await field('宽度').fill('14');await field('进深').fill('14');await field('地块角度 °').fill('19');
  await expect(confirm).toBeEnabled();
  await page.screenshot({path:testInfo.outputPath('parcel-placement.png')});
  await confirm.click();
  await expect(selected.locator('#selected-name')).toHaveText('河畔小屋');
  const placed=await save(),building=placed.entities.at(-1),id=building.parcelId;
  const initial=placed.parcels.find(p=>p.id===id);
  expect(initial).toMatchObject({x:-120,z:48,width:14,depth:14,angle:15});

  await selected.getByRole('button',{name:'调整建筑'}).click();
  await expect(field('中心 X')).toBeHidden();
  await field('位置吸附').selectOption('0.25');await field('15° 角度吸附').uncheck();
  await field('局部 X（米）').fill('0.63');await field('局部 Z（米）').fill('-0.38');await field('相对角度 °').fill('17.5');
  await confirm.click();
  const shifted=await save(),local=shifted.entities.find(e=>e.id===building.id);
  expect(shifted.parcels.find(p=>p.id===id)).toEqual(initial);
  expect(local).toMatchObject({offsetX:.75,offsetZ:-.5,angle:17.5});

  await selected.getByRole('button',{name:'移动整块'}).click();
  await expect(field('局部 X（米）')).toBeHidden();
  await field('位置吸附').selectOption('0');
  await field('中心 X').fill('-120.31');await field('中心 Z').fill('50.13');await field('地块角度 °').fill('23.6');
  await confirm.click();
  const moved=await save();
  expect(moved.parcels.find(p=>p.id===id)).toMatchObject({x:-120.31,z:50.13,angle:23.6});
  expect(moved.entities.find(e=>e.id===building.id)).toEqual(local);

  await selected.getByRole('button',{name:'移动整块'}).click();
  await field('宽度').fill('3');
  await expect(editor.locator('.parcel-feedback')).toHaveText('建筑超出地块边界');
  await expect(confirm).toBeDisabled();
  await field('宽度').press('Escape');await expect(editor).toBeHidden();
  await navigate(page,page.getByRole('button',{name:'保存并重载',exact:true}));
  expect(await read()).toEqual(moved);
  expect(errors).toEqual([]);
});

test('T01 draws a lot on the map and places a building in it',async({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?scene=T01');await ready(page);
  const city={version:3,terrain:'meander',name:'划地测试',radius:64,nextId:1,entities:[],parcels:[]};
  const camera={position:[-78,40,-18],target:[-100,0,-50]};
  await page.locator('#import-file').setInputFiles({name:'empty.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({city,camera}))});
  await expect(page.locator('#city-name')).toHaveText(city.name);
  const editor=page.getByRole('form',{name:'地块与建筑编辑'}),confirm=editor.getByRole('button',{name:'确认'});
  await page.getByRole('button',{name:'划定地块',exact:true}).click();
  const width=editor.getByLabel('宽度',{exact:true});
  const previousWidth=await width.inputValue();
  const canvas=page.locator('#scene');
  await canvas.click({position:{x:480,y:320}});
  await canvas.click({position:{x:570,y:355}});
  await expect(width).not.toHaveValue(previousWidth);
  await width.fill('16');await editor.getByLabel('进深',{exact:true}).fill('16');
  await confirm.click();
  await expect(page.locator('#selected-name')).toHaveText('空地块');
  await page.getByRole('button',{name:'建造河畔小屋',exact:true}).click();
  await expect(editor.getByRole('heading')).toHaveText('在地块内放置河畔小屋');
  await confirm.click();
  await expect(page.locator('#selected-name')).toHaveText('河畔小屋');
  await navigate(page,page.getByRole('button',{name:'保存并重载',exact:true}));
  const saved=await page.evaluate(async()=>{
    const {createSaveStore}=await import('/src/storage.js');
    return (await createSaveStore({name:'riverlight-scenes-T01-standard'}).load('autosave')).data;
  });
  expect(saved.parcels).toHaveLength(1);expect(saved.entities).toHaveLength(1);
  expect(saved.entities[0].parcelId).toBe(saved.parcels[0].id);
  expect(errors).toEqual([]);
});

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

for(const [id,count] of [['T01',82],['T02',76],['T03',61],['T04',60],['T05',78],['T06',135],['T07',841]])
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
      expect(evidence.scene).toMatchObject({id:'T01',version:3});
      const [west,east,slantedWest,slantedEast]=evidence.spatial.samples;
      expect(west.objects).toHaveLength(1);
      expect(west.objects[0]).toMatchObject({type:'library',bounds:{minX:-70,maxX:-58,minZ:-16,maxZ:-6}});
      expect(east.objects.map(e=>e.type)).toEqual(['library','office','mall']);
      expect(east.objects[0]).toEqual(west.objects[0]);
      const angledLibrary=slantedWest.objects.find(e=>e.type==='library');
      expect(angledLibrary).toBeDefined();
      expect(slantedEast.objects).toContainEqual(angledLibrary);
      expect(evidence.spatial).toMatchObject({land:{groundY:0,waterY:null},river:{groundY:null,waterY:-.4}});
      await page.screenshot({path:'test-results/t01-world-space.png'});

      const resultOfShrink=await page.evaluate(async()=>{
        const [{createScene},{City}]=await Promise.all([import('/src/baseline.js'),import('/src/core.js')]);
        const fixture=createScene('T01'),model=new City(fixture.city),before=JSON.stringify(model.snapshot());
        const accepted=model.resizeParcel('t01-cottage',8,12);
        const unchanged=JSON.stringify(model.snapshot())===before&&model.undoStack.length===0;
        fixture.city.parcels.find(p=>p.id==='t01-cottage').width=8;
        return {accepted,unchanged,invalidFile:fixture};
      });
      expect(resultOfShrink).toMatchObject({accepted:false,unchanged:true});
      await page.locator('#import-file').setInputFiles({name:'t01-shrunken.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(resultOfShrink.invalidFile))});
      await expect(page.getByRole('status')).toContainText('建筑超出地块边界');
      expect((await page.evaluate(()=>window.riverlight.getStats())).entities).toBe(count);
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
