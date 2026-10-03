import { expect, test, type Page } from '@playwright/test';

/**
 * The graph on the dev page (dev/), over the test vault migrated in memory. `window.gsDev`
 * reads the in-memory `.gsmap` and changes notes the way metadataCache events would.
 */

const node = (page: Page, key: string) => page.locator(`.react-flow__node[data-id="${key}"]`);

async function positions(page: Page): Promise<Record<string, { x: number; y: number }>> {
  return page.evaluate(() => JSON.parse(window.gsDev.gsmap()).positions);
}

async function drag(page: Page, key: string, dx: number, dy: number, { release = true } = {}) {
  const box = (await node(page, key).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  if (release) await page.mouse.up();
}

/** A node's offset from another one: unchanged by panning, which a drag that starts on a locked node does. */
async function offset(page: Page, key: string, from: string) {
  const [a, b] = [(await node(page, key).boundingBox())!, (await node(page, from).boundingBox())!];
  return { dx: Math.round(a.x - b.x), dy: Math.round(a.y - b.y) };
}

const overlap = (a: DOMRect | { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.beforeEach(async ({ page }) => {
  await page.goto('/?saveDelay=200');
  await expect(node(page, 'B-1')).toBeVisible();
});

test('shows every strategy note of the migrated test vault', async ({ page }) => {
  await expect(page.locator('.react-flow__node')).toHaveCount(18);
  await expect(node(page, 'B-1')).toContainText('Get a D7 visa');
  await expect(node(page, 'B-1')).toContainText('active');
  await expect(node(page, 'CP')).toContainText('Current Position');
  // Every relation of the migrated vault is an edge: the hand-written v2 vault's 18, minus B-6's
  // phantom link (kept as is, D13), plus B-7's two retargeted by the fixture answers. It has no
  // `ultimately-serves`, which would be hidden.
  await expect(page.locator('.react-flow__edge')).toHaveCount(19);
});

test('saves a dragged bet once, on drag end, leaving other positions alone', async ({ page }) => {
  const before = await positions(page);
  await drag(page, 'B-3', 120, 60, { release: false });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.gsDev.writes())).toBe(0);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(1);
  const after = await positions(page);
  expect(after['B-3'].x).toBeGreaterThan(before['B-3'].x);
  expect(after['B-3'].y).toBeGreaterThan(before['B-3'].y);
  expect({ ...after, 'B-3': before['B-3'] }).toEqual(before);
  // The node stays where it was dropped.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.gsDev.writes())).toBe(1);
});

test('fixed points are locked', async ({ page }) => {
  const before = await offset(page, 'FP-1', 'B-1');
  await drag(page, 'FP-1', 150, 80);
  await page.waitForTimeout(500);
  expect(await offset(page, 'FP-1', 'B-1')).toEqual(before);
  expect(await page.evaluate(() => window.gsDev.writes())).toBe(0);
});

test('a new note appears, placed where it overlaps nothing, without being saved', async ({ page }) => {
  await page.evaluate(() =>
    window.gsDev.setFile(
      'Strategy/Bets/B-9 Open a studio.md',
      '---\nid: B-9\ntype: bet\nstatus: active\nserves:\n  - "[[FP-2 Own a profitable ceramics studio]]"\n---\n'
    )
  );
  await expect(node(page, 'B-9')).toBeVisible();
  const boxes = await page.locator('.react-flow__node').evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute('data-id'), ...JSON.parse(JSON.stringify(el.getBoundingClientRect())) }))
  );
  const b9 = boxes.find((b) => b.id === 'B-9')!;
  expect(boxes.filter((b) => b.id !== 'B-9' && overlap(b, b9)).map((b) => b.id)).toEqual([]);
  expect(await page.evaluate(() => window.gsDev.writes())).toBe(0);
  const fp2 = (await node(page, 'FP-2').boundingBox())!;
  expect(b9.x).toBeLessThan(fp2.x);
});

test('a changed status re-renders the node', async ({ page }) => {
  await page.evaluate(() => {
    const path = 'Strategy/Bets/B-7  Part-time barista job.md';
    window.gsDev.setFile(path, window.gsDev.file(path).replace('status: active', 'status: won'));
  });
  await expect(node(page, 'B-7')).toContainText('won');
});

test('Reveal centers and selects the node', async ({ page }) => {
  await page.evaluate(() => window.gsDev.reveal('B-8'));
  await expect(node(page, 'B-8')).toHaveClass(/selected/);
  await page.waitForTimeout(500);
  const box = (await node(page, 'B-8').boundingBox())!;
  const pane = (await page.locator('.react-flow').boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (pane.x + pane.width / 2))).toBeLessThan(5);
  expect(Math.abs(box.y + box.height / 2 - (pane.y + pane.height / 2))).toBeLessThan(5);
});

test('double-click opens the note', async ({ page }) => {
  await node(page, 'B-1').dblclick();
  expect(await page.evaluate(() => window.gsDev.opened())).toEqual(['Strategy/Bets/B-1 Get a D7 visa.md']);
});

test('a changed id is reported', async ({ page }) => {
  await page.evaluate(() => {
    const path = 'Strategy/Bets/B-1 Get a D7 visa.md';
    window.gsDev.setFile(path, window.gsDev.file(path).replace('id: B-1', 'id: B-21'));
  });
  await expect(node(page, 'B-21')).toBeVisible();
  await page.getByRole('button', { name: /issues?$/ }).click();
  await expect(page.locator('.gs-notices-list')).toContainText('changed id from "B-1" to "B-21"');
});

test('the legacy vault lists its problems and still lays out every node', async ({ page }) => {
  await page.goto('/?vault=legacy');
  await expect(page.locator('.react-flow__node')).toHaveCount(17);
  const toggle = page.getByRole('button', { name: /issues$/ });
  await expect(toggle).toHaveText(/^\d+ issues$/);
  await toggle.click();
  await expect(page.locator('.gs-notices-list')).toContainText('Note has no `id`.');
  // No id, so nothing can be saved: nodes don't drag.
  const b1 = 'Strategy/Bets/B-1 Get a D7 visa.md';
  const before = await offset(page, b1, 'Strategy/Bets/B-2 Apply for a digital nomad visa.md');
  await drag(page, b1, 100, 100);
  expect(await offset(page, b1, 'Strategy/Bets/B-2 Apply for a digital nomad visa.md')).toEqual(before);
});

test.describe('screenshots @visual', () => {
  test('migrated test vault, light', async ({ page }) => {
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('migrated-light.png');
  });

  test('legacy test vault, dark', async ({ page }) => {
    await page.goto('/?vault=legacy&theme=dark');
    await expect(page.locator('.react-flow__node')).toHaveCount(17);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('legacy-dark.png');
  });
});
