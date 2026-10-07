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
    env: { ...process.env, SREDA_USER_DATA: dir, SREDA_E2E: '1' },
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
  // the panel's element must survive the edit (a re-created panel would drop the knob's pointer capture)
  await page.locator('[data-type=osc]').evaluate((el) => (el.dataset['mark'] = 'kept'));
  await dragKnob(page, 'osc', 'freq', 100);
  await expect(page.locator('[data-type=osc][data-mark=kept]')).toHaveCount(1);
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
  await again.page.waitForTimeout(200);
  await again.app.close();
  // the unreadable save was replaced: the next launch opens quietly
  const third = await launch(first.dir);
  await expect(third.page.locator('[data-type=osc]')).toBeVisible();
  await expect(
    third.page.getByText('AUTOSAVE WAS UNREADABLE — KEPT AS BACKUP, OPENED A NEW PATCH'),
  ).toBeHidden();
  await third.app.close();
});

type Mod = {
  id: string;
  type: string;
  x: number;
  y: number;
  params: Record<string, number>;
  atts: Record<string, number>;
};
type Cable = { from: [string, string]; to: [string, string] };
const fullDoc = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __sreda: { doc(): { modules: Mod[]; cables: Cable[] } } }).__sreda.doc(),
  );
const jack = (page: Page, module: string, port: string, nth = 0) =>
  page.locator(`[data-type=${module}]`).nth(nth).locator(`[data-jack="${port}"]`);
async function center(page: Page, l: ReturnType<typeof jack>): Promise<{ x: number; y: number }> {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }): Promise<void> {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
  await page.mouse.up();
}

test('patching: add wired from a jack, stack a cable, pull it out, delete and undo', async () => {
  const { app, page } = await launch();
  // drag from OSC OUT into empty space → picker → OUT → placed with its L at the drop point and wired
  const out = await center(page, jack(page, 'osc', 'out'));
  const drop = { x: out.x + 120, y: out.y + 300 };
  await drag(page, out, drop);
  await expect(page.locator('.sr-picker')).toBeVisible();
  await page.keyboard.type('out');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-type=out]')).toHaveCount(2);
  const l2 = await center(page, jack(page, 'out', 'l', 1));
  expect(Math.abs(l2.x - drop.x)).toBeLessThan(8);
  expect(Math.abs(l2.y - drop.y)).toBeLessThan(8);
  let d = await fullDoc(page);
  const second = d.modules[2]!.id;
  expect(d.cables).toContainEqual({ from: ['m1', 'out'], to: [second, 'l'] });

  // drag from OSC OUT onto the new OUT's R: a second cable from the same output
  await drag(page, out, await center(page, jack(page, 'out', 'r', 1)));
  d = await fullDoc(page);
  expect(d.cables).toContainEqual({ from: ['m1', 'out'], to: [second, 'r'] });

  // drag from that R into empty space removes the cable
  await drag(page, await center(page, jack(page, 'out', 'r', 1)), { x: 1300, y: 900 });
  d = await fullDoc(page);
  expect(d.cables.some((c) => c.to[0] === second && c.to[1] === 'r')).toBe(false);

  // box-select both OUTs, Backspace deletes them, ⌘Z brings them back
  const a = (await page.locator('[data-type=out]').nth(0).boundingBox())!;
  const b = (await page.locator('[data-type=out]').nth(1).boundingBox())!;
  await drag(
    page,
    { x: Math.min(a.x, b.x) - 20, y: Math.min(a.y, b.y) - 20 },
    { x: Math.max(a.x + a.width, b.x + b.width) + 20, y: Math.max(a.y + a.height, b.y + b.height) + 20 },
  );
  await page.keyboard.press('Backspace');
  await expect(page.locator('[data-type=out]')).toHaveCount(0);
  await page.keyboard.press('Meta+z');
  await expect(page.locator('[data-type=out]')).toHaveCount(2);
  await app.close();
});

test('listen: click an output, the bar names it, Esc ends it', async () => {
  const { app, page } = await launch();
  await page.mouse.click(1300, 900); // start audio
  await jack(page, 'osc', 'out').click();
  await expect(page.getByText('LISTENING · OSC › OUT')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('LISTENING · OSC › OUT')).toBeHidden();
  await app.close();
});

test('an input value is dragged: PTCH att down 50 px is 0.5; / opens the picker, Esc closes it', async () => {
  const { app, page } = await launch();
  await page.locator('[data-type=osc] .sr-head').hover();
  const f = await center(page, page.locator('[data-type=osc] [data-field=pitch]'));
  await drag(page, f, { x: f.x, y: f.y + 50 });
  expect((await fullDoc(page)).modules[0]!.atts['pitch']).toBeCloseTo(0.5, 2);
  await page.mouse.move(900, 600);
  await page.keyboard.press('/');
  await expect(page.locator('.sr-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sr-picker')).toBeHidden();
  await app.close();
});

test('moving a module by its face is one undo step', async () => {
  const { app, page } = await launch();
  const h = await center(page, page.locator('[data-type=out] .sr-head'));
  const x0 = (await fullDoc(page)).modules[1]!.x;
  await drag(page, h, { x: h.x + 160, y: h.y + 80 });
  expect((await fullDoc(page)).modules[1]!.x).toBe(x0 + 160);
  await page.keyboard.press('Meta+z');
  expect((await fullDoc(page)).modules[1]!.x).toBe(x0);
  await app.close();
});

test('a module added while audio runs shows its output level', async () => {
  const { app, page } = await launch();
  await page.mouse.click(1300, 900); // start audio
  await page.mouse.dblclick(900, 700);
  await page.keyboard.type('osc');
  await page.keyboard.press('Enter');
  const bar = page.locator('[data-type=osc]').nth(1).locator('.sr-lvl');
  await expect.poll(async () => (await bar.boundingBox())?.width ?? 0, { timeout: 2000 }).toBeGreaterThan(5);
  await app.close();
});

test('a wheel run on one knob is one undo step, and only that knob', async () => {
  const { app, page } = await launch();
  await page.mouse.dblclick(900, 700);
  await page.keyboard.type('osc');
  await page.keyboard.press('Enter');
  const knob = (n: number) => page.locator('[data-type=osc]').nth(n).locator('[data-knob=pw] .sr-knob');
  const pw = async (n: number) =>
    (await fullDoc(page)).modules.filter((m) => m.type === 'osc')[n]!.params['pw']!;
  const [a0, b0] = [await pw(0), await pw(1)];
  await knob(0).hover();
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -10);
  await knob(1).hover();
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -10);
  expect(await pw(0)).toBeGreaterThan(a0);
  expect(await pw(1)).toBeGreaterThan(b0);
  await page.keyboard.press('Meta+z');
  expect(await pw(1)).toBeCloseTo(b0, 6);
  expect(await pw(0)).toBeGreaterThan(a0);
  await app.close();
});

test('a scroll that pans the canvas passes over knobs without turning them', async () => {
  const { app, page } = await launch();
  const before = await freq(page);
  const view0 = await page.locator('.sr-layer').getAttribute('style');
  await page.mouse.move(900, 700);
  await page.mouse.wheel(0, 10);
  const box = (await page.locator('[data-type=osc] [data-knob=freq] .sr-knob').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 10);
  expect(await freq(page)).toBeCloseTo(before, 6);
  expect(await page.locator('.sr-layer').getAttribute('style')).not.toBe(view0);
  await app.close();
});
