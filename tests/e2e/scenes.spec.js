import { test, expect } from '@playwright/test';

async function ready(page) {
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 60000 });
  await page.waitForFunction(() => !!window.riverlight);
}

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
  await page.locator('[data-scene="T06"]').click();await ready(page);
  await expect(page.locator('.scene-panel h2')).toHaveText('河光小街');
  expect((await page.evaluate(()=>window.riverlight.getStats())).entities).toBe(132);
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
  expect(evidence.scene).toMatchObject({id:'T06',version:1});
  expect(evidence.drawCalls).toBeGreaterThan(0);
  expect(evidence.rendererMemory.geometries).toBeGreaterThan(0);
  expect(evidence.frameTime).toBeNull();
  await page.getByRole('button',{name:'保存并重载',exact:true}).click();await ready(page);
  expect((await page.evaluate(()=>window.riverlight.getStats())).environment.weather).toBe('rain');
  await page.getByRole('button',{name:'重置场景',exact:true}).click();await ready(page);
  expect((await page.evaluate(()=>window.riverlight.getStats())).environment.weather).toBe('clear');
  await page.getByRole('button',{name:'返回我的城市',exact:true}).click();await ready(page);
  const restored=await page.evaluate(async()=>{
    const {saves}=await import('/src/storage.js');return (await saves.load('autosave')).data;
  });
  expect(restored).toEqual(original);
  await expect(page.locator('.scene-panel')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('all scene entries render and dense city loads with its own save namespace', async ({page})=>{
  test.setTimeout(300000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const [id,count] of [['T01',77],['T02',76],['T03',61],['T04',60],['T05',78],['T06',132],['T07',841]]){
    await page.goto(`/?scene=${id}`);await ready(page);
    expect((await page.evaluate(()=>window.riverlight.getStats())).entities).toBe(count);
    await expect(page.locator('.scene-panel')).toBeVisible();
  }
  await page.locator('[data-density="dense"]').click();await ready(page);
  expect((await page.evaluate(()=>window.riverlight.getStats())).entities).toBe(1053);
  await page.locator('[data-density="sparse"]').click();await ready(page);
  expect((await page.evaluate(()=>window.riverlight.getStats())).entities).toBe(78);
  expect(errors).toEqual([]);
});
