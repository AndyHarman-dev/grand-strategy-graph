import { expect, test, type Page } from '@playwright/test';

/**
 * The phone layout (plan Phase 8b, D22) on the dev page with `?phone=1`: touch enabled, at a phone's
 * size in both orientations, over a stand-in for Obsidian's navbar fixed at the bottom. Taps are real
 * touch events (CDP), so React Flow's touch pan and the long-press timer are what run.
 */

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

const node = (page: Page, key: string) => page.locator(`.react-flow__node[data-id="${key}"]`);
const peek = (page: Page) => page.getByRole('region', { name: 'Selected node' });
const walk = (page: Page) => page.getByRole('region', { name: 'Review walk' });
const navbar = (page: Page) => page.locator('.mobile-navbar');

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function centre(page: Page, key: string) {
  const box = (await node(page, key).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** One CDP session per page: a touch sequence (start, moves, end) has to go through the same one. */
const sessions = new WeakMap<Page, Promise<import('@playwright/test').CDPSession>>();

async function touch(page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', at?: { x: number; y: number }) {
  if (!sessions.has(page)) sessions.set(page, page.context().newCDPSession(page));
  const cdp = await sessions.get(page)!;
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: at ? [{ x: at.x, y: at.y }] : [] });
}

/** A finger down, held, and up again without moving. */
async function press(page: Page, at: { x: number; y: number }, ms: number) {
  await touch(page, 'touchStart', at);
  await page.waitForTimeout(ms);
  await touch(page, 'touchEnd');
}

/** One finger dragged from `at` by (dx, dy). */
async function swipe(page: Page, at: { x: number; y: number }, dx: number, dy: number) {
  await touch(page, 'touchStart', at);
  for (let i = 1; i <= 8; i++) await touch(page, 'touchMove', { x: at.x + (dx * i) / 8, y: at.y + (dy * i) / 8 });
  await touch(page, 'touchEnd');
}

const tap = async (page: Page, key: string) => press(page, await centre(page, key), 40);

async function doubleTap(page: Page, key: string) {
  const at = await centre(page, key);
  await press(page, at, 40);
  await page.waitForTimeout(80);
  await press(page, at, 40);
}

/** A point of the graph with nothing on it but the pane. */
async function emptyPoint(page: Page) {
  return page.evaluate(() => {
    for (let y = 200; y < innerHeight - 200; y += 13) {
      for (let x = 20; x < innerWidth - 20; x += 13) {
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
      }
    }
    throw new Error('no empty point');
  });
}

async function positions(page: Page): Promise<Record<string, { x: number; y: number }>> {
  return page.evaluate(() => JSON.parse(window.gsDev.gsmap()).positions);
}

/** Select a note the way "Reveal note in graph" does: it is panned into the free area, with its peek card. */
async function reveal(page: Page, key: string) {
  await page.evaluate((k) => window.gsDev.reveal(k), key);
  await expect(peek(page)).toContainText(key);
  await page.waitForTimeout(400); // the pan
}

/** Every surface of ours that is not modal. */
const OURS = '.gs-phone-toolbar, .gs-dock, .gs-toast';

async function clearOfNavbar(page: Page) {
  const bar = (await navbar(page).boundingBox())!;
  for (const box of await page.locator(OURS).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))) {
    expect(overlap(box, bar), `${JSON.stringify(box)} is under the navbar ${JSON.stringify(bar)}`).toBe(false);
  }
}

test.use({ viewport: PORTRAIT, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/?phone=1&saveDelay=200&today=2026-10-01');
  await expect(node(page, 'B-1')).toBeVisible();
});

test('a phone shows the phone toolbar instead of the desktop controls and panels', async ({ page }) => {
  await expect(page.locator('.react-flow__controls')).toHaveCount(0);
  await expect(page.locator('.gs-toolbar')).toHaveCount(0);
  const bar = page.getByRole('toolbar', { name: 'Graph' });
  for (const name of ['Fit view', /^Smells, \d+$/, 'Review walk', 'More graph options']) await expect(bar.getByRole('button', { name })).toBeVisible();
  // The row fits the phone's width: nothing scrolls out of reach.
  for (const right of await bar.getByRole('button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right))) expect(right).toBeLessThanOrEqual(PORTRAIT.width);
  await clearOfNavbar(page);
  // The graph's issues (the test vault has one) are under ⋯.
  await bar.getByRole('button', { name: 'More graph options' }).tap();
  await page.getByRole('menuitem', { name: /issues? on the graph/ }).tap();
  await expect(page.getByRole('dialog', { name: 'Issues' }).locator('.gs-notice')).not.toHaveCount(0);
});

test('tap a node: it is selected and its peek card docks; a tap on empty graph closes it', async ({ page }) => {
  await reveal(page, 'B-3');
  await press(page, await emptyPoint(page), 40);
  await expect(peek(page)).toHaveCount(0);
  await expect(node(page, 'B-3')).not.toHaveClass(/selected/);
  await tap(page, 'B-3');
  await expect(node(page, 'B-3')).toHaveClass(/selected/);
  await expect(peek(page)).toContainText('B-3');
  await expect(peek(page).getByRole('button', { name: 'Details', exact: true })).toBeVisible();
  await expect(peek(page).getByRole('button', { name: 'Open note' })).toBeVisible();
  // A tap never opens the note.
  expect(await page.evaluate(() => window.gsDev.opened())).toEqual([]);
  await press(page, await emptyPoint(page), 40);
  await expect(peek(page)).toHaveCount(0);
});

test('the peek card never covers its node, and nothing of ours is under the navbar', async ({ page }) => {
  await reveal(page, 'B-3');
  const [n, card] = [(await node(page, 'B-3').boundingBox())!, (await peek(page).boundingBox())!];
  expect(overlap(n, card)).toBe(false);
  await clearOfNavbar(page);
  // Open note is only a button away.
  await peek(page).getByRole('button', { name: 'Open note' }).tap();
  expect(await page.evaluate(() => window.gsDev.opened())).toEqual([expect.stringContaining('B-3')]);
});

test('double-tap a node: the details sheet, never the note; Escape and a tap on the scrim close it', async ({ page }) => {
  await reveal(page, 'B-1');
  await doubleTap(page, 'B-1');
  const sheet = page.getByRole('dialog', { name: 'Details for B-1' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('group', { name: 'Status' })).toBeVisible();
  expect(await page.evaluate(() => window.gsDev.opened())).toEqual([]);
  // It covers the navbar: modal.
  const [s, bar] = [(await sheet.boundingBox())!, (await navbar(page).boundingBox())!];
  expect(overlap(s, bar)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  await peek(page).getByRole('button', { name: 'Details', exact: true }).tap();
  await expect(sheet).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).tap({ position: { x: 20, y: 60 } });
  await expect(sheet).toHaveCount(0);
});

test('the details sheet edits the note: a status chip sets the status', async ({ page }) => {
  await reveal(page, 'B-2');
  await peek(page).getByRole('button', { name: 'Details', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: 'Details for B-2' });
  await sheet.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'active' }).tap();
  await expect(sheet.getByRole('button', { name: 'active' })).toHaveAttribute('aria-pressed', 'true');
  await expect(node(page, 'B-2')).toContainText('active');
});

test('long-press a node: the actions sheet, which replaces the right-click menu; Cancel closes it', async ({ page }) => {
  await reveal(page, 'B-1');
  await press(page, await centre(page, 'B-1'), 700);
  const actions = page.getByRole('dialog', { name: /^B-1 / });
  await expect(actions).toBeVisible();
  for (const name of ['Show details', 'Open note', 'Add assumption', 'Kill → activate next']) await expect(actions.getByRole('menuitem', { name })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: 'Open in split' })).toHaveCount(0);
  await actions.getByRole('button', { name: 'Cancel' }).tap();
  await expect(actions).toHaveCount(0);
  // The long-press didn't count as a tap that opens anything.
  expect(await page.evaluate(() => window.gsDev.opened())).toEqual([]);
});

test('killing a bet from the actions sheet asks first, in a sheet', async ({ page }) => {
  await reveal(page, 'B-1');
  await press(page, await centre(page, 'B-1'), 700);
  await page.getByRole('menuitem', { name: 'Kill → activate next' }).tap();
  const confirm = page.getByRole('dialog', { name: 'Kill → activate next' });
  await expect(confirm).toContainText(/Kill B-1 and activate B-\d+\?/);
  await confirm.getByRole('button', { name: 'Cancel' }).tap();
  await expect(confirm).toHaveCount(0);
  await expect(node(page, 'B-1')).toContainText('active');
});

test('one finger pans, even from a node, and moves no node until Edit layout is on', async ({ page }) => {
  await reveal(page, 'B-1');
  const before = await positions(page);
  const [b1, b3] = [await centre(page, 'B-1'), await centre(page, 'B-3')];
  await swipe(page, b1, -60, -90);
  await page.waitForTimeout(500);
  const [b1After, b3After] = [await centre(page, 'B-1'), await centre(page, 'B-3')];
  // Everything moved together: a pan.
  expect(Math.round(b1After.x - b1.x)).toBe(Math.round(b3After.x - b3.x));
  expect(Math.round(b1After.y - b1.y)).toBe(Math.round(b3After.y - b3.y));
  expect(Math.abs(b1After.y - b1.y)).toBeGreaterThan(30);
  expect(await positions(page)).toEqual(before);

  await page.getByRole('button', { name: 'More graph options' }).tap();
  await page.getByRole('menuitem', { name: 'Edit layout' }).tap();
  await expect(page.getByRole('button', { name: 'Done editing layout' })).toBeVisible();
  const from = await centre(page, 'B-1');
  const other = await centre(page, 'B-3');
  await swipe(page, from, 0, 60);
  await expect.poll(async () => (await positions(page))['B-1']?.y).not.toBe(before['B-1']?.y);
  // Only the dragged note (and what goes with it) moved on screen; B-3 stayed.
  const otherAfter = await centre(page, 'B-3');
  expect(Math.round(otherAfter.y)).toBe(Math.round(other.y));
  await page.getByRole('button', { name: 'Done editing layout' }).tap();
  await expect(page.getByRole('button', { name: 'Done editing layout' })).toHaveCount(0);
});

test('the smells sheet: a tap on a smell closes it, selects the note and pans it into view', async ({ page }) => {
  await page.getByRole('button', { name: /^Smells, \d+$/ }).tap();
  const sheet = page.getByRole('dialog', { name: 'Smells' });
  await expect(sheet).toBeVisible();
  await sheet.locator('[data-code=falsified-dependency]').getByRole('button').first().tap();
  await expect(sheet).toHaveCount(0);
  await expect(peek(page)).toBeVisible();
  const key = (await peek(page).locator('.gs-peek-id').textContent())!;
  await page.waitForTimeout(400);
  const [n, card] = [(await node(page, key).boundingBox())!, (await peek(page).boundingBox())!];
  expect(overlap(n, card)).toBe(false);
  expect(n.y).toBeGreaterThan(0);
});

test('the review walk docks above the navbar; each step pans its note clear of it', async ({ page }) => {
  await page.getByRole('button', { name: 'Review walk' }).tap();
  await expect(walk(page)).toContainText(/Step 1 of \d+/);
  await expect(peek(page)).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(400);
    const selected = page.locator('.react-flow__node.selected');
    const [n, card] = [(await selected.boundingBox())!, (await walk(page).boundingBox())!];
    expect(overlap(n, card)).toBe(false);
    expect(overlap(n, (await navbar(page).boundingBox())!)).toBe(false);
    await clearOfNavbar(page);
    await walk(page).getByRole('button', { name: /^Next: / }).tap();
  }
  await walk(page).getByRole('button', { name: 'Details', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: /^Details for / })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'End walk' }).tap();
  await expect(walk(page)).toHaveCount(0);
});

test('⋯ → Add card makes a card and opens it in the details sheet; left empty, it goes again', async ({ page }) => {
  const cards = await page.locator('.react-flow__node-card').count();
  await page.getByRole('button', { name: 'More graph options' }).tap();
  await page.getByRole('menuitem', { name: 'Add card' }).tap();
  const sheet = page.getByRole('dialog', { name: /^Details for / });
  await expect(sheet.getByLabel('Text')).toBeFocused();
  await expect(page.locator('.react-flow__node-card')).toHaveCount(cards + 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.react-flow__node-card')).toHaveCount(cards);

  await page.getByRole('button', { name: 'More graph options' }).tap();
  await page.getByRole('menuitem', { name: 'Add card' }).tap();
  await sheet.getByLabel('Text').fill('Ask about the lease');
  await page.keyboard.press('Escape');
  await expect(page.locator('.react-flow__node-card')).toHaveCount(cards + 1);
  await expect(page.locator('.react-flow__node-card').filter({ hasText: 'Ask about the lease' })).toHaveCount(1);
});

test.describe('landscape', () => {
  test.use({ viewport: LANDSCAPE });

  test('the toolbar is a rail on the left, the peek card docks on the right, and a sheet is on the right', async ({ page }) => {
    const rail = (await page.getByRole('toolbar', { name: 'Graph' }).boundingBox())!;
    expect(rail.height).toBeGreaterThan(rail.width);
    await reveal(page, 'B-1');
    const card = (await peek(page).boundingBox())!;
    expect(card.x).toBeGreaterThan(LANDSCAPE.width / 2);
    const n = (await node(page, 'B-1').boundingBox())!;
    expect(overlap(n, card)).toBe(false);
    expect(overlap(n, rail)).toBe(false);
    await clearOfNavbar(page);

    await peek(page).getByRole('button', { name: 'Details', exact: true }).tap();
    const sheet = page.locator('.gs-sheet');
    const s = (await sheet.boundingBox())!;
    expect(Math.round(s.x + s.width)).toBe(LANDSCAPE.width);
    expect(Math.round(s.width)).toBe(430);
    expect(Math.round(s.height)).toBe(LANDSCAPE.height);
  });

  test('a walk step pans its note clear of the rail, the docked walk and the navbar', async ({ page }) => {
    await page.getByRole('button', { name: 'Review walk' }).tap();
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(400);
      const n = (await page.locator('.react-flow__node.selected').boundingBox())!;
      for (const surface of [walk(page), navbar(page), page.getByRole('toolbar', { name: 'Graph' })]) expect(overlap(n, (await surface.boundingBox())!)).toBe(false);
      await clearOfNavbar(page);
      await walk(page).getByRole('button', { name: /^Next: / }).tap();
    }
  });
});

test('@visual phone surfaces, portrait', async ({ page }) => {
  await reveal(page, 'B-1');
  await expect(page).toHaveScreenshot('phone-peek.png');
  await peek(page).getByRole('button', { name: 'Details', exact: true }).tap();
  await expect(page).toHaveScreenshot('phone-details.png');
});
