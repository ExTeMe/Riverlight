import { test, expect } from '@playwright/test';

test('real Chromium IndexedDB preserves originals and rolls back failed imports', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/browser/storage.html');
  await expect(page.locator('#summary')).toContainText('检查完成', { timeout: 45000 });
  expect(await page.locator('#results li').count()).toBeGreaterThan(5);
  await expect(page.locator('#results')).not.toContainText('失败：');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/storage-browser.png', fullPage: true });
});

test('development preview exposes its full revision for repeatable acceptance', async ({ page }) => {
  await page.goto('/tests/browser/storage.html');
  await expect(page.locator('meta[name="riverlight-revision"]')).toHaveAttribute('content', /^[a-f0-9]{40}$/);
  await expect(page.locator('#build-version')).toContainText('开发预览');
});

test('camera controls leave autosave clean, while building edits write once through a worker',async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1280,height:800});
  await page.addInitScript(()=>{
    window.saveAttempts=[];
    window.Worker=class extends Worker{
      postMessage(data,transfer){
        if(data.parts)window.saveAttempts.push({id:data.id,parts:transfer.length});
        return super.postMessage(data,transfer);
      }
    };
    window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),500);
    window.cancelAnimationFrame=id=>clearTimeout(id);
  });
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?scene=T01');
  await expect(page.locator('#loading')).toHaveCount(0,{timeout:60000});
  const writes=()=>page.evaluate(()=>window.saveAttempts);
  const status=page.locator('#save-state');
  const initial=await status.textContent();
  await page.mouse.move(660,330);await page.mouse.down({button:'right'});await page.mouse.move(722,367);await page.mouse.up({button:'right'});
  await page.mouse.wheel(0,-120);
  await page.keyboard.down('ArrowRight');await page.waitForTimeout(550);await page.keyboard.up('ArrowRight');
  await page.getByRole('button',{name:'尺度',exact:true}).click();
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{value:true,configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  await page.waitForTimeout(1500);
  await expect(status).toHaveText(initial);expect(await writes()).toEqual([]);
  const record=()=>page.evaluate(async()=>{
    const {createSaveStore}=await import('/src/storage.js');
    return createSaveStore({name:'riverlight-scenes-T01-standard'}).load('autosave');
  });
  expect(await record()).toBeUndefined();
  const before=await page.evaluate(()=>window.riverlight.getStats().entities);
  await page.getByRole('button',{name:'建造河畔小屋',exact:true}).click();
  const form=page.getByRole('form',{name:'地块与建筑编辑'});
  await form.getByLabel('中心 X').fill('-120');await form.getByLabel('中心 Z').fill('48');
  await form.getByRole('button',{name:'确认',exact:true}).click();
  await expect.poll(async()=> (await record())?.data.entities.length).toBe(before+1);
  expect(await writes()).toHaveLength(1);
  expect((await writes())[0]).toMatchObject({id:'autosave'});
  await page.getByRole('button',{name:'撤销 Ctrl+Z',exact:true}).click();
  await expect.poll(async()=> (await record())?.data.entities.length).toBe(before);
  expect(await writes()).toHaveLength(2);expect(errors).toEqual([]);
});
