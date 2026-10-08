import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/** Each test gets its own user-data folder (IndexedDB), unless it passes one to reuse. */
async function launch(
  dir = mkdtempSync(join(tmpdir(), 'sreda-e2e-')),
  first: 'starter' | 'factory' = 'starter',
  library = mkdtempSync(join(tmpdir(), 'sreda-lib-')),
): Promise<{ app: ElectronApplication; page: Page; dir: string; library: string }> {
  const app = await electron.launch({
    args: ['packages/app'],
    // tests start from the starter patch (OSC → OUT) unless they ask for the real first launch (Pulse)
    env: {
      ...process.env,
      SREDA_USER_DATA: dir,
      SREDA_E2E: '1',
      SREDA_LIBRARY: library,
      ...(first === 'starter' ? { SREDA_FIRST: 'starter' } : {}),
    },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => '__sreda' in window);
  return { app, page, dir, library };
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
  parent: string | null;
  x: number;
  y: number;
  params: Record<string, number>;
  atts: Record<string, number>;
};
type Cable = { from: [string, string]; to: [string, string] };
type Frame = { id: string; name: string; parent: string | null };
const fullDoc = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __sreda: { doc(): { modules: Mod[]; cables: Cable[]; groups: Frame[] } } }
    ).__sreda.doc(),
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

test('SCOPE shows the signal patched into A', async () => {
  const { app, page } = await launch();
  const out = await center(page, jack(page, 'osc', 'out'));
  await drag(page, out, { x: out.x + 100, y: out.y + 260 });
  await page.keyboard.type('scope');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-type=scope]')).toBeVisible();
  expect((await fullDoc(page)).cables).toContainEqual({ from: ['m1', 'out'], to: ['m3', 'a'] });
  await page.mouse.click(1300, 900); // start audio
  const trace = page.locator('[data-type=scope] .sr-scope path.line-a');
  await expect
    .poll(async () => ((await trace.getAttribute('d')) ?? '').length, { timeout: 2000 })
    .toBeGreaterThan(100);
  await app.close();
});

test('SLOPE: with CYCLE on its EOC → TRIG normal shows as a ghost cable and names its source', async () => {
  const { app, page } = await launch();
  await page.mouse.dblclick(900, 600);
  await page.keyboard.type('slope');
  await page.keyboard.press('Enter');
  const slope = page.locator('[data-type=slope]');
  await expect(slope).toBeVisible();
  await expect(slope.locator('path.ghost-normal')).toHaveCount(0);
  await slope.locator('[data-option=cycle] button').click();
  await expect(slope.locator('path.ghost-normal')).toHaveCount(1);
  expect(await slope.locator('[data-jack=trig]').getAttribute('title')).toBe('TRIG ← EOC (normal)');
  // the SHP knob draws its curve instead of a number
  await slope.locator('.sr-head').hover();
  await expect(slope.locator('[data-knob=shape] [data-value] svg path')).toHaveCount(1);
  await app.close();
});

test('RHYTHM: DICE changes the pads and ⌘Z restores them', async () => {
  const { app, page } = await launch();
  await page.mouse.dblclick(700, 650);
  await page.keyboard.type('rhythm');
  await page.keyboard.press('Enter');
  const rhythm = page.locator('[data-type=rhythm]');
  await expect(rhythm.locator('.sr-pad')).toHaveCount(16);
  const pads = async () => (await fullDoc(page)).modules.find((m) => m.type === 'rhythm')!.params;
  const before = JSON.stringify(await pads());
  await rhythm.locator('[data-action=dice]').click();
  expect(JSON.stringify(await pads())).not.toBe(before);
  expect((await pads())['mode']).toBe(1);
  await page.keyboard.press('Meta+z');
  expect(JSON.stringify(await pads())).toBe(before);
  await app.close();
});

test('STAGES: drawing on the contour sets the notes; ⌘Z undoes the stroke in one step', async () => {
  const { app, page } = await launch();
  await page.mouse.dblclick(500, 450);
  await page.keyboard.type('stages');
  await page.keyboard.press('Enter');
  const disp = page.locator('[data-type=stages] .sr-contour');
  await expect(disp).toBeVisible();
  const v = async () => {
    const m = (await fullDoc(page)).modules.find((x) => x.type === 'stages')!;
    return [1, 2, 3].map((k) => m.params['v' + k]);
  };
  const before = await v();
  const box = (await disp.boundingBox())!;
  const step = box.width / 16;
  await drag(page, { x: box.x + step * 0.5, y: box.y + 40 }, { x: box.x + step * 2.5, y: box.y + 40 });
  const after = await v();
  expect(after).not.toEqual(before);
  expect(after[0]).toBe(after[2]);
  await page.keyboard.press('Meta+z');
  expect(await v()).toEqual(before);
  await app.close();
});

test('SWITCH: the current input label is amber', async () => {
  const { app, page } = await launch();
  await page.mouse.dblclick(700, 600);
  await page.keyboard.type('switch');
  await page.keyboard.press('Enter');
  await page.mouse.click(1300, 900); // start audio
  const label = (port: string) => page.locator(`[data-type=switch] .sr-plabel[data-port=${port}]`);
  await expect
    .poll(() => label('in1').evaluate((el) => getComputedStyle(el).color), { timeout: 2000 })
    .toBe('rgb(245, 165, 36)');
  expect(await label('in2').evaluate((el) => getComputedStyle(el).color)).not.toBe('rgb(245, 165, 36)');
  await app.close();
});

test('frames: G frames a box selection, dragging a module out detaches it, G unframes, ⌘Z restores', async () => {
  const { app, page } = await launch();
  const osc = (await page.locator('[data-type=osc]').boundingBox())!;
  const out = (await page.locator('[data-type=out]').boundingBox())!;
  await drag(
    page,
    { x: osc.x - 20, y: osc.y - 20 },
    { x: out.x + out.width + 20, y: out.y + out.height + 20 },
  );
  await page.keyboard.press('g');
  await expect(page.locator('.sr-frame')).toHaveCount(1);
  await expect(page.locator('.sr-frame .sr-gname')).toHaveText('GROUP 1');
  let d = await fullDoc(page);
  expect(d.modules.map((m) => m.parent)).toEqual([d.groups[0]!.id, d.groups[0]!.id]);

  const h = await center(page, page.locator('[data-type=out] .sr-head'));
  await drag(page, h, { x: h.x + 600, y: h.y + 300 });
  d = await fullDoc(page);
  expect(d.modules[1]!.parent).toBeNull();
  expect(d.modules[0]!.parent).toBe(d.groups[0]!.id);

  await page.locator('.sr-gname').click();
  await page.keyboard.press('g');
  await expect(page.locator('.sr-frame')).toHaveCount(0);
  d = await fullDoc(page);
  expect(d.modules).toHaveLength(2);
  expect(d.modules.map((m) => m.parent)).toEqual([null, null]);
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.sr-frame')).toHaveCount(1);
  await app.close();
});

/** rising edges of the `flash` class on an element over `ms` */
const flashes = (page: Page, selector: string, ms: number) =>
  page.evaluate(
    ([sel, dur]) =>
      new Promise<number>((done) => {
        const el = document.querySelector(sel as string)!;
        let n = 0;
        let was = el.classList.contains('flash');
        const t0 = performance.now();
        const id = setInterval(() => {
          const on = el.classList.contains('flash');
          if (on && !was) n++;
          was = on;
          if (performance.now() - t0 > (dur as number)) {
            clearInterval(id);
            done(n);
          }
        }, 15);
      }),
    [selector, ms] as const,
  );

test('frame clocks: an own clock pings an LPG; a nested frame at ÷2 ticks half as often', async () => {
  const { app, page } = await launch();
  await page.mouse.move(700, 600);
  await page.keyboard.press('/');
  await page.keyboard.type('lpg');
  await page.keyboard.press('Enter');
  await page.locator('[data-type=lpg] .sr-head').click();
  await page.keyboard.press('g');
  const outer = (await fullDoc(page)).groups[0]!.id;
  await page.locator(`[data-frame=${outer}]`).getByText('+ CLOCK').click();
  await drag(
    page,
    await center(page, page.locator(`[data-frame=${outer}] [data-jack=clkOut]`)),
    await center(page, jack(page, 'lpg', 'ping')),
  );
  expect((await fullDoc(page)).cables).toContainEqual({
    from: [outer, 'clkOut'],
    to: [expect.any(String), 'ping'],
  });
  await page.mouse.click(1300, 880); // start audio
  expect(await flashes(page, '[data-type=lpg] [data-jack=ping]', 1000)).toBeGreaterThanOrEqual(1);

  // a frame inside it at ÷2 (drag its CLK IN ratio field down one step)
  await page.locator('[data-type=lpg] .sr-head').click();
  await page.keyboard.press('g');
  const inner = (await fullDoc(page)).groups.find((g) => g.id !== outer)!.id;
  expect((await fullDoc(page)).groups.find((g) => g.id === inner)!.parent).toBe(outer);
  const f = await center(page, page.locator(`[data-frame=${inner}] [data-field=clkIn]`));
  await drag(page, f, { x: f.x, y: f.y + 9 });
  await expect(page.locator(`[data-frame=${inner}] [data-field=clkIn]`)).toHaveText('÷2');
  const [a, b] = await Promise.all([
    flashes(page, `[data-frame=${outer}] [data-jack=clkOut]`, 3000),
    flashes(page, `[data-frame=${inner}] [data-jack=clkOut]`, 3000),
  ]);
  expect(Math.abs(a - 6)).toBeLessThanOrEqual(1);
  expect(Math.abs(b - 3)).toBeLessThanOrEqual(1);
  await app.close();
});

test('MUTE: a framed voice goes silent and comes back', async () => {
  const { app, page } = await launch();
  const osc = (await page.locator('[data-type=osc]').boundingBox())!;
  const out = (await page.locator('[data-type=out]').boundingBox())!;
  await drag(
    page,
    { x: osc.x - 20, y: osc.y - 20 },
    { x: out.x + out.width + 20, y: out.y + out.height + 20 },
  );
  await page.keyboard.press('g');
  await page.mouse.click(1300, 880); // start audio
  const master = () => page.evaluate(() => (window as unknown as { __sreda: Sreda }).__sreda.readout(1));
  await expect.poll(master).toBeGreaterThan(0.05);
  await page.locator('.sr-ghead').hover();
  await page.getByLabel('Mute frame').click();
  await expect.poll(master, { timeout: 500 }).toBeLessThan(0.001);
  await expect(page.locator('[data-type=osc]')).toHaveClass(/muted/);
  await page.getByLabel('Mute frame').click();
  await expect.poll(master).toBeGreaterThan(0.05);
  await app.close();
});

test('WIRE FIX: ⌘G packs rows and routes wires at right angles; STACK packs flush and turns FIX off', async () => {
  const { app, page } = await launch();
  // OSC → FILTER (added wired from OSC's output), OSC → OUT
  const out = await center(page, jack(page, 'osc', 'out'));
  await drag(page, out, { x: out.x + 100, y: out.y + 320 });
  await page.keyboard.type('filter');
  await page.keyboard.press('Enter');
  const all = await page
    .locator('.sr-mod')
    .evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]),
    );
  const x0 = Math.min(...all.map((r) => r[0]!)) - 20;
  const y0 = Math.min(...all.map((r) => r[1]!)) - 20;
  await drag(
    page,
    { x: x0, y: y0 },
    { x: Math.max(...all.map((r) => r[2]!)) + 20, y: Math.max(...all.map((r) => r[3]!)) + 20 },
  );
  await page.keyboard.press('Meta+g');
  const fix = page.locator('.sr-frame').getByText('FIX', { exact: true });
  await expect(fix).toHaveClass(/on/);
  const ds = await page
    .locator('.sr-cables path.cable.routed')
    .evaluateAll((els) => els.map((e) => e.getAttribute('d')!));
  expect(ds.length).toBeGreaterThanOrEqual(1);
  for (const d of ds) {
    expect(d).toMatch(/^[MLQ0-9.\s-]+$/);
    // every straight segment is horizontal or vertical
    const cmds = [...d.matchAll(/([MLQ])([^MLQ]*)/g)].map(
      (m) => [m[1]!, m[2]!.trim().split(/\s+/).map(Number)] as const,
    );
    let at = [0, 0];
    for (const [c, n] of cmds) {
      const end = [n[n.length - 2]!, n[n.length - 1]!];
      if (c === 'L') expect(Math.abs(end[0]! - at[0]!) < 0.6 || Math.abs(end[1]! - at[1]!) < 0.6).toBe(true);
      at = end;
    }
  }
  const before = (await fullDoc(page)).modules.map((m) => [m.x, m.y]);
  await page.locator('.sr-frame').getByText('STACK').click();
  expect((await fullDoc(page)).modules.map((m) => [m.x, m.y])).not.toEqual(before);
  await expect(fix).not.toHaveClass(/on/);
  await expect(page.locator('.sr-cables path.cable.routed')).toHaveCount(0);
  await app.close();
});

test('the very first launch opens the factory project Pulse', async () => {
  const { app, page } = await launch(undefined, 'factory');
  await expect(page.locator('[data-type=lpg]')).toHaveCount(2);
  await expect(page.locator('[data-type=noise]')).toHaveCount(1);
  expect((await fullDoc(page)).modules.map((m) => m.type).sort()).toEqual([
    'lpg',
    'lpg',
    'mix',
    'noise',
    'osc',
    'osc',
    'out',
    'scope',
  ]);
  await app.close();
});

test('picker: a factory project replaces the canvas (⌘Z returns); a group dropped from a trigger output takes it into CLK IN', async () => {
  const { app, page } = await launch();
  await page.mouse.move(700, 500);
  await page.keyboard.press('/');
  await page.keyboard.press('Shift+Tab'); // ALL → PROJECTS
  await page.keyboard.type('acid');
  await expect(page.locator('.sr-pitem')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('.sr-frame .sr-gname')).toHaveText('ACID');
  await expect(page.locator('[data-type=rhythm]')).toHaveCount(1);
  await page.keyboard.press('Meta+z');
  await expect(page.locator('[data-type=rhythm]')).toHaveCount(0);
  expect((await fullDoc(page)).modules.map((m) => m.type)).toEqual(['osc', 'out']);

  // a SLOPE, then from its EOC (a trigger) into empty space → GROUPS → vca-lpg
  await page.mouse.move(400, 600);
  await page.keyboard.press('/');
  await page.keyboard.type('slope');
  await page.keyboard.press('Enter');
  const eoc = await center(page, jack(page, 'slope', 'eoc'));
  await drag(page, eoc, { x: eoc.x + 200, y: eoc.y + 150 });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab'); // ALL → MODULES → GROUPS
  await page.keyboard.type('vca');
  await page.keyboard.press('Enter');
  const d = await fullDoc(page);
  const g = d.groups.find((x) => x.name === 'VCA-LPG')!;
  const slope = d.modules.find((m) => m.type === 'slope')!;
  expect(d.cables).toContainEqual({ from: [slope.id, 'eoc'], to: [g.id, 'clkIn'] });
  await app.close();
});

test('library: ⌘S saves the project, NEW clears, ⌘O opens it again; NEW then ⌘Z restores', async () => {
  const { app, page, library } = await launch();
  await page.keyboard.press('Meta+s');
  await page.getByLabel('Name').fill('jam');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sr-brand')).toHaveText('SREDAjam');
  expect(existsSync(join(library, 'projects', 'jam.sreda.json'))).toBe(true);
  await page.getByText('NEW', { exact: true }).click();
  await expect(page.locator('.sr-mod')).toHaveCount(0);
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.sr-mod')).toHaveCount(2);
  await page.getByText('NEW', { exact: true }).click();
  await page.keyboard.press('Meta+o');
  await page.keyboard.type('jam');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sr-mod')).toHaveCount(2);
  await expect(page.locator('.sr-brand')).toHaveText('SREDAjam');
  await app.close();
});

test('library: ⌘S on a selected frame saves a group; the picker places it twice with fresh ids', async () => {
  const { app, page, library } = await launch();
  const osc = (await page.locator('[data-type=osc]').boundingBox())!;
  await drag(
    page,
    { x: osc.x - 20, y: osc.y - 20 },
    { x: osc.x + osc.width + 20, y: osc.y + osc.height + 20 },
  );
  await page.keyboard.press('g');
  await page.keyboard.press('Meta+s');
  await expect(page.getByLabel('Name')).toHaveValue('group 1');
  await page.getByLabel('Name').fill('kit/drums');
  await page.keyboard.press('Enter');
  await expect.poll(() => existsSync(join(library, 'groups', 'kit', 'drums.sreda-group.json'))).toBe(true);
  for (const at of [
    { x: 300, y: 700 },
    { x: 900, y: 700 },
  ]) {
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press('/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.type('drums');
    await expect(page.locator('.sr-pitem')).toHaveCount(1);
    await page.keyboard.press('Enter');
  }
  await expect(page.locator('.sr-frame')).toHaveCount(3);
  const d = await fullDoc(page);
  const ids = [...d.modules.map((m) => m.id), ...d.groups.map((g) => g.id)];
  expect(new Set(ids).size).toBe(ids.length);
  expect(d.modules.filter((m) => m.type === 'osc')).toHaveLength(3);
  await app.close();
});

test('wire hover names both ends; a free FILTER dropped on the cable goes into it; ⌘Z undoes', async () => {
  const { app, page } = await launch();
  const a = await center(page, jack(page, 'osc', 'out'));
  const b = await center(page, jack(page, 'out', 'l'));
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  await page.mouse.move(mid.x, mid.y + 3);
  await expect(page.locator('.sr-wtag')).toBeVisible();
  expect(await page.locator('.sr-wtag').evaluate((el) => el.textContent)).toBe('OSC › OUT  →  OUT › L');
  await expect(page.locator('[data-type=osc]')).toHaveClass(/wire-end/);

  // a FILTER placed in free space, then dragged by its name so the pointer lands on the cable
  await page.mouse.move(400, 700);
  await page.keyboard.press('/');
  await page.keyboard.type('filter');
  await page.keyboard.press('Enter');
  const head = await center(page, page.locator('[data-type=filter] .sr-head'));
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(head.x + ((mid.x - head.x) * i) / 10, head.y + ((mid.y - head.y) * i) / 10);
  await expect(page.locator('.sr-cables path.cable.insert')).toHaveCount(1);
  await page.mouse.up();
  const d = await fullDoc(page);
  const f = d.modules.find((m) => m.type === 'filter')!.id;
  expect(d.cables).toEqual([
    { from: ['m1', 'out'], to: [f, 'in'] },
    { from: [f, 'lp'], to: ['m2', 'l'] },
  ]);
  await page.keyboard.press('Meta+z');
  expect((await fullDoc(page)).cables).toEqual([{ from: ['m1', 'out'], to: ['m2', 'l'] }]);
  await app.close();
});

test('replace, R, ⌘D and magnets', async () => {
  const { app, page } = await launch();
  // magnets: OUT dragged to 5 px right of OSC lands flush against it
  const osc = (await page.locator('[data-type=osc]').boundingBox())!;
  const out = (await page.locator('[data-type=out]').boundingBox())!;
  const h = await center(page, page.locator('[data-type=out] .sr-head'));
  await drag(page, h, { x: h.x - (out.x - (osc.x + osc.width + 5)), y: h.y + 3 });
  let d = await fullDoc(page);
  expect(d.modules[1]!.x).toBe(d.modules[0]!.x + 280);
  expect(d.modules[1]!.y).toBe(d.modules[0]!.y);

  // R over OSC randomises its knobs; ⌘Z restores
  const freq0 = d.modules[0]!.params['freq'];
  await page.locator('[data-type=osc] .sr-head').hover();
  await page.keyboard.press('r');
  expect((await fullDoc(page)).modules[0]!.params['freq']).not.toBe(freq0);
  await page.keyboard.press('Meta+z');
  expect((await fullDoc(page)).modules[0]!.params['freq']).toBe(freq0);

  // ⌘D on both: four modules, two cables
  const a = (await page.locator('[data-type=osc]').boundingBox())!;
  const b = (await page.locator('[data-type=out]').boundingBox())!;
  await drag(page, { x: a.x - 20, y: a.y - 20 }, { x: b.x + b.width + 20, y: b.y + b.height + 20 });
  await page.keyboard.press('Meta+d');
  d = await fullDoc(page);
  expect(d.modules).toHaveLength(4);
  expect(d.cables).toHaveLength(2);
  await page.keyboard.press('Meta+z');

  // double-click OSC's name → REPLACE OSC → COMPLEX keeps the cable to OUT
  await page.locator('[data-type=osc] .sr-head').dblclick();
  await expect(page.locator('.sr-search')).toHaveAttribute('placeholder', 'REPLACE OSC');
  await page.keyboard.type('complex');
  await page.keyboard.press('Enter');
  d = await fullDoc(page);
  const cx = d.modules.find((m) => m.type === 'complex')!;
  expect(d.modules.map((m) => m.type).sort()).toEqual(['complex', 'out']);
  expect(d.cables).toEqual([{ from: [cx.id, 'out'], to: ['m2', 'l'] }]);
  await app.close();
});
