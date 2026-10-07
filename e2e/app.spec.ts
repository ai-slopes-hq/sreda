import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/** Each test gets its own user-data folder (IndexedDB), unless it passes one to reuse. */
async function launch(
  dir = mkdtempSync(join(tmpdir(), 'sreda-e2e-')),
): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const app = await electron.launch({
    args: ['packages/app'],
    env: { ...process.env, SREDA_USER_DATA: dir },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => '__sreda' in window);
  return { app, page, dir };
}

type Sreda = {
  doc(): { modules: { type: string; params: Record<string, number> }[]; cables: unknown[] };
  readout(i: number): number;
};
const doc = (page: Page) => page.evaluate(() => (window as unknown as { __sreda: Sreda }).__sreda.doc());
const freq = async (page: Page) => (await doc(page)).modules[0]!.params['freq']!;

async function dragKnob(page: Page, module: string, knob: string, dy: number): Promise<void> {
  const box = (await page.locator(`[data-type=${module}] [data-knob=${knob}] .sr-knob`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, y + (dy * i) / 10);
  await page.mouse.up();
}

test('the app opens a cross-origin isolated SREDA window', async () => {
  const { app, page } = await launch();
  await expect(page).toHaveTitle('SREDA');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await app.close();
});

test('the first launch shows OSC → OUT; a click starts audio', async () => {
  const { app, page } = await launch();
  await expect(page.locator('[data-type=osc]')).toBeVisible();
  await expect(page.locator('[data-type=out]')).toBeVisible();
  await expect(page.locator('.sr-cables path.cable')).toHaveCount(1);
  await expect(page.getByText('CLICK TO START AUDIO')).toBeVisible();
  await page.mouse.click(1300, 800);
  await expect(page.getByText('CLICK TO START AUDIO')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __sreda: Sreda }).__sreda.readout(1)), {
      timeout: 1000,
    })
    .toBeGreaterThan(0);
  await app.close();
});

test('dragging FREQ down 100 px lowers it by half its range; ⌘Z restores it', async () => {
  const { app, page } = await launch();
  const before = await freq(page); // 110 Hz sits at 0.57, so a half-range move down stays inside the range
  await dragKnob(page, 'osc', 'freq', 100);
  expect(Math.abs(before - (await freq(page)) - 0.5)).toBeLessThan(0.01);
  await page.keyboard.press('Meta+z');
  expect(await freq(page)).toBeCloseTo(before, 6);
  await app.close();
});

test('a relaunch resumes the edited patch', async () => {
  const first = await launch();
  await dragKnob(first.page, 'osc', 'freq', -40);
  const edited = await freq(first.page);
  await first.page.waitForTimeout(800); // autosave runs 500 ms after the last edit
  await first.app.close();
  const again = await launch(first.dir);
  expect(await freq(again.page)).toBeCloseTo(edited, 6);
  await again.app.close();
});

test('a corrupt autosave is kept as a backup, the starter patch opens, a notice says so', async () => {
  const first = await launch();
  await first.page.evaluate(
    () =>
      new Promise<void>((done) => {
        const open = indexedDB.open('sreda', 1);
        open.onsuccess = () => {
          const tx = open.result.transaction('session', 'readwrite');
          tx.objectStore('session').put({ garbage: true }, 'current');
          tx.oncomplete = () => done();
        };
      }),
  );
  await first.app.close();
  const again = await launch(first.dir);
  await expect(
    again.page.getByText('AUTOSAVE WAS UNREADABLE — KEPT AS BACKUP, OPENED A NEW PATCH'),
  ).toBeVisible();
  expect((await doc(again.page)).modules.map((m) => m.type)).toEqual(['osc', 'out']);
  const keys = await again.page.evaluate(
    () =>
      new Promise<string[]>((done) => {
        const open = indexedDB.open('sreda', 1);
        open.onsuccess = () => {
          const req = open.result.transaction('session').objectStore('session').getAllKeys();
          req.onsuccess = () => done(req.result.map(String));
        };
      }),
  );
  expect(keys.some((k) => k.startsWith('backup-'))).toBe(true);
  await again.app.close();
});
