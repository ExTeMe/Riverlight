import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.75, video: 'off', trace: 'off' });

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
      await page.evaluate(async () => {
        // Wait for the render loop to apply the camera before photographing.
        for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
      });
      const result = page.waitForEvent('download');
      await page.getByRole('button', { name: '拍张照片', exact: true }).click();
      await (await result).saveAs(testInfo.outputPath(`${preset}-${view}.png`));
    }
  }
  expect(errors).toEqual([]);
});
