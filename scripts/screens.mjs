// pnpm screens: drives the built app (Playwright _electron) through the screens the restyle touches and writes one
// PNG per screen and skin to screens/<SKIN>/ (a root folder: Playwright empties test-results/ on every e2e run). Needs `pnpm build` first (the package script does it).
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from '@playwright/test';

const SKINS = ['DEFAULT', 'ANNABIOSIS', 'KANAGAWA', 'TOUCH', 'NORD', 'TOKYO NIGHT'];
const OUT = 'screens';
const SCREENS = 14;
const exactly = (name) => new RegExp(`^${name}$`, 'i');

/** a screen that cannot be captured stops the run: never a silent skip */
function need(ok, name, skin, why) {
  if (!ok) throw new Error(`screen "${name}" (${skin}): ${why}`);
}

async function run(skin) {
  const dir = join(OUT, skin.replace(/ /g, '-'));
  // a capture that is no longer taken must not linger from an earlier run
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const app = await electron.launch({
    args: ['packages/app'],
    env: {
      ...process.env,
      SREDA_USER_DATA: mkdtempSync(join(tmpdir(), 'sreda-screens-ud-')),
      SREDA_LIBRARY: mkdtempSync(join(tmpdir(), 'sreda-screens-lib-')),
      SREDA_E2E: '1',
      SREDA_A4_PORT: '__none__',
    },
  });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForFunction(() => '__sreda' in window);

    const wait = (ms) => page.waitForTimeout(ms);
    const shot = async (name) => {
      await wait(400);
      await page.screenshot({ path: join(dir, name + '.png') });
    };
    const press = async (key) => {
      await page.mouse.move(720, 450);
      await page.keyboard.press(key);
    };
    const tab = (name) => page.getByRole('tab', { name: exactly(name) }).click();
    const sidebar = async () => {
      if ((await page.locator('.sr-side').count()) === 0)
        await page.getByRole('button', { name: /^sidebar/i }).click();
    };
    const clean = async () => {
      await press('Escape');
      await press('Escape');
    };

    // the skin, chosen the way a person does: SETTINGS, a click on its row
    await sidebar();
    await tab('SETTINGS');
    await page.locator('.sr-skin', { hasText: skin }).first().click();
    await shot('settings');
    await clean();
    if ((await page.locator('.sr-side').count()) > 0)
      await page.getByRole('button', { name: /^sidebar/i }).click();
    await shot('pulse');

    // a factory project, fitted
    await sidebar();
    await tab('LIBRARY');
    // a long section shows its first eight rows: TECHNO is the tenth project
    await page.locator('[data-section=PROJECTS] .sr-more').click();
    await page
      .locator('.sr-lrow', { hasText: /·\s*techno\s*$/i })
      .first()
      .click();
    await wait(600);
    await clean();
    await press('f');
    await wait(500);
    await shot('techno');

    await press('w');
    await shot('wires');
    await tab('MIX');
    await shot('mix');
    await tab('LIBRARY');
    await shot('library');
    await clean();

    // a cable dragged from an output into empty space opens the picker
    const jack = page.locator('.sr-jack[data-dir="out"]').first();
    const jb = await jack.boundingBox();
    need(jb, 'picker-from-jack', skin, 'no output jack on the canvas');
    {
      const x = jb.x + jb.width / 2;
      const y = jb.y + jb.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 40, y + 40, { steps: 5 });
      await page.mouse.move(1000, 820, { steps: 10 });
      await page.mouse.up();
      await shot('picker-from-jack');
      await clean();
    }

    // LISTEN with the sidebar open: the pill and the notice stay clear of the bars on the narrowed canvas
    await sidebar();
    {
      const outs = page.locator('.sr-jack[data-dir="out"]');
      let hit = null;
      for (let i = 0; i < (await outs.count()) && !hit; i++) {
        const b = await outs.nth(i).boundingBox();
        if (b && b.x > 40 && b.x < 900 && b.y > 140 && b.y < 800) hit = outs.nth(i);
      }
      need(hit, 'listen-sidebar', skin, 'no visible output jack beside the open sidebar');
      await hit.click();
      await shot('listen-sidebar');
      await clean();
      await page.getByRole('button', { name: /^sidebar/i }).click();
    }

    // an LPG's MODE option, open
    const mode = page.locator('.sr-mod[data-type="lpg"] [data-option="mode"] .sr-opt').first();
    need((await mode.count()) > 0, 'option-menu', skin, 'no LPG MODE option on the canvas');
    {
      await mode.click();
      await shot('option-menu');
      await clean();
    }

    const frame = page.locator('.sr-frame').nth(1);
    const fb = await frame.boundingBox();
    need(fb, 'frame-hover', skin, 'no second frame on the canvas');
    {
      await page.mouse.move(fb.x + 60, fb.y + 12);
      await shot('frame-hover');
    }

    // the META-SEQ drawer opens with a click on the display (a double-click on the head opens the replace picker)
    const disp = page.locator('.sr-mod[data-type="metaseq"] .sr-disp').first();
    need((await disp.count()) > 0, 'drawer', skin, 'no META-SEQ display on the canvas');
    {
      await disp.click();
      await shot('drawer');
      await clean();
    }

    // a long frame name in a frame at its minimum width (352 px): the name ellipsises, the tools stay
    {
      const f = page.locator('.sr-frame').nth(1);
      await f.locator('.sr-gname').dblclick();
      await page.locator('.sr-gname-in').fill('a-very-long-frame-name-that-cannot-fit');
      await page.keyboard.press('Enter');
      const h = await f.locator('[data-resize="r"]').boundingBox();
      need(h, 'frame-narrow', skin, 'no right resize handle on the frame');
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x - 1500, h.y + h.height / 2, { steps: 12 });
      await page.mouse.up();
      const fb2 = await f.boundingBox();
      await page.mouse.move(fb2.x + 120, fb2.y + 12);
      await shot('frame-narrow');
      // the same name in WIRES: collapse the frame, its block jacks read `frame name › port`
      await f.getByRole('button', { name: 'Collapse frame' }).click();
      await clean();
      await press('w');
      await shot('wires-long');
      await clean();
    }

    // a 60-character name
    await press('Meta+Shift+s');
    await page.getByLabel('Name').fill('a-very-long-project-name-'.padEnd(60, 'x'));
    await page.keyboard.press('Enter');
    await wait(300);
    await shot('long-name');
  } finally {
    await app.close();
  }
  need(errors.length === 0, 'all', skin, `page errors: ${errors.join(' | ')}`);
  const pngs = readdirSync(dir).filter((f) => f.endsWith('.png')).length;
  need(pngs === SCREENS, 'all', skin, `${pngs} PNGs written, expected ${SCREENS}`);
  console.log(`${skin}: done`);
}

try {
  for (const skin of SKINS) await run(skin);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
