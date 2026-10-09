import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/** Each test gets its own user-data folder (IndexedDB), unless it passes one to reuse. */
async function launch(
  dir = mkdtempSync(join(tmpdir(), 'sreda-e2e-')),
  first: 'starter' | 'factory' = 'starter',
  library = mkdtempSync(join(tmpdir(), 'sreda-lib-')),
  /** SREDA_E2E_OPEN: the file ⌘O opens in place of the dialog */
  open?: string,
  /** SREDA_E2E_IMPORT: the files File › Import Samples… picks in place of the dialog */
  importPaths?: string[],
): Promise<{ app: ElectronApplication; page: Page; dir: string; library: string }> {
  const app = await electron.launch({
    args: ['packages/app'],
    // tests start from the starter patch (OSC → OUT) unless they ask for the real first launch (Pulse)
    env: {
      ...process.env,
      SREDA_USER_DATA: dir,
      SREDA_E2E: '1',
      SREDA_LIBRARY: library,
      ...(open ? { SREDA_E2E_OPEN: open } : {}),
      ...(importPaths ? { SREDA_E2E_IMPORT: importPaths.join(',') } : {}),
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

test('cables show as stubs; hovering a stub, a module or opening WIRES shows them whole', async () => {
  const { app, page } = await launch();
  const cable = page.locator('.sr-cables path.cable');
  await expect(page.locator('.sr-cables path.stub')).toHaveCount(2);
  await expect(cable).toHaveCount(0);
  const o = await center(page, page.locator('[data-type=osc] .sr-head'));
  await page.mouse.move(o.x, o.y);
  await expect(cable).toHaveCount(1);
  await page.mouse.move(700, 900);
  await expect(cable).toHaveCount(0);
  const b = await center(page, jack(page, 'out', 'l'));
  await page.mouse.move(b.x - 7, b.y + 3);
  await expect(cable).toHaveCount(1);
  await expect(page.locator('.sr-wtag')).toHaveText('OSC › OUT  →  OUT › L');
  await page.mouse.move(700, 900);
  await expect(cable).toHaveCount(0);
  await page.keyboard.press('w');
  await expect(cable).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(cable).toHaveCount(0);
  // dragging from OSC's output draws the dragged cable whole
  const a = await center(page, jack(page, 'osc', 'out'));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 120, { steps: 5 });
  await expect(page.locator('.sr-cables path.ghost')).toHaveCount(1);
  await page.mouse.up();
  await app.close();
});

test('the first launch shows OSC → OUT; a click starts audio', async () => {
  const { app, page } = await launch();
  await expect(page.locator('[data-type=osc]')).toBeVisible();
  await expect(page.locator('[data-type=out]')).toBeVisible();
  await expect(page.locator('.sr-cables path.stub')).toHaveCount(2);
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

/** resolves once the element has shown a `flash` (a clock is running and the page sees it) */
const firstFlash = (page: Page, selector: string) =>
  page.evaluate(
    (sel) =>
      new Promise<void>((done, fail) => {
        const el = document.querySelector(sel)!;
        if (el.classList.contains('flash')) return done();
        const obs = new MutationObserver(() => {
          if (!el.classList.contains('flash')) return;
          obs.disconnect();
          clearTimeout(t);
          done();
        });
        const t = setTimeout(() => {
          obs.disconnect();
          fail(new Error(`no flash on ${sel}`));
        }, 10000);
        obs.observe(el, { attributes: true, attributeFilter: ['class'] });
      }),
    selector,
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
  await firstFlash(page, '[data-type=lpg] [data-jack=ping]'); // the clock runs and the page sees it
  expect(await flashes(page, '[data-type=lpg] [data-jack=ping]', 2500)).toBeGreaterThanOrEqual(1);

  // a frame inside it at ÷2 (drag its CLK IN ratio field down one step)
  await page.locator('[data-type=lpg] .sr-head').click();
  await page.keyboard.press('g');
  const inner = (await fullDoc(page)).groups.find((g) => g.id !== outer)!.id;
  expect((await fullDoc(page)).groups.find((g) => g.id === inner)!.parent).toBe(outer);
  const f = await center(page, page.locator(`[data-frame=${inner}] [data-field=clkIn]`));
  await drag(page, f, { x: f.x, y: f.y + 9 });
  await expect(page.locator(`[data-frame=${inner}] [data-field=clkIn]`)).toHaveText('÷2');
  // the plan changed: let both clocks tick in the new plan before counting
  await Promise.all([
    firstFlash(page, `[data-frame=${outer}] [data-jack=clkOut]`),
    firstFlash(page, `[data-frame=${inner}] [data-jack=clkOut]`),
  ]);
  const [a, b] = await Promise.all([
    flashes(page, `[data-frame=${outer}] [data-jack=clkOut]`, 4000),
    flashes(page, `[data-frame=${inner}] [data-jack=clkOut]`, 4000),
  ]);
  expect(Math.abs(a - 8)).toBeLessThanOrEqual(1);
  expect(Math.abs(b - 4)).toBeLessThanOrEqual(1);
  await app.close();
});

test('C collapses a frame to its connections; a cable dragged from a block jack patches the port inside; ⇧C expands everything', async () => {
  const { app, page } = await launch();
  const osc = (await page.locator('[data-type=osc]').boundingBox())!;
  await drag(
    page,
    { x: osc.x - 20, y: osc.y - 20 },
    { x: osc.x + osc.width + 20, y: osc.y + osc.height + 20 },
  );
  await page.keyboard.press('g'); // frames OSC; the frame is selected
  await expect(page.locator('.sr-frame')).toHaveCount(1);
  await page.mouse.click(1300, 880); // start audio
  const master = () => page.evaluate(() => (window as unknown as { __sreda: Sreda }).__sreda.readout(1));
  /** the highest master reading over about half a second */
  const peak = async () => {
    let m = 0;
    for (let i = 0; i < 25; i++) {
      m = Math.max(m, await master());
      await page.waitForTimeout(20);
    }
    return m;
  };
  await expect.poll(master).toBeGreaterThan(0.05);
  const expanded = await peak();

  await page.keyboard.press('c');
  await expect(page.locator('[data-type=osc]')).toHaveCount(0);
  await expect(page.locator('.sr-block .sr-bjack')).toHaveCount(1);
  await expect(page.locator('.sr-block .sr-bjack')).toHaveText('OSC › OUT');
  await expect(page.locator('path.cable')).toHaveCount(1);
  await expect.poll(master).toBeGreaterThan(0.05);
  // collapsing changes the picture, not the sound: the same peak within 10 %
  expect(Math.abs((await peak()) - expanded)).toBeLessThanOrEqual(expanded * 0.1);

  // from the block jack to OUT's R: the cable starts at OSC's OUT
  const from = await center(page, page.locator('.sr-block .sr-bjack .sr-jack'));
  await drag(page, from, await center(page, jack(page, 'out', 'r')));
  const d = await fullDoc(page);
  const [o, out] = [d.modules.find((m) => m.type === 'osc')!, d.modules.find((m) => m.type === 'out')!];
  expect(d.cables).toContainEqual({ from: [o.id, 'out'], to: [out.id, 'r'] });

  await page.keyboard.press('Meta+z'); // the cable
  await page.keyboard.press('Meta+z'); // the collapse
  await expect(page.locator('[data-type=osc]')).toBeVisible();
  await expect.poll(master).toBeGreaterThan(0.05);

  await page.keyboard.press('Shift+C');
  await expect(page.locator('[data-type=osc]')).toHaveCount(0);
  await page.keyboard.press('Shift+C');
  await expect(page.locator('[data-type=osc]')).toBeVisible();
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

test('⌘G frames start stacked; STACK toggles off and on', async () => {
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
  await drag(
    page,
    { x: Math.min(...all.map((r) => r[0]!)) - 20, y: Math.min(...all.map((r) => r[1]!)) - 20 },
    { x: Math.max(...all.map((r) => r[2]!)) + 20, y: Math.max(...all.map((r) => r[3]!)) + 20 },
  );
  await page.keyboard.press('Meta+g');
  const frame = page.locator('.sr-frame');
  const stack = frame.getByText('STACK', { exact: true });
  await expect(stack).toHaveClass(/on/);
  await expect(frame.getByText('FIX', { exact: true })).toHaveCount(0);
  expect((await fullDoc(page)).groups[0]!.layout).toBe('stack');
  const positions = async () => (await fullDoc(page)).modules.map((m) => [m.x, m.y]);
  const packed = await positions();
  await stack.click();
  await expect(stack).not.toHaveClass(/on/);
  expect((await fullDoc(page)).groups[0]!.layout).toBe('free');
  expect(await positions()).toEqual(packed);
  await stack.click();
  await expect(stack).toHaveClass(/on/);
  expect((await fullDoc(page)).groups[0]!.layout).toBe('stack');
  expect(await positions()).toEqual(packed);
  await app.close();
});

test('a stacked frame packs densely; dragging its right edge re-packs; STACK turns it off', async () => {
  const { app, page } = await launch();
  const out = await center(page, jack(page, 'osc', 'out'));
  await drag(page, out, { x: out.x + 100, y: out.y + 320 });
  await page.keyboard.type('filter');
  await page.keyboard.press('Enter');
  const all = await page
    .locator('.sr-mod')
    .evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]),
    );
  await drag(
    page,
    { x: Math.min(...all.map((r) => r[0]!)) - 20, y: Math.min(...all.map((r) => r[1]!)) - 20 },
    { x: Math.max(...all.map((r) => r[2]!)) + 20, y: Math.max(...all.map((r) => r[3]!)) + 20 },
  );
  await page.keyboard.press('Meta+g');
  const frame = page.locator('.sr-frame');
  const box = async () => (await frame.boundingBox())!;
  const positions = async () => (await fullDoc(page)).modules.map((m) => [m.x, m.y]);
  const stack = frame.getByText('STACK');
  await expect(stack).toHaveClass(/on/); // ⌘G starts stacked
  const stacked = await box();
  const overlap = async () => {
    const rs = await page
      .locator('.sr-mod')
      .evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]),
      );
    return rs.some((a, i) =>
      rs.some((b, j) => i < j && a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!),
    );
  };
  expect(await overlap()).toBe(false);
  const packed = await positions();
  const edge = { x: stacked.x + stacked.width, y: stacked.y + stacked.height / 2 };
  await drag(page, edge, { x: edge.x + 400, y: edge.y });
  const widened = await box();
  expect(widened.width).toBeGreaterThan(stacked.width);
  expect(widened.height).toBeLessThan(stacked.height);
  expect(await overlap()).toBe(false);
  await page.keyboard.press('Meta+z');
  expect((await box()).width).toBeCloseTo(stacked.width, 0);
  expect(await positions()).toEqual(packed);
  await stack.click();
  await expect(stack).not.toHaveClass(/on/);
  expect(await positions()).toEqual(packed);
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
  await page.keyboard.press('w');
  await page.getByRole('button', { name: 'LIBRARY' }).click();
  await page.locator('[data-section=PROJECTS] [data-path="FACTORY/acid"]').click();
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
  const library = mkdtempSync(join(tmpdir(), 'sreda-lib-'));
  const { app, page } = await launch(
    undefined,
    'starter',
    library,
    join(library, 'projects', 'jam.sreda.json'),
  );
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
  await expect(page.locator('.sr-mod')).toHaveCount(2);
  await expect(page.locator('.sr-brand')).toHaveText('SREDAjam.sreda.json');
  await app.close();
});

test('⌘O opens a project file outside the library; ⌘S writes it back there, not into the library', async () => {
  const library = mkdtempSync(join(tmpdir(), 'sreda-lib-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'sreda-elsewhere-'));
  const file = join(elsewhere, 'tune.sreda.json');
  // a project saved once, then moved out of the library
  const first = await launch(undefined, 'starter', library);
  await first.page.keyboard.press('Meta+s');
  await first.page.getByLabel('Name').fill('seed');
  await first.page.keyboard.press('Enter');
  await expect.poll(() => existsSync(join(library, 'projects', 'seed.sreda.json'))).toBe(true);
  await first.app.close();
  copyFileSync(join(library, 'projects', 'seed.sreda.json'), file);
  rmSync(join(library, 'projects', 'seed.sreda.json'));
  const before = readFileSync(file, 'utf8');

  const dir = mkdtempSync(join(tmpdir(), 'sreda-e2e-'));
  const { app, page } = await launch(dir, 'starter', library, file);
  await page.keyboard.press('Meta+o');
  await expect(page.locator('.sr-brand')).toContainText('tune.sreda.json');
  await dragKnob(page, 'osc', 'freq', -60);
  await expect(page.locator('.sr-dirty')).toHaveCount(1);
  await page.keyboard.press('Meta+s');
  await expect(page.locator('.sr-dirty')).toHaveCount(0);
  expect(readFileSync(file, 'utf8')).not.toBe(before);
  expect(readdirSync(join(library, 'projects'))).toEqual([]);
  await page.waitForTimeout(800); // the autosave (500 ms debounce) keeps the project for the relaunch
  await app.close();

  // relaunched with the same user data: the project resumes as that file, and ⌘S still writes it back
  const saved = readFileSync(file, 'utf8');
  const again = await launch(dir, 'starter', library);
  await expect(again.page.locator('.sr-brand')).toContainText('tune.sreda.json');
  await dragKnob(again.page, 'osc', 'freq', 60);
  await again.page.keyboard.press('Meta+s');
  await expect(again.page.locator('.sr-dirty')).toHaveCount(0);
  expect(readFileSync(file, 'utf8')).not.toBe(saved);
  await again.app.close();
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
  // the cable is drawn behind: its stub at OUT's L shows it whole, with the tag
  await page.mouse.move(b.x - 7, b.y + 3);
  await expect(page.locator('.sr-wtag')).toBeVisible();
  await expect(page.locator('.sr-cables path.cable')).toHaveCount(1);
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

test('WIRES: W opens the sidebar beside the canvas; sections, problems, a value dragged, ✕; F fits the visible part', async () => {
  const { app, page } = await launch();
  const width = () => page.locator('.sr-canvas').evaluate((el) => el.clientWidth);
  const full = await width();
  // OSC's own output into its PTCH (a CV input: a value), both modules framed, a lone FILTER
  await drag(
    page,
    await center(page, jack(page, 'osc', 'out')),
    await center(page, jack(page, 'osc', 'pitch')),
  );
  const osc = (await page.locator('[data-type=osc]').boundingBox())!;
  const out = (await page.locator('[data-type=out]').boundingBox())!;
  await drag(
    page,
    { x: osc.x - 20, y: osc.y - 20 },
    { x: out.x + out.width + 20, y: out.y + out.height + 20 },
  );
  await page.keyboard.press('g');
  await page.mouse.move(400, 760);
  await page.keyboard.press('/');
  await page.keyboard.type('filter');
  await page.keyboard.press('Enter');

  await page.keyboard.press('w');
  await expect(page.locator('.sr-side')).toBeVisible();
  expect(full - (await width())).toBe(440);
  const group = page.locator('[data-section]').filter({ hasText: 'GROUP 1' });
  await expect(group.locator('.sr-wrow').filter({ hasText: 'OSC › OUT  →  OUT › L' })).toHaveCount(1);
  await expect(page.locator('[data-section=problems]')).toContainText('FILTER › IN — empty input');

  // drag the PTCH row's value down 50 px: the attenuverter on the module is 0.5
  const row = group.locator('.sr-wrow').filter({ hasText: '→  OSC › PTCH' });
  const v = await center(page, row.locator('.value'));
  await drag(page, v, { x: v.x, y: v.y + 50 });
  expect((await fullDoc(page)).modules[0]!.atts['pitch']).toBeCloseTo(0.5, 2);
  await row.getByLabel('Remove wire').click();
  expect((await fullDoc(page)).cables.some((c) => c.to[1] === 'pitch')).toBe(false);

  // F fits the patch in the part of the window the sidebar leaves
  await page.mouse.move(300, 300);
  await page.keyboard.press('f');
  const vw = await page.evaluate(() => innerWidth);
  for (const box of await page
    .locator('.sr-mod')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right)))
    expect(box).toBeLessThan(vw - 440);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sr-side')).toBeHidden();
  await app.close();
});

test('WIRES: move an end from the port list, a new wire, rows light the canvas, keys, SELECTION', async () => {
  const { app, page } = await launch();
  await page.mouse.move(500, 700);
  await page.keyboard.press('/');
  await page.keyboard.type('filter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('w');
  const rows = page.locator('.sr-wrow[data-wire]');
  await expect(rows).toHaveCount(1);

  // hovering the row lights its cable and outlines both modules
  await rows.first().hover();
  await expect(page.locator('.sr-cables path.cable.lit')).toHaveCount(1);
  await expect(page.locator('[data-type=out]')).toHaveClass(/wire-end/);

  // the destination port → the port list → `r` ⏎: the cable ends at OUT › R
  await rows.first().locator('.port[data-end=to]').click();
  await page.keyboard.type('r');
  await page.keyboard.press('Enter');
  expect((await fullDoc(page)).cables).toEqual([{ from: ['m1', 'out'], to: ['m2', 'r'] }]);

  // + new wire: OSC › OUT, then FILTER › IN
  await page.getByText('+ new wire').click();
  await page.keyboard.type('osc › out');
  await page.keyboard.press('Enter');
  await page.keyboard.type('filter › in');
  await page.keyboard.press('Enter');
  const f = (await fullDoc(page)).modules.find((m) => m.type === 'filter')!.id;
  expect((await fullDoc(page)).cables).toContainEqual({ from: ['m1', 'out'], to: [f, 'in'] });

  // SELECTION with OSC selected: only OSC's wires (both of them here); with the FILTER selected: one
  await page.locator('[data-type=filter] .sr-head').click();
  await page.getByText('SELECTION', { exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('FILTER › IN');
  await page.getByText('SELECTION', { exact: true }).click();

  // ↓ picks the first row, Backspace removes its wire
  await page.mouse.click(1200, 820); // the canvas has the keys (and nothing is selected)
  await page.keyboard.press('ArrowDown');
  const first = await rows.first().getAttribute('data-wire');
  expect(first).toBe('0');
  await page.keyboard.press('Backspace');
  expect((await fullDoc(page)).cables).toEqual([{ from: ['m1', 'out'], to: [f, 'in'] }]);
  await app.close();
});

test("REVERB's room fills with the tail once audio runs", async () => {
  const { app, page } = await launch();
  const out = await center(page, jack(page, 'osc', 'out'));
  await drag(page, out, { x: out.x + 120, y: out.y + 320 });
  await page.keyboard.type('reverb');
  await page.keyboard.press('Enter');
  const fill = page.locator('[data-type=reverb] .sr-room .d-fill');
  const empty = (await fill.boundingBox())?.height ?? 0;
  await page.mouse.click(1300, 860); // start audio
  await expect
    .poll(async () => (await fill.boundingBox())?.height ?? 0, { timeout: 2000 })
    .toBeGreaterThan(empty + 2);
  await app.close();
});

/** A 16-bit mono WAV: `seconds` of a decaying 110 Hz sine at 48 kHz. */
function wav(seconds = 0.5, hz = 110): Buffer {
  const n = Math.round(48_000 * seconds);
  const b = Buffer.alloc(44 + 2 * n);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + 2 * n, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48_000, 24);
  b.writeUInt32LE(96_000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(2 * n, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(
      Math.round(30_000 * Math.exp(-i / 12_000) * Math.sin((2 * Math.PI * hz * i) / 48_000)),
      44 + 2 * i,
    );
  return b;
}
function libraryWithSamples(): string {
  const library = mkdtempSync(join(tmpdir(), 'sreda-lib-'));
  mkdirSync(join(library, 'samples', 'kit'), { recursive: true });
  writeFileSync(join(library, 'samples', 'kit', 'kick.wav'), wav());
  writeFileSync(join(library, 'samples', 'kit', 'snare.wav'), wav(0.3, 220));
  return library;
}
type SampleMod = { id: string; type: string; sample?: string };
const samplers = async (page: Page) =>
  ((await doc(page)).modules as unknown as SampleMod[]).filter((m) => m.type === 'sampler');

/** a source folder with the given sample files (the file dialog's stub picks from it); returns their paths */
function sourceFiles(names: string[]): string[] {
  const src = mkdtempSync(join(tmpdir(), 'sreda-src-'));
  return names.map((n) => {
    const f = join(src, n);
    writeFileSync(f, wav(0.3, n.startsWith('kick') ? 110 : 220));
    return f;
  });
}
/** / sampler ⏎ places an empty SAMPLER at the pointer */
async function placeSampler(page: Page): Promise<void> {
  await page.mouse.move(700, 650);
  await page.keyboard.press('/');
  await page.keyboard.type('sampler');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-type=sampler]')).toHaveCount(1);
}

test('LOAD on a SAMPLER copies the picked file into samples/ and loads it; ⌘Z clears it; the display click does the same; S does nothing', async () => {
  const [kick] = sourceFiles(['kick.wav']);
  const { app, page, library } = await launch(undefined, 'starter', libraryWithSamples(), undefined, [kick!]);
  await page.keyboard.press('s');
  await expect(page.locator('.sr-picker')).toBeHidden();
  await placeSampler(page);
  await page.locator('[data-type=sampler] [data-action=load]').click();
  await expect.poll(async () => (await samplers(page))[0]?.sample).toBe('kick.wav');
  await expect(page.locator('[data-type=sampler] .sr-dtag')).toHaveText(/^kick\.wav/);
  expect(existsSync(join(library, 'samples', 'kick.wav'))).toBe(true);
  expect(await page.locator('.sr-picker').count()).toBe(0);
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => (await samplers(page))[0]?.sample).toBeUndefined();
  // a click on the empty display does the same
  await page.locator('[data-type=sampler] .sr-wave-box').click();
  await expect.poll(async () => (await samplers(page))[0]?.sample).toBe('kick 2.wav');
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => (await samplers(page))[0]?.sample).toBeUndefined();
  await app.close();
});

test('a loaded SAMPLER, triggered, sounds', async () => {
  const [kick] = sourceFiles(['kick.wav']);
  const { app, page } = await launch(undefined, 'starter', libraryWithSamples(), undefined, [kick!]);
  await placeSampler(page);
  await page.locator('[data-type=sampler] [data-action=load]').click();
  await expect.poll(async () => (await samplers(page))[0]?.sample).toBe('kick.wav');
  // OSC's saw into TRIG, SAMPLER L into OUT L (in place of OSC)
  await drag(
    page,
    await center(page, jack(page, 'osc', 'out')),
    await center(page, jack(page, 'sampler', 'trig')),
  );
  await drag(
    page,
    await center(page, jack(page, 'sampler', 'l')),
    await center(page, jack(page, 'out', 'r')),
  );
  await page.mouse.click(1300, 880); // start audio
  const master = () => page.evaluate(() => (window as unknown as { __sreda: Sreda }).__sreda.readout(1));
  await expect.poll(master, { timeout: 2000 }).toBeGreaterThan(0.05);
  await app.close();
});

test('a loaded SAMPLER display: a click moves START (⌘Z undoes it); a drag scrubs the file and START ends where it is released', async () => {
  const [kick] = sourceFiles(['kick.wav']);
  const { app, page } = await launch(undefined, 'starter', libraryWithSamples(), undefined, [kick!]);
  await placeSampler(page);
  await page.locator('[data-type=sampler] [data-action=load]').click();
  await expect.poll(async () => (await samplers(page))[0]?.sample).toBe('kick.wav');
  const start = async () =>
    ((await doc(page)).modules.find((m) => m.type === 'sampler')?.params as Record<string, number>)['start']!;
  expect(await start()).toBe(0);
  const wave = page.locator('[data-type=sampler] .sr-wave-box');
  await wave.click();
  await expect.poll(start).toBeCloseTo(0.5, 1);
  await page.keyboard.press('Meta+z');
  await expect.poll(start).toBe(0);
  // the OSC leaves the patch so that only the scrub can sound: SAMPLER L → OUT L
  await page.locator('[data-type=osc]').click({ position: { x: 6, y: 6 } });
  await page.keyboard.press('Delete');
  await drag(
    page,
    await center(page, jack(page, 'sampler', 'l')),
    await center(page, jack(page, 'out', 'l')),
  );
  await page.mouse.click(1300, 880); // start audio
  const master = () => page.evaluate(() => (window as unknown as { __sreda: Sreda }).__sreda.readout(1));
  const box = (await wave.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.1, y);
  await page.mouse.down();
  let peak = 0;
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(box.x + box.width * (0.1 + (0.5 * i) / 24), y);
    await page.waitForTimeout(40);
    peak = Math.max(peak, await master());
  }
  // the scrub's level follows the drag's speed (a 25 Hz high-pass on the scrub voice), which varies under load
  expect(peak).toBeGreaterThan(0.02);
  await page.mouse.up();
  await expect.poll(start).toBeCloseTo(0.6, 1);
  // one undo step for the whole gesture
  await page.keyboard.press('Meta+z');
  await expect.poll(start).toBe(0);
  await app.close();
});

test('an audio file dropped on empty canvas becomes a SAMPLER; another file gives a notice', async () => {
  const { app, page, library } = await launch(undefined, 'starter', libraryWithSamples());
  const dropFile = async (name: string, bytes: number[]) => {
    const dt = await page.evaluateHandle(
      ([n, b]) => {
        const d = new DataTransfer();
        d.items.add(new File([new Uint8Array(b as number[])], n as string));
        return d;
      },
      [name, bytes] as const,
    );
    await page.dispatchEvent('.sr-canvas', 'drop', { dataTransfer: dt, clientX: 700, clientY: 650 });
  };
  await dropFile('hat.wav', [...wav(0.1, 3000)]);
  await expect.poll(async () => (await samplers(page))[0]?.sample).toBe('hat.wav');
  expect(existsSync(join(library, 'samples', 'hat.wav'))).toBe(true);
  await dropFile('notes.txt', [1, 2, 3]);
  await expect(page.locator('.sr-line.notice')).toHaveText('NOT A SAMPLE · notes.txt');
  await app.close();
});

test('File › Import Samples…: with a SAMPLER selected the first file loads into it; the menu keeps Edit', async () => {
  const src = mkdtempSync(join(tmpdir(), 'sreda-src-'));
  const files = [join(src, 'zap.wav'), join(src, 'pop.wav')];
  files.forEach((f) => writeFileSync(f, wav(0.1, 440)));
  const lib = libraryWithSamples();
  const { app, page } = await launch(undefined, 'starter', lib, undefined, files);
  expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((i) => i.label))).toEqual(
    expect.arrayContaining(['File', 'Edit', 'View', 'Window']),
  );
  // / sampler ⏎ places a SAMPLER and selects it
  await placeSampler(page);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('importSamples')!.click());
  await expect.poll(async () => (await samplers(page))[0]?.sample).toBe('zap.wav');
  await expect(page.locator('[data-type=sampler] .sr-dtag')).toHaveText(/^zap\.wav/);
  expect(existsSync(join(lib, 'samples', 'pop.wav'))).toBe(true);
  await app.close();
});

test('a 3-minute stereo sample loads without freezing the page, and the SAMPLER shows its peaks', async () => {
  const { app, page } = await launch(undefined, 'starter', libraryWithSamples());
  await page.evaluate(() => {
    const w = window as unknown as { __gap: number };
    w.__gap = 0;
    let last = performance.now();
    const beat = () => {
      const now = performance.now();
      w.__gap = Math.max(w.__gap, now - last);
      last = now;
      requestAnimationFrame(beat);
    };
    requestAnimationFrame(beat);
  });
  const dt = await page.evaluateHandle(() => {
    const rate = 48_000;
    const n = rate * 180;
    const bytes = new Uint8Array(44 + 4 * n);
    const v = new DataView(bytes.buffer);
    const tag = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
    tag(0, 'RIFF');
    v.setUint32(4, 36 + 4 * n, true);
    tag(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 2, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 4, true);
    v.setUint16(32, 4, true);
    v.setUint16(34, 16, true);
    tag(36, 'data');
    v.setUint32(40, 4 * n, true);
    for (let i = 0; i < n; i++) {
      const k = i % 24_000;
      const x = Math.round(20_000 * Math.exp(-k / 3000) * Math.sin(k * 0.05));
      v.setInt16(44 + 4 * i, x, true);
      v.setInt16(46 + 4 * i, x, true);
    }
    const d = new DataTransfer();
    d.items.add(new File([bytes], 'long.wav'));
    return d;
  });
  await page.dispatchEvent('.sr-canvas', 'drop', { dataTransfer: dt, clientX: 700, clientY: 650 });
  await expect.poll(async () => (await samplers(page))[0]?.sample, { timeout: 60_000 }).toBe('long.wav');
  const fill = page.locator('.sr-wave .d-fill').first();
  await expect.poll(async () => (await fill.getAttribute('d')) ?? '', { timeout: 60_000 }).toMatch(/L/);
  expect(await page.evaluate(() => (window as unknown as { __gap: number }).__gap)).toBeLessThan(200);
  expect(
    await page.evaluate(() => (window as unknown as { __sreda: { analysis: object } }).__sreda.analysis),
  ).toEqual({ worker: 1, fallback: 0 });
  await app.close();
});

test('SETTINGS: W opens WIRES; choosing NORD recolours the canvas and is remembered', async () => {
  const first = await launch();
  const ground = () =>
    first.page.locator('.sr-canvas').evaluate((el) => getComputedStyle(el).backgroundColor);
  await first.page.keyboard.press('w');
  await expect(first.page.locator('.sr-wfilter')).toBeVisible();
  await first.page.getByRole('button', { name: 'SETTINGS' }).click();
  await expect(first.page.locator('.sr-wfilter')).toHaveCount(0);
  await first.page.locator('[data-skin="NORD"]').click();
  await expect.poll(ground).toBe('rgb(46, 52, 64)');
  await first.page.keyboard.press('w'); // on another tab than WIRES: switches to it
  await expect(first.page.locator('.sr-wfilter')).toBeVisible();
  await first.page.keyboard.press('w'); // on WIRES: closes
  await expect(first.page.locator('.sr-side')).toHaveCount(0);
  await first.app.close();
  const again = await launch(first.dir, 'starter', first.library);
  await expect
    .poll(() => again.page.locator('.sr-canvas').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(46, 52, 64)');
  await again.app.close();
});

test('MIX: M opens a strip per OUT and the master; M / S, the faders and ⌘Z; the canvas knob moves the strip', async () => {
  const { app, page } = await launch();
  await page.mouse.click(1300, 880); // start audio
  const master = () => page.evaluate(() => (window as unknown as { __sreda: Sreda }).__sreda.readout(1));
  await expect.poll(master).toBeGreaterThan(0.05);
  await page.keyboard.press('m');
  await expect(page.locator('.sr-strip[data-out]')).toHaveCount(1);
  await expect(page.locator('.sr-strip[data-out] .sr-sname')).toHaveText('OUT');
  await expect(page.locator('.sr-strip.master')).toBeVisible();
  const strip = page.locator('.sr-strip[data-out]');
  await strip.getByRole('button', { name: 'S', exact: true }).click(); // solo keeps the sound
  await page.waitForTimeout(100);
  expect(await master()).toBeGreaterThan(0.05);
  await strip.getByRole('button', { name: 'M', exact: true }).click();
  await expect.poll(master, { timeout: 500 }).toBeLessThan(0.001);
  await page.keyboard.press('Meta+z');
  await expect.poll(master).toBeGreaterThan(0.05);
  // the master fader to 0: silence; ⌘Z: sound
  const mf = (await page.locator('.sr-strip.master .sr-fader').boundingBox())!;
  const x = mf.x + mf.width / 2;
  await page.mouse.move(x, mf.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, mf.y + 10 + 20 * i);
  await page.mouse.up();
  await expect.poll(master, { timeout: 500 }).toBeLessThan(0.001);
  await page.keyboard.press('Meta+z');
  await expect.poll(master).toBeGreaterThan(0.05);
  // OUT's LVL knob on the canvas moves the strip's fader
  const before = await strip.locator('.sr-fader').getAttribute('aria-valuenow');
  await dragKnob(page, 'out', 'level', 40);
  await expect.poll(() => strip.locator('.sr-fader').getAttribute('aria-valuenow')).not.toBe(before);
  await page.keyboard.press('m');
  await expect(page.locator('.sr-side')).toHaveCount(0);
  await app.close();
});

test('LIBRARY: a factory group and a sample are dragged from the sidebar onto the canvas', async () => {
  const { app, page } = await launch(undefined, 'starter', libraryWithSamples());
  await page.getByRole('button', { name: 'SIDEBAR' }).click();
  await page.getByRole('button', { name: 'LIBRARY' }).click();
  await expect(page.locator('[data-section=SAMPLES] .sr-lrow')).toHaveCount(2);
  await page
    .locator('[data-section=GROUPS]')
    .getByText('303 voice')
    .dragTo(page.locator('.sr-canvas'), {
      targetPosition: { x: 500, y: 600 },
    });
  await expect(page.locator('.sr-frame .sr-gname')).toHaveText('303 VOICE');
  await page
    .locator('[data-section=SAMPLES] [data-path="kit/snare.wav"]')
    .dragTo(page.locator('.sr-canvas'), {
      targetPosition: { x: 300, y: 150 },
    });
  await expect.poll(async () => (await samplers(page))[0]?.sample).toBe('kit/snare.wav');
  await app.close();
});
