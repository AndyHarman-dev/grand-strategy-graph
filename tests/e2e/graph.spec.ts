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

test('saves a dragged bet once, on drag end, leaving the rest alone', async ({ page }) => {
  const before = await positions(page);
  await drag(page, 'B-3', 120, 60, { release: false });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.gsDev.writes())).toBe(0);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(1);
  const after = await positions(page);
  expect(after['B-3'].x).toBeGreaterThan(before['B-3'].x);
  expect(after['B-3'].y).toBeGreaterThan(before['B-3'].y);
  // Only B-3 and the assumptions it hosts (A-3, A-4) moved.
  expect({ ...after, 'B-3': before['B-3'], 'A-3': before['A-3'], 'A-4': before['A-4'] }).toEqual(before);
  expect(after['A-3'].x - before['A-3'].x).toBe(after['B-3'].x - before['B-3'].x);
  // The node stays where it was dropped.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.gsDev.writes())).toBe(1);
});

test('a dragged bet takes its assumptions along, and both are saved in one write (D19)', async ({ page }) => {
  // In the migrated test vault A-1 is held by B-1 only; A-2 is shared with B-4 but B-1 comes first, so B-1 hosts both.
  const before = await positions(page);
  const a1 = await offset(page, 'A-1', 'B-1');
  await drag(page, 'B-1', 80, 140, { release: false });
  expect(await offset(page, 'A-1', 'B-1')).toEqual(a1); // follows during the drag, not only after
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(1);
  expect(await offset(page, 'A-1', 'B-1')).toEqual(a1);
  const after = await positions(page);
  const moved = (key: string) => ({ dx: after[key].x - before[key].x, dy: after[key].y - before[key].y });
  expect(moved('A-1')).toEqual(moved('B-1'));
  expect(moved('A-2')).toEqual(moved('B-1'));
  expect(moved('B-1').dy).toBeGreaterThan(0);
  // B-2, B-1's sequel, is not an assumption: it stays.
  expect(after['B-2']).toEqual(before['B-2']);
});

test('edges stay drawn through drags and saves, every frame', async ({ page }) => {
  // React Flow draws an edge only once both ends are measured; rebuilding the nodes after a save
  // must not throw those measurements away, or every edge drops out until it re-measures.
  await expect(page.locator('.react-flow__edge')).toHaveCount(19);
  await page.evaluate(() => {
    const w = window as unknown as { minEdges: number };
    w.minEdges = Infinity;
    const sample = () => {
      w.minEdges = Math.min(w.minEdges, document.querySelectorAll('.react-flow__edge').length);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  for (const [i, key] of ['B-3', 'B-1', 'A-5', 'B-4'].entries()) {
    await drag(page, key, 40, 30);
    await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(i + 1);
    await page.waitForTimeout(100);
  }
  expect(await page.evaluate(() => (window as unknown as { minEdges: number }).minEdges)).toBe(19);
});

/** Every node's offset from B-1, independent of the viewport. */
async function layoutOf(page: Page) {
  const boxes = await page.locator('.react-flow__node').evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute('data-id')!, ...JSON.parse(JSON.stringify(el.getBoundingClientRect())) }))
  );
  const b1 = boxes.find((b) => b.id === 'B-1')!;
  return Object.fromEntries(boxes.map((b) => [b.id, { dx: Math.round(b.x - b1.x), dy: Math.round(b.y - b1.y) }]));
}

test('the reset button forgets every saved position, after a confirmation, and shows the automatic layout', async ({ page }) => {
  await page.goto('/?layout=auto');
  await expect(page.locator('.react-flow__node')).toHaveCount(18);
  await expect(page.getByRole('button', { name: 'Reset layout' })).toBeDisabled(); // nothing saved
  const auto = await layoutOf(page);

  await page.goto('/?saveDelay=200');
  await expect(node(page, 'B-1')).toBeVisible();
  await drag(page, 'B-3', 200, 150);
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(1);
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await page.getByRole('dialog', { name: 'Reset layout' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.gsDev.writes())).toBe(1);

  await page.getByRole('button', { name: 'Reset layout' }).click();
  await page.getByRole('dialog', { name: 'Reset layout' }).getByRole('button', { name: 'Reset' }).click();
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(2);
  expect(await positions(page)).toEqual({});
  await expect(page.locator('.react-flow__edge')).toHaveCount(19);
  await page.waitForTimeout(400); // the fit
  expect(await layoutOf(page)).toEqual(auto);
  // The view is fitted to the new layout: every node is inside the pane.
  const pane = (await page.locator('.react-flow').boundingBox())!;
  for (const box of await page.locator('.react-flow__node').evaluateAll((els) => els.map((el) => JSON.parse(JSON.stringify(el.getBoundingClientRect()))))) {
    expect(box.x).toBeGreaterThanOrEqual(pane.x);
    expect(box.y).toBeGreaterThanOrEqual(pane.y);
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width);
    expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height);
  }
  await expect(page.getByRole('button', { name: 'Reset layout' })).toBeDisabled();
});

test('without saved positions, assumptions sit above their host and the sequel below its bet (D19)', async ({ page }) => {
  await page.goto('/?layout=auto');
  await expect(page.locator('.react-flow__node')).toHaveCount(18);
  const box = async (key: string) => (await node(page, key).boundingBox())!;
  const [b1, a1, b2] = [await box('B-1'), await box('A-1'), await box('B-2')];
  expect(a1.y + a1.height).toBeLessThan(b1.y);
  expect(Math.abs(a1.x + a1.width / 2 - (b1.x + b1.width / 2))).toBeLessThan(2);
  expect(b2.x).toBeCloseTo(b1.x, 0);
  expect(b2.y).toBeGreaterThan(b1.y + b1.height);
  const all = await page.locator('.react-flow__node').evaluateAll((els) => els.map((el) => JSON.parse(JSON.stringify(el.getBoundingClientRect()))));
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
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

  test('migrated test vault, automatic layout', async ({ page }) => {
    await page.goto('/?layout=auto');
    await expect(page.locator('.react-flow__node')).toHaveCount(18);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('migrated-auto.png');
  });

  test('legacy test vault, dark', async ({ page }) => {
    await page.goto('/?vault=legacy&theme=dark');
    await expect(page.locator('.react-flow__node')).toHaveCount(17);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('legacy-dark.png');
  });
});
