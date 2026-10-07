import { _electron as electron, expect, test } from '@playwright/test';

test('the app opens a cross-origin isolated SREDA window', async () => {
  const app = await electron.launch({ args: ['packages/app'] });
  const page = await app.firstWindow();
  await expect(page).toHaveTitle('SREDA');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await app.close();
});

test('a click starts audio and the test tone', async () => {
  const app = await electron.launch({ args: ['packages/app'] });
  const page = await app.firstWindow();
  await expect(page.getByText('CLICK TO START AUDIO')).toBeVisible();
  await page.mouse.click(400, 300);
  await expect(page.getByText('TEST TONE 220 HZ · CLICK TO STOP')).toBeVisible();
  await page.mouse.click(400, 300);
  await expect(page.getByText('TEST TONE OFF · CLICK TO PLAY')).toBeVisible();
  await app.close();
});
