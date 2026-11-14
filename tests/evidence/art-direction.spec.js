import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.75, video: 'off', trace: 'off' });

const sampleViews = ['cottage', 'bakery', 'library', 'office', 'park', 'pier'];

async function photograph(page, testInfo, name) {
  await page.evaluate(async () => {
    for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
  });
  const result = page.waitForEvent('download');
  await page.getByRole('button', { name: '拍张照片', exact: true }).click();
  await (await result).saveAs(testInfo.outputPath(`${name}.png`));
}

async function recallView(page, view) {
  await page.evaluate(camera => localStorage.setItem('riverlight-camera', JSON.stringify(camera)), view);
  await page.locator('[data-action="help"]').click();
  await page.locator('[data-action="recall"]').click();
}

test('T06 captures the same three views by day, at dusk and in rain', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?scene=T06');
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator('.scene-panel h2')).toHaveText('河光小街');
  await expect(page.locator('canvas[data-asset-library]')).toHaveAttribute('data-asset-library', 'Blender 34/34');

  for (const [preset, hour, weather] of [['day', 13, 'clear'], ['dusk', 17.5, 'clear'], ['rain', 20, 'rain']]) {
    const weatherButton = page.locator(`[data-weather-id="${preset}"]`);
    await weatherButton.click();
    await expect(weatherButton).toHaveAttribute('aria-pressed', 'true');
    // Restart the isolated scene at the selected hour so the first view doesn't
    // photograph the crossfade from the previous row.
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      page.getByRole('button', { name: '保存并重载', exact: true }).click(),
    ]);
    await expect(page.locator('#loading')).toHaveCount(0, { timeout: 90_000 });
    expect(await page.evaluate(() => window.riverlight.getStats().environment)).toMatchObject({
      hour, weather, quality: 'high', playing: false,
    });
    if (weather === 'rain') {
      await page.evaluate(async () => {
        // Let the night lights and rain particles fade in before the first shot.
        for (let frame = 0; frame < 32; frame++) await new Promise(requestAnimationFrame);
      });
    }

    for (const view of ['near', 'medium', 'far']) {
      await page.locator(`[data-view="${view}"]`).click();
      await photograph(page, testInfo, `${preset}-${view}`);
      if (preset === 'day' && view === 'medium') {
        await page.getByText('观察与记录', { exact: true }).click();
        const snapshot = page.waitForEvent('download');
        await page.getByRole('button', { name: '导出资源快照', exact: true }).click();
        await (await snapshot).saveAs(testInfo.outputPath('day-medium-resources.json'));
        await page.getByText('观察与记录', { exact: true }).click();
      }
    }
    if (preset !== 'dusk') {
      for (const name of preset === 'day' ? sampleViews : ['bakery', 'park', 'pier']) {
        await page.locator(`[data-view="${name}"]`).click();
        await photograph(page, testInfo, `${preset}-${name}`);
      }
    }
  }
  expect(errors).toEqual([]);
});

test('ART-04 records the LOD transition, fountain motion and park lighting', async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?scene=T06');
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator('canvas[data-asset-library]')).toHaveAttribute('data-asset-library', 'Blender 34/34');

  async function selectWeather(preset) {
    await page.locator(`[data-weather-id="${preset}"]`).click();
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      page.getByRole('button', { name: '保存并重载', exact: true }).click(),
    ]);
    await expect(page.locator('#loading')).toHaveCount(0, { timeout: 90_000 });
    await page.locator('[data-action="camera"]').click();
  }

  await selectWeather('day');
  await page.getByText('观察与记录', { exact: true }).click();
  const target = [-65, 0, 0];
  const direction = [55, 55, 85];
  const length = Math.hypot(...direction);
  const views = [['lod-419', 419], ['lod-421', 421], ['lod-480', 480], ['lod-560', 560], ['lod-return', 419]];
  const detailedChunks = [];
  for (const [name, distance] of views) {
    const position = target.map((value, index) => value + distance * direction[index] / length);
    await recallView(page, { position, target });
    await photograph(page, testInfo, name);
    const snapshot = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出资源快照', exact: true }).click();
    const download = await snapshot;
    const path = testInfo.outputPath(`${name}.json`);
    await download.saveAs(path);
    const data = JSON.parse(await readFile(path, 'utf8'));
    expect(data.scene).toMatchObject({ id: 'T06', version: 3 });
    expect(Math.hypot(...data.camera.position.map((value, index) => value - data.camera.target[index]))).toBeCloseTo(distance, 4);
    detailedChunks.push(data.detailedChunks);
  }
  const [before, after, intermediate, distant, returned] = detailedChunks;
  expect(after).toBe(before);
  expect(intermediate).toBeGreaterThan(0);
  expect(intermediate).toBeLessThan(after);
  expect(distant).toBe(0);
  expect(returned).toBeGreaterThan(intermediate);
  await page.getByText('观察与记录', { exact: true }).click();
  await recallView(page, { position: [-63, 8, 53], target: [-76, 1.5, 40] });
  await photograph(page, testInfo, 'fountain-a');
  await page.evaluate(async () => {
    for (let frame = 0; frame < 24; frame++) await new Promise(requestAnimationFrame);
  });
  await photograph(page, testInfo, 'fountain-b');

  await selectWeather('rain');
  await page.locator('[data-view="park"]').click();
  await page.evaluate(async () => {
    for (let frame = 0; frame < 32; frame++) await new Promise(requestAnimationFrame);
  });
  await photograph(page, testInfo, 'park-rain-light');
  expect(errors).toEqual([]);
});
