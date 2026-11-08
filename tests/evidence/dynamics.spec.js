import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// These recordings document the prototype, not a passing traffic simulation.
// Keep the real animation loop: the interaction suite deliberately throttles it.
for (const id of ['T02', 'T03', 'T04', 'T05']) {
  test(`${id} continuous observation`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/?scene=${id}`);
    await expect(page.locator('#loading')).toHaveCount(0, { timeout: 60000 });
    await page.locator('[data-view="near"]').click();
    const samples = [];
    async function observe(label, seconds) {
      const startedAt = new Date().toISOString();
      await page.waitForTimeout(seconds * 1000);
      const stats = await page.evaluate(() => window.riverlight.getStats());
      samples.push({ label, startedAt, capturedAt: new Date().toISOString(), seconds, stats });
      await page.screenshot({ path: info.outputPath(`${label}.png`) });
    }
    await observe('initial', 5);
    if (id === 'T05') {
      await page.locator('[data-weather-id="rain"]').click();
      await observe('rain', 15);
      expect(samples.at(-1).stats.environment.weather).toBe('rain');
      await page.locator('[data-weather-id="day"]').click();
      await observe('rain-stopped', 15);
      expect(samples.at(-1).stats.environment.weather).toBe('clear');
    } else {
      // Three boats are offset along a 210-unit loop at 1.8 units/second.
      // Observe long enough to include a complete nominal loop in T04.
      await observe('continuous', id === 'T04' ? 120 : 15);
    }
    await page.getByText('观察与记录', { exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出资源快照', exact: true }).click();
    await (await downloading).saveAs(info.outputPath('resource-snapshot.json'));
    const observations = JSON.stringify({ scene: id, samples, errors,
        limitations: ['Animation randomness is not seeded', 'Recordings require visual review',
          'No collision, shelter or traffic correctness assertion'] }, null, 2);
    await writeFile(info.outputPath('observations.json'), observations);
    await info.attach('observations', { body: observations, contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
}
