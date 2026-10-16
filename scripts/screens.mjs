// pnpm screens: drives the built app (Playwright _electron) through the screens the restyle touches and writes one
// PNG per screen and skin to screens/<SKIN>/ (a root folder: Playwright empties test-results/ on every e2e run). Needs `pnpm build` first (the package script does it).
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from '@playwright/test';

const SKINS = ['DEFAULT', 'ANNABIOSIS', 'KANAGAWA', 'TOUCH', 'NORD', 'TOKYO NIGHT'];
const OUT = 'screens';
const SCREENS = 11;
const exactly = (name) => new RegExp(`^${name}$`, 'i');

/** a screen that cannot be captured stops the run: never a silent skip */
function need(ok, name, skin, why) {
  if (!ok) throw new Error(`screen "${name}" (${skin}): ${why}`);
}

async function run(skin) {
  const dir = join(OUT, skin.replace(/ /g, '-'));
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
  const page = await app.firstWindow();
  const errors = [];
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
  const tab = (name) => page.getByRole('button', { name: exactly(name) }).click();
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

  // a 60-character name
  await press('Meta+Shift+s');
  await page.getByLabel('Name').fill('a-very-long-project-name-'.padEnd(60, 'x'));
  await page.keyboard.press('Enter');
  await wait(300);
  await shot('long-name');

  await app.close();
  if (errors.length > 0) console.log(`${skin}: page errors`, errors);
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
