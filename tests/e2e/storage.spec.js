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
