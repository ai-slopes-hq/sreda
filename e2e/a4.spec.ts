import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('a project with an A4 opens and plays with no A4', async () => {
  const app = await electron.launch({
    args: ['packages/app'],
    env: {
      ...process.env,
      SREDA_USER_DATA: mkdtempSync(join(tmpdir(), 'sreda-e2e-')),
      SREDA_E2E: '1',
      SREDA_LIBRARY: mkdtempSync(join(tmpdir(), 'sreda-lib-')),
      SREDA_FIRST: 'starter',
      SREDA_A4_PORT: '__none__', // finds no port, whatever is plugged in
    },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => '__sreda' in window);
  // an A4 beside OSC → OUT
  await page.mouse.move(700, 600);
  await page.keyboard.press('/');
  await page.keyboard.type('a4');
  await page.keyboard.press('Enter');
  const panel = page.locator('[data-type=a4]');
  await expect(panel).toBeVisible();
  await page.mouse.click(1300, 880); // start audio
  const master = () =>
    page.evaluate(() =>
      (window as unknown as { __sreda: { readout(i: number): number } }).__sreda.readout(1),
    );
  await expect.poll(master, { timeout: 3000 }).toBeGreaterThan(0.05);
  // the caption means something only once Web MIDI access has resolved
  await page.waitForFunction(() =>
    (window as unknown as { __sreda: { midiResolved(): boolean } }).__sreda.midiResolved(),
  );
  // MIDI access itself works in Electron (the permission handler), so the caption is NOT CONNECTED, not NO MIDI
  await expect(panel.locator('.sr-device')).toContainText('NOT CONNECTED');
  await expect(panel.locator('.sr-device.missing')).toHaveCount(1);
  await expect(page.locator('.sr-line.notice')).toHaveCount(0);
  expect(errors).toEqual([]);
  await app.close();
});
