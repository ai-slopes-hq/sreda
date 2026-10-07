import { _electron as electron, expect, test } from '@playwright/test';

test('the app opens a cross-origin isolated SREDA window', async () => {
  const app = await electron.launch({ args: ['packages/app'] });
  const page = await app.firstWindow();
  await expect(page).toHaveTitle('SREDA');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await app.close();
});
