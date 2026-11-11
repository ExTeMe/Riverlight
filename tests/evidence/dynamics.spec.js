import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const observationViews = {
  T04: { position: [9, 4, 27], target: [0, 0, 0] },
  T05: { position: [-60, 9, 15], target: [-70, 0, 0] },
};

// These recordings document the prototype, not a passing traffic simulation.
// Keep the real animation loop: the interaction suite deliberately throttles it.
for (const id of ['T02', 'T03', 'T04', 'T05']) {
  test(`${id} continuous observation`, async ({ page }, info) => {
    const errors = [];
    const record = { scene: id, status: 'running', stage: 'loading', samples: [], errors,
      limitations: ['Animation randomness is not seeded', 'Recordings require visual review',
        'No collision, shelter or traffic correctness assertion'] };
    async function persist() {
      await writeFile(info.outputPath('observations.json'), JSON.stringify(record, null, 2));
    }
    await persist();
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`/?scene=${id}`);
      await expect(page.locator('#loading')).toHaveCount(0, { timeout: 60000 });
      record.context = await page.evaluate(() => ({
        revision: document.querySelector('meta[name="riverlight-revision"]')?.content,
        workingTree: document.querySelector('meta[name="riverlight-working-tree"]')?.content,
        browser: navigator.userAgent, viewport: [innerWidth, innerHeight], pixelRatio: devicePixelRatio,
      }));
      await page.locator('[data-view="near"]').click();
      const view = observationViews[id];
      if (view) {
        record.stage = 'observation-view';
        await persist();
        await page.locator('[data-action="camera"]').click();
        // The isolated browser can seed a bookmark and use the normal UI to recall it.
        await page.evaluate(camera => localStorage.setItem('riverlight-camera', JSON.stringify(camera)), view);
        await page.locator('[data-action="help"]').click();
        await page.locator('[data-action="recall"]').click();
        record.view = view;
      }
      const samples = record.samples;
      async function observe(label, seconds) {
        record.stage = label;
        const startedAt = new Date().toISOString();
        await persist();
        await page.waitForTimeout(seconds * 1000);
        const stats = await page.evaluate(() => window.riverlight.getStats());
        samples.push({ label, startedAt, capturedAt: new Date().toISOString(), seconds, stats });
        await persist();
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
        // T04 observes the bridge deck and boat motion along the verified route.
        await observe('continuous', id === 'T04' ? 120 : 15);
      }
      // Centers of the target road cells in the fixed 1280×800 near camera.
      // T02 crosses the chunk edge at (-16, -6); T03 targets junction (-24, 0).
      const roadPosition = { T02: { x: 1183, y: 396 }, T03: { x: 640, y: 399 } }[id];
      if (roadPosition) {
        const before = samples.at(-1).stats;
        await page.keyboard.press('x');
        await expect.poll(()=>page.evaluate(()=>window.riverlight.getStats().mode)).toBe('erase');
        await page.locator('#scene').click({ position: roadPosition });
        await observe('road-removed', 8);
        expect(samples.at(-1).stats.entities).toBe(before.entities - 1);
        expect(samples.at(-1).stats.walkNodes).not.toBe(before.walkNodes);
        await page.keyboard.press('Control+z');
        await observe('road-restored', 8);
        expect(samples.at(-1).stats).toMatchObject({ entities: before.entities, walkNodes: before.walkNodes });
      }
      if (id === 'T02') {
        await page.locator('[data-view="ramp"]').click();
        await page.keyboard.press('h');
        await observe('ramp-start', 2);
        await observe('ramp-walk', 6);
        await page.keyboard.press('h');
      }
      if (id === 'T03') {
        await page.locator('[data-view="junction"]').click();
        await page.keyboard.press('h');
        await observe('junction-car', 2);
        expect(samples.at(-1).stats.junctionPreview).toMatchObject({vehicle:'car',count:12});
        expect(samples.at(-1).stats.junctionPreview.distance).toBeGreaterThan(0);
        await page.keyboard.press('h');
        await page.locator('[data-vehicle="bus"]').click();
        await page.keyboard.press('h');
        await observe('junction-bus', 2);
        expect(samples.at(-1).stats.junctionPreview).toMatchObject({vehicle:'bus',count:8});
        expect(samples.at(-1).stats.junctionPreview.distance).toBeGreaterThan(0);
        await page.keyboard.press('h');
      }
      if (id === 'T05') {
        await page.locator('[data-view="walk"]').click();
        await page.keyboard.press('h');
        await observe('walking-connections', 5);
        expect(samples.at(-1).stats).toMatchObject({mobilityOverlay:true});
        expect(samples.at(-1).stats.visiblePedestrians).toBeGreaterThan(0);
        await page.keyboard.press('h');
      }
      if (id === 'T04') {
        await page.locator('[data-view="walk"]').click();
        await page.keyboard.press('h');
        await observe('bridge-approaches', 4);
        await page.keyboard.press('h');
        await page.locator('[data-view="river"]').click();
        await page.locator('[data-weather-id="day"]').click();
        await page.keyboard.press('h');
        await observe('river-banks-and-reaches', 5);
        await page.keyboard.press('h');
      }
      record.stage = 'resource-snapshot';
      await persist();
      await page.getByText('观察与记录', { exact: true }).click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出资源快照', exact: true }).click();
      await (await downloading).saveAs(info.outputPath('resource-snapshot.json'));
      expect(errors).toEqual([]);
      record.status = 'completed';
    } catch (error) {
      record.status = 'failed';
      record.failure = error.message;
      throw error;
    } finally {
      record.finishedAt = new Date().toISOString();
      await persist();
      await info.attach('observations', { path: info.outputPath('observations.json'), contentType: 'application/json' });
    }
  });
}
