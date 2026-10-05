import { expect, test, type Page } from '@playwright/test';

/**
 * The graph on the dev page (dev/), over the test vault migrated in memory. `window.gsDev`
 * reads the in-memory `.gsmap` and changes notes the way metadataCache events would.
 */

const node = (page: Page, key: string) => page.locator(`.react-flow__node[data-id="${key}"]`);
/** The notes: free cards and frames are nodes too, and have their own tests. */
const NOTES = '.react-flow__node-strategy';

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
  await expect(page.locator(NOTES)).toHaveCount(18);
  await expect(node(page, 'B-1')).toContainText('Get a D7 visa');
  await expect(node(page, 'B-1')).toContainText('active');
  await expect(node(page, 'CP')).toContainText('Current Position');
  // Every relation of the migrated vault is an edge: the hand-written v2 vault's 18, minus B-6's
  // phantom link (kept as is, D13), plus B-7's two retargeted by the fixture answers. It has no
  // `ultimately-serves`, which would be hidden.
  await expect(page.locator('.react-flow__edge:not(.gs-link)')).toHaveCount(19);
  // The canvas's free part comes along: its 5 cards (the "AND" diamond is drawn from B-4's requires instead),
  // 2 frames and the 5 lines that touch cards or are annotations.
  await expect(page.locator('.react-flow__node-card')).toHaveCount(5);
  await expect(page.locator('.react-flow__node-frame')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge.gs-link')).toHaveCount(5);
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

test('dragging a bet pushes what it requires to the left, horizontally only, and only when it comes too close', async ({ page }) => {
  // B-4 requires B-3 and B-5 (both 600 left of it, B-3 hosting A-3 and A-4).
  const before = await positions(page);
  const [b3, b4] = [(await node(page, 'B-3').boundingBox())!, (await node(page, 'B-4').boundingBox())!];
  const a3 = await offset(page, 'A-3', 'B-3');
  // A small move to the right leaves them alone.
  await drag(page, 'B-4', 60, 0);
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(1);
  let after = await positions(page);
  for (const key of ['B-3', 'B-5', 'A-3']) expect(after[key], key).toEqual(before[key]);

  // Onto B-3's column: both are pushed, during the drag already, and their assumptions go with them.
  const start = (await node(page, 'B-4').boundingBox())!;
  await drag(page, 'B-4', b3.x - start.x, 0, { release: false });
  expect((await node(page, 'B-3').boundingBox())!.x).toBeLessThan(b3.x - 10);
  expect(await offset(page, 'A-3', 'B-3')).toEqual(a3);
  // Back where it started: so are they.
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2, { steps: 5 });
  expect(Math.round((await node(page, 'B-3').boundingBox())!.x)).toBe(Math.round(b3.x));
  await page.mouse.move(start.x + start.width / 2 + b3.x - start.x, start.y + start.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(2);
  after = await positions(page);
  for (const key of ['B-3', 'B-5']) {
    expect(after[key].x, key).toBeLessThan(after['B-4'].x - 200); // still left of it, a card's width and a gap
    expect(after[key].y, key).toBe(before[key].y);
  }
  expect(after['A-3'].x - before['A-3'].x).toBe(after['B-3'].x - before['B-3'].x);
  // The rest stayed.
  for (const key of ['B-1', 'B-2', 'B-6', 'B-7', 'B-8', 'FP-1', 'CP']) expect(after[key], key).toEqual(before[key]);
  expect(b4.x).toBeGreaterThan(b3.x);
});

test('a note that requires two or more gets an AND in front of it, which moves with it alone', async ({ page }) => {
  const and = page.locator('.react-flow__node-junction[data-id="and:B-4"]');
  await expect(and).toContainText('AND');
  await expect(page.locator('.react-flow__node-junction')).toHaveCount(1); // B-4 is the only one
  // B-3 and B-5 point at the AND, and the AND at B-4; the serves twins of those requires are not drawn again.
  const edge = (from: string, to: string) => page.getByRole('img', { name: `Edge from ${from} to ${to}`, exact: true });
  await expect(edge('B-3', 'and:B-4')).toHaveCount(1);
  await expect(edge('B-5', 'and:B-4')).toHaveCount(1);
  await expect(edge('and:B-4', 'B-4')).toHaveCount(1);
  await expect(edge('B-5', 'B-4')).toHaveCount(0); // B-5 serves B-4 too
  const and0 = await offset(page, 'and:B-4', 'B-4');
  expect(and0.dx).toBeLessThan(0); // just left of its holder

  await drag(page, 'B-4', 70, 90, { release: false });
  expect(await offset(page, 'and:B-4', 'B-4')).toEqual(and0); // during the drag
  await page.mouse.up();
  expect(await offset(page, 'and:B-4', 'B-4')).toEqual(and0);
  for (const key of ['B-3', 'B-5']) {
    await drag(page, key, -40, 120);
    expect(await offset(page, 'and:B-4', 'B-4'), key).toEqual(and0);
  }
  // It is not a note: it says what it joins, has no menu of its own, and is never saved.
  await expect(and.locator('.gs-junction')).toHaveAttribute('title', 'Requires all of: B-3, B-5');
  await and.click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.evaluate(() => window.gsDev.flush());
  expect(Object.keys(await positions(page))).not.toContain('and:B-4');
});

test('edges stay drawn through drags and saves, every frame', async ({ page }) => {
  // React Flow draws an edge only once both ends are measured; rebuilding the nodes after a save
  // must not throw those measurements away, or every edge drops out until it re-measures.
  await expect(page.locator('.react-flow__edge:not(.gs-link)')).toHaveCount(19);
  await page.evaluate(() => {
    const w = window as unknown as { minEdges: number };
    w.minEdges = Infinity;
    const sample = () => {
      w.minEdges = Math.min(w.minEdges, document.querySelectorAll('.react-flow__edge:not(.gs-link)').length);
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
  const boxes = await page.locator(NOTES).evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute('data-id')!, ...JSON.parse(JSON.stringify(el.getBoundingClientRect())) }))
  );
  const b1 = boxes.find((b) => b.id === 'B-1')!;
  return Object.fromEntries(boxes.map((b) => [b.id, { dx: Math.round(b.x - b1.x), dy: Math.round(b.y - b1.y) }]));
}

test('the first drag in an unsaved layout pins everything, so nothing else moves', async ({ page }) => {
  await page.goto('/?layout=auto&saveDelay=200');
  await expect(page.locator(NOTES)).toHaveCount(18);
  const before = await layoutOf(page);
  await drag(page, 'B-3', 60, 120);
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(1);
  await page.waitForTimeout(300);
  const after = await layoutOf(page);
  // Offsets are from B-1, which stayed: only B-3 and the assumptions it hosts moved.
  const moved = Object.keys(after).filter((k) => after[k].dx !== before[k].dx || after[k].dy !== before[k].dy);
  expect(moved.sort()).toEqual(['A-3', 'A-4', 'B-3']);
  expect(Object.keys(await positions(page)).sort()).toEqual(Object.keys(after).sort());
  // The next drag writes only what moved.
  const saved = await positions(page);
  await drag(page, 'B-5', 40, 40);
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(2);
  const next = await positions(page);
  expect(Object.keys(next).filter((k) => next[k].x !== saved[k].x || next[k].y !== saved[k].y).sort()).toEqual(['A-5', 'B-5']); // B-5 and its assumption
});

const selected = (page: Page) =>
  page.locator('.react-flow__node.selected').evaluateAll((els) => els.map((el) => el.getAttribute('data-id')!).sort());

const rectOf = async (page: Page, key: string) => (await node(page, key).boundingBox())!;

test.describe('selecting several nodes, as on a canvas', () => {
  test('dragging on empty space draws a selection box; dragging one selected node moves them all, saved in one write', async ({ page }) => {
    const [b7, b8] = [await rectOf(page, 'B-7'), await rectOf(page, 'B-8')];
    // Start on the pane: a link under the pointer would be picked instead (links can be selected and removed since Phase 6).
    const onPane = (x: number, y: number) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.classList.contains('react-flow__pane'), [x, y]);
    let margin = 12;
    while (!(await onPane(Math.min(b7.x, b8.x) - margin, Math.min(b7.y, b8.y) - margin)) && margin < 60) margin += 6;
    const box = { x1: Math.min(b7.x, b8.x) - margin, y1: Math.min(b7.y, b8.y) - margin, x2: Math.max(b7.x + b7.width, b8.x + b8.width) + 12, y2: Math.max(b7.y + b7.height, b8.y + b8.height) + 12 };
    expect(await onPane(box.x1, box.y1)).toBe(true);
    // Every node the box touches gets selected (partial overlap counts).
    const touched = await page.locator(NOTES).evaluateAll(
      (els, b) => els.filter((el) => { const r = el.getBoundingClientRect(); return r.x < b.x2 && r.right > b.x1 && r.y < b.y2 && r.bottom > b.y1; }).map((el) => el.getAttribute('data-id')!).sort(),
      box
    );
    expect(touched).toEqual(expect.arrayContaining(['B-7', 'B-8']));
    const before = await positions(page);
    await page.mouse.move(box.x1, box.y1);
    await page.mouse.down();
    await page.mouse.move(box.x2, box.y2, { steps: 8 });
    await page.mouse.up();
    expect(await selected(page)).toEqual(touched);
    expect(await page.evaluate(() => window.gsDev.writes())).toBe(0); // selecting moves nothing

    await drag(page, 'B-7', 90, 70);
    await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(1);
    const after = await positions(page);
    const delta = (k: string) => ({ dx: after[k].x - before[k].x, dy: after[k].y - before[k].y });
    for (const key of touched) if (key !== 'FP-1' && key !== 'FP-2') expect(delta(key)).toEqual(delta('B-7'));
    expect(delta('B-7').dx).toBeGreaterThan(0);
    expect(after['B-1']).toEqual(before['B-1']);
  });

  test('Shift-click adds and removes, Escape clears, Cmd/Ctrl+A selects every node', async ({ page }) => {
    await node(page, 'B-1').click();
    await node(page, 'B-3').click({ modifiers: ['Shift'] });
    await node(page, 'B-5').click({ modifiers: ['Shift'] });
    expect(await selected(page)).toEqual(['B-1', 'B-3', 'B-5']);
    await node(page, 'B-3').click({ modifiers: ['Shift'] });
    expect(await selected(page)).toEqual(['B-1', 'B-5']);

    const before = await positions(page);
    await drag(page, 'B-5', -50, 60);
    await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(1);
    const after = await positions(page);
    // B-1 and B-5 moved together, with the assumptions they host (A-1, A-2; A-5); nothing else.
    const moved = Object.keys(after).filter((k) => after[k].x !== before[k].x || after[k].y !== before[k].y).sort();
    expect(moved).toEqual(['A-1', 'A-2', 'A-5', 'B-1', 'B-5']);
    for (const key of moved) expect(after[key].x - before[key].x).toBe(after['B-5'].x - before['B-5'].x);

    await page.keyboard.press('Escape');
    expect(await selected(page)).toEqual([]);
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.locator(`${NOTES}.selected`)).toHaveCount(18);
    // Selecting all and pressing Escape works after a click on the empty pane, too.
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.click(pane.x + 5, pane.y + pane.height - 5);
    expect(await selected(page)).toEqual([]);
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.locator(`${NOTES}.selected`)).toHaveCount(18);
    await page.keyboard.press('Escape');
    expect(await selected(page)).toEqual([]);
  });

  test('arrow keys nudge the selection, its assumptions along, and save it', async ({ page }) => {
    await node(page, 'B-1').click();
    await node(page, 'B-8').click({ modifiers: ['Shift'] });
    const before = await positions(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(1);
    const after = await positions(page);
    for (const key of ['B-1', 'B-8', 'A-1', 'A-2']) expect({ key, dx: after[key].x - before[key].x, dy: after[key].y - before[key].y }).toEqual({ key, dx: 5, dy: 20 });
    expect(after['B-3']).toEqual(before['B-3']);
  });

  test.describe('on a Mac trackpad', () => {
    test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) obsidian/1.9.0 Chrome/132.0.0.0 Electron/34.0.0 Safari/537.36' });

    test('a two-finger swipe pans any way, over a node too, and a pinch zooms', async ({ page }) => {
      await page.goto('/');
      await expect(node(page, 'B-1')).toBeVisible();
      const a = await rectOf(page, 'B-1');
      // A swipe arrives as wheel events with both deltas (no modifier key).
      await page.mouse.move(700, 450);
      for (let i = 0; i < 5; i++) await page.mouse.wheel(30, 20);
      await page.waitForTimeout(150);
      const b = await rectOf(page, 'B-1');
      expect(Math.round(a.x - b.x)).toBe(150);
      expect(Math.round(a.y - b.y)).toBe(100);
      expect(b.width).toBeCloseTo(a.width, 0);
      // Starting over a node, the swipe still pans the view, not the node.
      const over = await rectOf(page, 'B-3');
      await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2);
      await page.mouse.wheel(-40, 0);
      await page.waitForTimeout(150);
      expect(Math.round((await rectOf(page, 'B-1')).x - b.x)).toBe(40);
      expect(await page.evaluate(() => window.gsDev.writes())).toBe(0);
      // macOS sends a pinch as wheel events with ctrlKey set.
      const before = (await rectOf(page, 'B-1')).width;
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -40);
      await page.keyboard.up('Control');
      await page.waitForTimeout(150);
      expect((await rectOf(page, 'B-1')).width).toBeGreaterThan(before * 1.1);
    });
  });

  test('scroll pans, Cmd/Ctrl+scroll zooms', async ({ page }) => {
    const a = await rectOf(page, 'B-1');
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(200);
    const b = await rectOf(page, 'B-1');
    expect(b.y).toBeLessThan(a.y - 50);
    expect(b.width).toBeCloseTo(a.width, 0);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    expect((await rectOf(page, 'B-1')).width).toBeGreaterThan(b.width * 1.1);
  });
});

test('the reset button forgets every saved position, after a confirmation, and shows the automatic layout', async ({ page }) => {
  await page.goto('/?layout=auto');
  await expect(page.locator(NOTES)).toHaveCount(18);
  await expect(page.getByRole('button', { name: 'Reset layout' })).toBeDisabled(); // nothing saved
  // The nodes are in before the view is fitted to them: measure once it has been.
  await expect(page.locator('.react-flow__viewport')).not.toHaveAttribute('style', /scale\(1\)/);
  await page.waitForTimeout(100);
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
  await expect(page.locator('.react-flow__edge:not(.gs-link)')).toHaveCount(19);
  // ELK lays the graph out again and the view then fits it: both take longer when the machine is busy.
  await expect.poll(() => layoutOf(page), { timeout: 10_000 }).toEqual(auto);
  // The view is fitted to the new layout: every node is inside the pane.
  const pane = (await page.locator('.react-flow').boundingBox())!;
  for (const box of await page.locator(NOTES).evaluateAll((els) => els.map((el) => JSON.parse(JSON.stringify(el.getBoundingClientRect()))))) {
    expect(box.x).toBeGreaterThanOrEqual(pane.x);
    expect(box.y).toBeGreaterThanOrEqual(pane.y);
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width);
    expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height);
  }
  await expect(page.getByRole('button', { name: 'Reset layout' })).toBeDisabled();
});

test('a reset right after a drag in the automatic layout fits the layout, not the dragged one', async ({ page }) => {
  // ELK's layout is already known here, so the reset's layout is ready at once.
  await page.goto('/?layout=auto&saveDelay=100');
  await expect(page.locator(NOTES)).toHaveCount(18);
  const auto = await layoutOf(page);
  await drag(page, 'B-8', 0, 400); // far down: the dragged layout is taller
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(1);
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await page.getByRole('dialog', { name: 'Reset layout' }).getByRole('button', { name: 'Reset' }).click();
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(2);
  await page.waitForTimeout(500);
  expect(await layoutOf(page)).toEqual(auto);
});

test('without saved positions, assumptions sit above their host and the sequel below its bet (D19)', async ({ page }) => {
  await page.goto('/?layout=auto');
  await expect(page.locator(NOTES)).toHaveCount(18);
  const box = async (key: string) => (await node(page, key).boundingBox())!;
  const [b1, a1, b2] = [await box('B-1'), await box('A-1'), await box('B-2')];
  expect(a1.y + a1.height).toBeLessThan(b1.y);
  expect(Math.abs(a1.x + a1.width / 2 - (b1.x + b1.width / 2))).toBeLessThan(2);
  expect(b2.x).toBeCloseTo(b1.x, 0);
  expect(b2.y).toBeGreaterThan(b1.y + b1.height);
  const all = await page.locator(NOTES).evaluateAll((els) => els.map((el) => JSON.parse(JSON.stringify(el.getBoundingClientRect()))));
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
});

test('fixed points move up and down only, keeping their column and their assumptions', async ({ page }) => {
  const [before, fp2, a6] = [await offset(page, 'FP-1', 'B-1'), await offset(page, 'FP-2', 'B-1'), await offset(page, 'A-6', 'FP-1')];
  await drag(page, 'FP-1', 150, 80, { release: false });
  expect((await offset(page, 'FP-1', 'B-1')).dx).toBe(before.dx); // during the drag too
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(1);
  const after = await offset(page, 'FP-1', 'B-1');
  expect(after.dx).toBe(before.dx);
  expect(after.dy).toBeGreaterThan(before.dy + 20);
  expect(await offset(page, 'FP-2', 'B-1')).toEqual(fp2);
  expect(await offset(page, 'A-6', 'FP-1')).toEqual(a6); // hosted by FP-1, so it came along
  const saved = await page.evaluate(() => (JSON.parse(window.gsDev.gsmap()) as { positions: Record<string, { x: number; y: number }> }).positions);
  expect(saved['FP-1'].x).toBe(2200);
  expect(saved['FP-1'].y).toBeGreaterThan(200);
});

test('a new note appears, placed where it overlaps nothing, without being saved', async ({ page }) => {
  await page.evaluate(() =>
    window.gsDev.setFile(
      'Strategy/Bets/B-9 Open a studio.md',
      '---\nid: B-9\ntype: bet\nstatus: active\nserves:\n  - "[[FP-2 Own a profitable ceramics studio]]"\n---\n'
    )
  );
  await expect(node(page, 'B-9')).toBeVisible();
  const boxes = await page.locator(NOTES).evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute('data-id'), ...JSON.parse(JSON.stringify(el.getBoundingClientRect())) }))
  );
  const b9 = boxes.find((b) => b.id === 'B-9')!;
  expect(boxes.filter((b) => b.id !== 'B-9' && overlap(b, b9)).map((b) => b.id)).toEqual([]);
  expect(await page.evaluate(() => window.gsDev.writes())).toBe(0);
  const fp2 = (await node(page, 'FP-2').boundingBox())!;
  expect(b9.x).toBeLessThan(fp2.x);
});

test('a failed automatic layout shows the saved nodes and says what it left out', async ({ page }) => {
  await page.goto('/?elk=fail&layout=auto');
  // Nothing is saved, so nothing can be placed: no endless "Laying out…", but the reason.
  await expect(page.locator('.gs-graph-loading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /issues?$/ })).toBeVisible();
  await page.getByRole('button', { name: /issues?$/ }).click();
  await expect(page.locator('.gs-notices-list')).toContainText('The automatic layout failed (simulated ELK failure), so 18 notes');

  await page.goto('/?elk=fail');
  await expect(page.locator(NOTES)).toHaveCount(18);
  await page.evaluate(() =>
    window.gsDev.setFile('Strategy/Bets/B-9 Open a studio.md', '---\nid: B-9\ntype: bet\nstatus: active\n---\n')
  );
  await page.getByRole('button', { name: /issues?$/ }).click();
  await expect(page.locator('.gs-notices-list')).toContainText('so 1 note without a saved position is not shown');
  await expect(node(page, 'B-1')).toBeVisible();
  await expect(node(page, 'B-9')).toBeHidden();
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
  // Each notice about a note opens it, by keyboard too.
  await page.locator('.gs-notices-list').getByRole('button', { name: /changed id/ }).focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.gsDev.opened())).toEqual(['Strategy/Bets/B-1 Get a D7 visa.md']);
});

test('a link left on a deleted note can be removed from its notice', async ({ page }) => {
  await expect(page.locator('.react-flow__edge[data-id="link:e12"]')).toHaveCount(1);
  await page.evaluate(() => window.gsDev.setFile('Strategy/Bets/B-6 Online ceramics course.md', null));
  await expect(node(page, 'B-6')).toHaveCount(0);
  await page.getByRole('button', { name: /issues?$/ }).click();
  const notice = page.locator('.gs-notice').filter({ hasText: '("Killed") ends on "B-6"' });
  await expect(notice).toHaveCount(1);
  await notice.getByRole('button', { name: 'Remove link' }).click();
  await expect(page.locator('.gs-notice').filter({ hasText: 'ends on "B-6"' })).toHaveCount(0);
  await page.evaluate(() => window.gsDev.flush());
  const links = await page.evaluate(() => (JSON.parse(window.gsDev.gsmap()) as { links: { id: string }[] }).links.map((l) => l.id));
  expect(links).not.toContain('e12');
  expect(links).toContain('e16');
});

test('the legacy vault lists its problems and still lays out every node', async ({ page }) => {
  await page.goto('/?vault=legacy');
  await expect(page.locator(NOTES)).toHaveCount(17);
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

test.describe('node and edge styling (Phase 5b)', () => {
  const colorOf = (page: Page, key: string) => node(page, key).locator('.gs-node').evaluate((el) => getComputedStyle(el).borderTopColor);
  const dash = (page: Page, selector: string) =>
    page.locator(`${selector} .react-flow__edge-path`).first().evaluate((el) => getComputedStyle(el).strokeDasharray);

  test('each type has its own shape and each status its own colour', async ({ page }) => {
    const radius = (key: string) => node(page, key).locator('.gs-node').evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(await radius('FP-1')).toBe('999px'); // fixed point: stadium
    expect(await radius('CP')).toBe('999px'); // current position: pill
    expect(await radius('B-1')).toBe('8px'); // bet: box
    // Bets by status: active, won and killed differ; assumptions by what is known of them.
    const bets = [await colorOf(page, 'B-1'), await colorOf(page, 'B-5'), await colorOf(page, 'B-6')]; // active, won, killed
    expect(new Set(bets).size).toBe(3);
    const assumptions = await Promise.all(['A-1', 'A-3', 'A-4'].map((k) => colorOf(page, k))); // confirmed, falsified, undeterminable
    expect(new Set(assumptions).size).toBe(3);
    await expect(node(page, 'A-1').locator('.gs-node')).toHaveCSS('border-top-style', 'dashed');
    await expect(node(page, 'B-6').locator('.gs-node-title')).toHaveCSS('text-decoration-line', 'line-through');
  });

  test('a milestone is a checkpoint, hollow while open and filled once reached', async ({ page }) => {
    const milestone = (status: string) => `---\nid: M-1\ntype: milestone\nstatus: ${status}\n---\n`;
    await page.evaluate((text) => window.gsDev.setFile('Strategy/M-1 Visa in hand.md', text), milestone('open'));
    const m = node(page, 'M-1').locator('.gs-node');
    await expect(m).toBeVisible();
    await expect(m).toHaveCSS('border-left-width', '6px');
    const open = await m.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.evaluate((text) => window.gsDev.setFile('Strategy/M-1 Visa in hand.md', text), milestone('reached'));
    await expect(node(page, 'M-1').locator('select.gs-node-status')).toHaveValue('reached');
    expect(await m.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(open);
  });

  test('edges follow the plan: requires dotted, unverified serve dashed, next labelled', async ({ page }) => {
    expect(await dash(page, '.gs-edge-requires')).toBe('2px, 4px');
    expect(await dash(page, '.gs-edge-unverified')).toBe('9px, 5px');
    expect(await dash(page, '.gs-edge-assumption')).toBe('3px, 3px');
    await expect(page.locator('.gs-edge-serves:not(.gs-edge-unverified) .react-flow__edge-path').first()).toHaveCSS('stroke-dasharray', 'none');
    await expect(page.locator('.gs-edge-next .react-flow__edge-labelwrapper, .gs-edge-next .react-flow__edge-text').first()).toBeVisible();
  });

  test('a note with smells wears a badge listing them; a clean one does not', async ({ page }) => {
    await page.goto('/?today=2026-10-20'); // B-3's deadline (2026-10-15) has passed
    await expect(node(page, 'B-3')).toBeVisible();
    const badge = node(page, 'B-3').locator('.gs-node-smell');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('title', /passed its deadline/);
    await expect(node(page, 'B-5').locator('.gs-node-smell')).toHaveCount(0);
    await page.goto('/?today=2026-09-01');
    await expect(node(page, 'B-3').locator('.gs-node-smell')).not.toHaveAttribute('title', /passed its deadline/); // other smells may remain
  });

  test('ultimately-serves is hidden until toggled, or shown at once for a bet with no serves chain', async ({ page }) => {
    const bet = (id: string, extra: string) => `---\nid: ${id}\ntype: bet\nstatus: active\n${extra}---\n`;
    await page.evaluate((text) => window.gsDev.setFile('Strategy/B-20 Far.md', text), bet('B-20', 'serves: ["[[B-5 Learn Portuguese to B1]]"]\nultimately-serves: ["[[FP-1 Live in Portugal]]"]\n'));
    await expect(node(page, 'B-20')).toBeVisible();
    const ultimate = page.locator('.gs-edge-ultimately-serves'); // React Flow draws no hidden edge at all
    await expect(ultimate).toHaveCount(0);
    await page.getByRole('button', { name: 'Show ultimately-serves links' }).click();
    await expect(ultimate).toHaveCount(1);
    await page.getByRole('button', { name: 'Show ultimately-serves links' }).click();
    await expect(ultimate).toHaveCount(0);
    // B-21 serves nothing, so no serves chain reaches a fixed point: its hint shows without the toggle.
    await page.evaluate((text) => window.gsDev.setFile('Strategy/B-21 Lost.md', text), bet('B-21', 'ultimately-serves: ["[[FP-1 Live in Portugal]]"]\n'));
    await expect(node(page, 'B-21')).toBeVisible();
    await expect(ultimate).toHaveCount(1);
  });

  test('the pointer over a node asks the host for the note preview', async ({ page }) => {
    await node(page, 'B-1').hover();
    await expect.poll(() => page.evaluate(() => window.gsDev.hovered())).toContain('Strategy/Bets/B-1 Get a D7 visa.md');
  });
});

test.describe('editing from the graph (Phase 6)', () => {
  const B1 = 'Strategy/Bets/B-1 Get a D7 visa.md';
  const B2 = 'Strategy/Bets/B-2 Apply for a digital nomad visa.md';
  const B3 = 'Strategy/Bets/B-3 Sell pottery at weekend markets.md';
  const B7 = 'Strategy/Bets/B-7  Part-time barista job.md';
  const file = (page: Page, path: string) => page.evaluate((p) => window.gsDev.file(p), path);
  const pill = (page: Page, key: string) => node(page, key).locator('select.gs-node-status');
  const inspector = (page: Page) => page.getByRole('complementary', { name: /^Inspector/ });
  const toast = (page: Page) => page.getByRole('status');

  test.beforeEach(async ({ page }) => {
    await page.goto('/?today=2026-10-04&saveDelay=200');
    await expect(node(page, 'B-1')).toBeVisible();
  });

  test('the status pill is a dropdown that changes the note, and refuses nothing it offers', async ({ page }) => {
    await pill(page, 'B-3').selectOption('dormant');
    await expect.poll(() => file(page, B3)).toContain('status: dormant');
    await expect(pill(page, 'B-3')).toHaveValue('dormant');
    await expect(toast(page)).toHaveText('B-3 is now dormant.');
    // Only the status line changed.
    expect((await file(page, B3))!.replace('status: dormant', 'status: active')).toContain('## The Bet');
    expect(await pill(page, 'B-3').locator('option').allTextContents()).toEqual(['active', 'dormant', 'won', 'killed', 'extended']);
  });

  test('the date is edited in place: Enter saves, Escape cancels', async ({ page }) => {
    const date = node(page, 'B-3').locator('.gs-node-date');
    await date.click();
    await node(page, 'B-3').locator('input[type=date]').fill('2027-02-03');
    await page.keyboard.press('Enter');
    await expect.poll(() => file(page, B3)).toContain('deadline: 2027-02-03');
    await expect(node(page, 'B-3').locator('.gs-node-date')).toHaveText('2027-02-03');
    await node(page, 'B-3').locator('.gs-node-date').click();
    await node(page, 'B-3').locator('input[type=date]').fill('2030-01-01');
    await page.keyboard.press('Escape');
    await expect(node(page, 'B-3').locator('input[type=date]')).toHaveCount(0);
    expect(await file(page, B3)).toContain('deadline: 2027-02-03');
  });

  test('selecting a note opens its inspector, with the rendered text and a way to open it in a split', async ({ page }) => {
    await node(page, 'B-3').click();
    const panel = inspector(page);
    await expect(panel).toContainText('B-3');
    await expect(panel).toContainText('Sell pottery at weekend markets');
    await expect(panel.locator('.gs-inspector-text')).toContainText('## The Bet');
    await expect(panel.locator('.gs-inspector-text')).not.toContainText('type: bet'); // the frontmatter is shown as fields
    await panel.getByRole('button', { name: 'Open in split' }).click();
    expect(await page.evaluate(() => window.gsDev.opened())).toEqual([B3]);
    await panel.getByRole('button', { name: 'Close inspector' }).click();
    await expect(panel).toHaveCount(0);
    await node(page, 'B-1').click();
    await expect(inspector(page)).toContainText('B-1');
  });

  test('the inspector adds and removes relations, and edits the expected result and the falsifier', async ({ page }) => {
    await node(page, 'B-7').click();
    const panel = inspector(page);
    await panel.getByLabel('Add Serves').selectOption({ label: 'FP-1 Live in Portugal' });
    await expect.poll(() => file(page, B7)).toContain('[[FP-1 Live in Portugal]]');
    await expect(page.locator('.react-flow__edge[data-id="serves:B-7>FP-1"]')).toHaveCount(1);
    await expect(panel.locator('[data-field=serves] li', { hasText: 'FP-1' })).toHaveCount(1);
    await panel.getByRole('button', { name: 'Remove Serves FP-1' }).click();
    await expect.poll(() => file(page, B7)).not.toContain('FP-1 Live in Portugal');
    await expect(page.locator('.react-flow__edge[data-id="serves:B-7>FP-1"]')).toHaveCount(0);

    await panel.getByLabel('Expected result').fill('A steady 20 hours a week');
    await panel.getByLabel('Expected result').blur();
    await expect.poll(() => file(page, B7)).toContain('expected-result: A steady 20 hours a week');

    await node(page, 'A-3').click();
    const falsifier = inspector(page).getByLabel("How I'd know it's false");
    await falsifier.fill('A stall costs over 80 a day');
    await falsifier.blur();
    await expect
      .poll(() => file(page, 'Strategy/Assumptions/A-3 Weekend market stalls are available.md'))
      .toContain("## How I'd Know It's False\nA stall costs over 80 a day\n");
  });

  test('a log entry goes under ## Log, dated, and shows in the note', async ({ page }) => {
    await node(page, 'B-1').click();
    const panel = inspector(page);
    await panel.getByLabel('Log entry').fill('visa appointment booked');
    await panel.getByLabel('Log entry').press('Enter');
    await expect.poll(() => file(page, B1)).toContain('- 2026-07-05: created\n- 2026-10-04: visa appointment booked\n');
    await expect(panel.locator('.gs-inspector-text')).toContainText('2026-10-04: visa appointment booked');
    await expect(panel.getByLabel('Log entry')).toHaveValue('');
  });

  const handleOf = (page: Page, key: string, side: string) => node(page, key).locator(`.react-flow__handle-${side}.source`);

  async function connect(page: Page, from: string, to: string, side = 'right') {
    await node(page, from).hover();
    const handle = (await handleOf(page, from, side).boundingBox())!;
    const target = (await node(page, to).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
    await page.mouse.up();
  }

  test('dragging from a handle onto a note draws the relation its types imply, and asks when that is ambiguous', async ({ page }) => {
    // An assumption onto the bet that leans on it: one possible relation, made at once.
    await connect(page, 'A-7', 'B-7');
    await expect.poll(() => file(page, B7)).toContain('[[A-7 Workshops can fill eight seats]]');
    await expect(page.locator('.react-flow__edge[data-id="assumption:B-7>A-7"]')).toHaveCount(1);
    // Bet onto bet: serves, requires or next. The menu asks, and the choice is written.
    await connect(page, 'B-7', 'B-8');
    const menu = page.getByRole('menu', { name: 'Which relation?' });
    await expect(menu.getByRole('menuitem')).toHaveText(['B-7 serves B-8', 'B-8 requires B-7', 'B-7 has next sequel B-8']);
    await menu.getByRole('menuitem', { name: 'B-8 requires B-7' }).click();
    await expect.poll(() => file(page, 'Strategy/Bets/B-8 Teach pottery workshops.md')).toContain('[[B-7  Part-time barista job]]');
    await expect(page.locator('.react-flow__edge[data-id="requires:B-8>B-7"]')).toHaveCount(1);
  });

  test('a link that already exists, or two notes with no relation between them, is refused with the reason', async ({ page }) => {
    await connect(page, 'A-1', 'B-1');
    await expect(toast(page)).toContainText('B-1 depends on A-1 already');
    await connect(page, 'FP-1', 'FP-2');
    await expect(toast(page)).toContainText("can't be linked");
  });

  test('a selected link is removed with Delete', async ({ page }) => {
    const edge = page.locator('.react-flow__edge[data-id="requires:B-4>B-5"]');
    await expect(edge).toHaveCount(1);
    // Click the middle of the curve, where the link can be hit.
    const point = await edge.locator('.react-flow__edge-interaction').evaluate((path: SVGPathElement) => {
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const m = path.getScreenCTM()!;
      return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
    });
    await page.mouse.click(point.x, point.y);
    await expect(edge).toHaveClass(/selected/);
    await page.keyboard.press('Delete');
    await expect.poll(() => file(page, 'Strategy/Bets/B-4 Save 20000 for kiln and lease.md')).not.toContain('[[B-5 Learn Portuguese to B1]]');
    await expect(page.locator('.react-flow__edge[data-id="requires:B-4>B-5"]')).toHaveCount(0);
    expect(await file(page, 'Strategy/Bets/B-4 Save 20000 for kiln and lease.md')).toContain('[[B-3 Sell pottery at weekend markets]]');
  });

  test('Kill → activate next kills the bet, activates the sequel, and logs in both notes', async ({ page }) => {
    await node(page, 'B-1').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Kill → activate next' }).click();
    await expect.poll(() => file(page, B1)).toContain('status: killed');
    expect(await file(page, B2)).toContain('status: active');
    expect(await file(page, B1)).toContain('- 2026-10-04: Killed. Activating [[B-2 Apply for a digital nomad visa]].');
    expect(await file(page, B2)).toContain('- 2026-10-04: Activated: [[B-1 Get a D7 visa]] was killed.');
    await expect(pill(page, 'B-1')).toHaveValue('killed');
    await expect(pill(page, 'B-2')).toHaveValue('active');
  });

  test('the menu says why an item is off: no sequel to activate, a sequel already there', async ({ page }) => {
    await node(page, 'B-3').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Kill → activate next' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await node(page, 'B-1').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'New sequel bet' })).toBeDisabled();
  });

  test('Mark falsified flags the active bets that lean on the assumption', async ({ page }) => {
    await node(page, 'A-1').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark falsified' }).click();
    await expect.poll(() => file(page, 'Strategy/Assumptions/A-1 D7 accepts freelance income.md')).toContain('status: falsified');
    await expect(toast(page)).toContainText('B-1 is active and depends on it: flagged');
    await expect(node(page, 'B-1').locator('.gs-node-smell')).toHaveAttribute('title', /falsified assumptions/);
  });

  test('New sequel bet creates the note, links it as next, and it appears on the graph', async ({ page }) => {
    await node(page, 'B-3').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New sequel bet' }).click();
    const form = page.getByRole('form', { name: 'New sequel bet' });
    await form.getByLabel('Title', { exact: true }).fill('Rent a permanent stall');
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(node(page, 'B-9')).toBeVisible();
    await expect(node(page, 'B-9')).toContainText('Rent a permanent stall');
    expect(await file(page, B3)).toContain('next: "[[B-9 Rent a permanent stall]]"');
    await expect(page.locator('.react-flow__edge[data-id="next:B-3>B-9"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.gsDev.opened())).toEqual([]); // the graph stays where it is
  });

  test('New bet serving this and Add assumption use the note they were asked on', async ({ page }) => {
    await node(page, 'FP-2').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New bet serving this' }).click();
    await page.getByRole('form', { name: 'New bet serving this' }).getByLabel('Title', { exact: true }).fill('Sell at a craft fair');
    await page.getByRole('form').getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('.react-flow__edge[data-id="serves:B-9>FP-2"]')).toHaveCount(1);
    await node(page, 'B-9').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add assumption' }).click();
    await page.getByRole('form', { name: 'Add assumption' }).getByLabel('The assumption').fill('Craft fairs allow ceramics');
    await page.getByRole('form').getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('.react-flow__edge[data-id="assumption:B-9>A-8"]')).toHaveCount(1);
  });

  test('a refused creation stays open and says why', async ({ page }) => {
    await node(page, 'B-3').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New bet serving this' }).click();
    const form = page.getByRole('form', { name: 'New bet serving this' });
    await form.getByLabel('Title', { exact: true }).fill('???');
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(form.getByRole('alert')).toContainText('title is empty');
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(form).toHaveCount(0);
  });

  test('read-only: no dropdowns, no date fields, no inspector controls, no handles to draw from', async ({ page }) => {
    await page.goto('/?readonly=1');
    await expect(node(page, 'B-1')).toBeVisible();
    await expect(page.locator('select.gs-node-status')).toHaveCount(0);
    await expect(page.locator('button.gs-node-date--button')).toHaveCount(0);
    await node(page, 'B-3').click();
    await expect(inspector(page).getByRole('combobox').first()).toBeDisabled();
    await expect(inspector(page).getByLabel('Log entry')).toHaveCount(0);
    await node(page, 'B-3').click({ button: 'right' });
    await expect(page.getByRole('menuitem')).toHaveText(['Open note', 'Open in split']); // nothing that writes
  });
});

test.describe('free cards, frames and links (Phase 7)', () => {
  const card = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="card:${id}"]`);
  const frame = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="frame:${id}"]`);
  const map = async (page: Page) => JSON.parse(await page.evaluate(() => window.gsDev.gsmap())) as {
    positions: Record<string, { x: number; y: number }>;
    cards: { id: string; kind: string; text?: string; x: number; y: number; width: number; height: number; color?: string; style?: Record<string, string> }[];
    frames: { id: string; label: string; x: number; y: number; width: number; height: number; color?: string }[];
    links: { id: string; from: Record<string, string>; to: Record<string, string>; label?: string; color?: string; style?: Record<string, string>; fromEnd?: string; toEnd?: string }[];
  };
  const saved = (page: Page, writes: number) => expect.poll(() => page.evaluate(() => window.gsDev.writes())).toBe(writes);
  /** Write what is pending now (the quiet period is 200 ms here): what is on disk is then what the user did. */
  const settle = (page: Page) => page.evaluate(() => window.gsDev.flush());

  test.beforeEach(async ({ page }) => {
    await page.goto('/?today=2026-10-04&saveDelay=200');
    await expect(node(page, 'B-1')).toBeVisible();
  });

  test('the canvas cards keep their text, note references show the note, and the diamond and dashed styles carry over', async ({ page }) => {
    await expect(card(page, 't-route')).toContainText('Visa Route');
    await expect(card(page, 'note')).toContainText('lisbon-neighbourhoods-research');
    await expect(card(page, 't-routec').locator('.gs-card')).toHaveClass(/gs-card--dashed/);
    await expect(page.locator('.react-flow__node-junction[data-id="and:B-4"]')).toContainText('AND');
    await expect(frame(page, 'g-visa')).toContainText('Visa route');
    // A labelled link between a card and a note.
    await expect(page.locator('.react-flow__edge[data-id="link:e10"]')).toContainText('Only A-6');
  });

  test('a double-click on empty space makes a card; typing and clicking away saves it; an empty one disappears', async ({ page }) => {
    const before = (await map(page)).cards.length;
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.dblclick(pane.x + 120, pane.y + 700);
    const editor = page.getByRole('textbox', { name: 'Card text' });
    await expect(editor).toBeFocused();
    await editor.fill('Check the Etsy fees');
    await page.mouse.click(pane.x + 600, pane.y + 20); // away from the card
    await settle(page);
    const cards = (await map(page)).cards;
    expect(cards).toHaveLength(before + 1);
    expect(cards[cards.length - 1]).toMatchObject({ kind: 'text', text: 'Check the Etsy fees', width: 250, height: 60 });
    await expect(page.locator('.react-flow__node-card', { hasText: 'Check the Etsy fees' })).toBeVisible();

    // A card left empty is no card.
    await page.mouse.dblclick(pane.x + 120, pane.y + 780);
    await page.getByRole('textbox', { name: 'Card text' }).press('Escape');
    await expect(page.getByRole('textbox', { name: 'Card text' })).toHaveCount(0);
    await settle(page);
    expect((await map(page)).cards).toHaveLength(before + 1);
  });

  test('a card is edited with a double-click, Ctrl+Enter saves, and Escape leaves the text as it was', async ({ page }) => {
    await card(page, 't-elab').dblclick();
    const editor = page.getByRole('textbox', { name: 'Card text' });
    await editor.fill('Needs elaboration — the studio lease');
    await editor.press('Control+Enter');
    await saved(page, 1);
    expect((await map(page)).cards.find((c) => c.id === 't-elab')!.text).toBe('Needs elaboration — the studio lease');
    await card(page, 't-elab').dblclick();
    await page.getByRole('textbox', { name: 'Card text' }).fill('discarded');
    await page.getByRole('textbox', { name: 'Card text' }).press('Escape');
    await expect(card(page, 't-elab')).toContainText('the studio lease');
    expect(await page.evaluate(() => window.gsDev.writes())).toBe(1);
  });

  test('dragging a card saves its place in the .gsmap, once, and nothing else moves; a frame carries what lies in it', async ({ page }) => {
    const before = await map(page);
    await drag(page, 't-route'.replace(/^/, 'card:'), 90, 60);
    await saved(page, 1);
    const after = await map(page);
    const [a, b] = [before.cards.find((c) => c.id === 't-route')!, after.cards.find((c) => c.id === 't-route')!];
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
    expect(after.positions).toEqual(before.positions);
    expect(after.cards.filter((c) => c.id !== 't-route')).toEqual(before.cards.filter((c) => c.id !== 't-route'));
    // A frame is grabbed by its label.
    const label = (await frame(page, 'g-studio').locator('.gs-frame-label').boundingBox())!;
    await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
    await page.mouse.down();
    await page.mouse.move(label.x + 60, label.y + 40, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const done = await map(page);
    const moved = done.frames.find((f) => f.id === 'g-studio')!;
    const original = before.frames.find((f) => f.id === 'g-studio')!;
    const [dx, dy] = [moved.x - original.x, moved.y - original.y];
    expect(dx).toBeGreaterThan(0);
    expect(moved.width).toBe(original.width);
    // As on a canvas: everything wholly inside the frame went with it, by the same amount; nothing else moved.
    for (const key of ['B-3', 'B-4', 'B-5', 'B-6', 'B-7', 'B-8', 'A-3', 'A-4', 'A-5', 'A-7']) {
      expect(done.positions[key], key).toEqual({ x: before.positions[key].x + dx, y: before.positions[key].y + dy });
    }
    for (const key of ['B-1', 'B-2', 'A-1', 'A-2', 'FP-1', 'FP-2', 'CP']) expect(done.positions[key], key).toEqual(before.positions[key]);
    const elab = [before, done].map((m) => m.cards.find((c) => c.id === 't-elab')!);
    expect(elab[1]).toMatchObject({ x: elab[0].x + dx, y: elab[0].y + dy });
    expect(done.frames.find((f) => f.id === 'g-visa')).toEqual(before.frames.find((f) => f.id === 'g-visa'));
  });

  test('a selected frame or card is resized by its handles, and the size is saved', async ({ page }) => {
    await frame(page, 'g-visa').locator('.gs-frame-label').click();
    await expect(frame(page, 'g-visa')).toHaveClass(/selected/);
    const handle = frame(page, 'g-visa').locator('.react-flow__resize-control.handle.bottom.right');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 60, box.y - 40, { steps: 6 });
    await page.mouse.up();
    await saved(page, 1);
    const [a, b] = [(await map(page)).frames.find((f) => f.id === 'g-visa')!, { width: 1800, height: 900 }];
    expect(a.width).toBeLessThan(b.width);
    expect(a.height).toBeLessThan(b.height);
  });

  test('a frame is made from the empty-space menu, named in place, and deleted from its own menu', async ({ page }) => {
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.click(pane.x + 80, pane.y + 780, { button: 'right' });
    await page.getByRole('menuitem', { name: 'New frame here' }).click();
    const label = page.getByRole('textbox', { name: 'Frame label' });
    await label.fill('Ideas');
    await label.press('Enter');
    await settle(page);
    expect((await map(page)).frames.map((f) => f.label)).toContain('Ideas');
    const made = page.locator('.react-flow__node-frame', { hasText: 'Ideas' });
    await made.locator('.gs-frame-label').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete frame' }).click();
    await settle(page);
    expect((await map(page)).frames.map((f) => f.label)).not.toContain('Ideas');
  });

  test('dragging from a card onto a note makes a free link, and from a note onto a card too', async ({ page }) => {
    const before = (await map(page)).links.length;
    const from = card(page, 't-elab');
    await from.hover();
    const handle = (await from.locator('.react-flow__handle-top.source').boundingBox())!;
    const target = (await node(page, 'B-8').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
    await page.mouse.up();
    await saved(page, 1);
    const links = (await map(page)).links;
    expect(links).toHaveLength(before + 1);
    expect(links[links.length - 1]).toMatchObject({ from: { card: 't-elab' }, to: { note: 'B-8' }, fromSide: 'top' });
    // The other way: a note's handle onto a card.
    await node(page, 'B-7').hover();
    const noteHandle = (await node(page, 'B-7').locator('.react-flow__handle-right.source').boundingBox())!;
    const cardBox = (await card(page, 't-elab').boundingBox())!;
    await page.mouse.move(noteHandle.x + noteHandle.width / 2, noteHandle.y + noteHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2, { steps: 8 });
    await page.mouse.up();
    await saved(page, 2);
    expect((await map(page)).links.slice(-1)[0]).toMatchObject({ from: { note: 'B-7' }, to: { card: 't-elab' } });
  });

  test('a free link is styled freely: label, colour, line, arrows; and deleted from its menu', async ({ page }) => {
    const edge = page.locator('.react-flow__edge[data-id="link:e17"]');
    await edge.locator('.react-flow__edge-interaction').click({ button: 'right', force: true });
    await page.getByRole('menuitem', { name: 'Edit link…' }).click();
    const editor = page.getByRole('dialog', { name: 'Link style' });
    await editor.getByLabel('Label').fill('maybe');
    await editor.getByLabel('Label').blur();
    await editor.getByRole('radio', { name: 'green' }).click();
    await editor.getByRole('radio', { name: 'Dotted line' }).click();
    await editor.getByRole('radio', { name: 'Arrows at both ends' }).click();
    await expect(editor.getByRole('radio', { name: 'Arrows at both ends' })).toHaveAttribute('aria-checked', 'true');
    await settle(page);
    const link = (await map(page)).links.find((l) => l.id === 'e17')!;
    expect(link).toMatchObject({ label: 'maybe', color: '4', fromEnd: 'arrow', style: { path: 'dotted' } });
    expect(link.toEnd).toBeUndefined();
    await expect(edge).toHaveClass(/gs-link--dotted/);
    await expect(edge).toContainText('maybe');
    await editor.getByRole('button', { name: 'Done' }).click();
    await edge.locator('.react-flow__edge-interaction').click({ button: 'right', force: true });
    await page.getByRole('menuitem', { name: 'Delete link' }).click();
    await settle(page);
    expect((await map(page)).links.map((l) => l.id)).not.toContain('e17');
  });

  test('a card has a colour, a border and a shape of its own, chosen live', async ({ page }) => {
    await card(page, 't-elab').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Style…' }).click();
    const editor = page.getByRole('dialog', { name: 'Card style' });
    await editor.getByRole('radio', { name: 'purple' }).click();
    // Icons, as on a canvas: one group for the border, one for the shape.
    await editor.getByRole('radiogroup', { name: 'Border' }).getByRole('radio', { name: 'Dashed border' }).click();
    await editor.getByRole('radiogroup', { name: 'Shape' }).getByRole('radio', { name: 'Diamond' }).click();
    await expect(editor.getByRole('radio', { name: 'Diamond' })).toHaveAttribute('aria-checked', 'true');
    await settle(page);
    expect((await map(page)).cards.find((c) => c.id === 't-elab')).toMatchObject({ color: '6', style: { border: 'dashed', shape: 'diamond' } });
    await expect(card(page, 't-elab').locator('.gs-card')).toHaveClass(/gs-card--diamond/);
    // Putting it back leaves no trace of the options in the file.
    await editor.getByRole('radio', { name: 'none' }).click();
    await editor.getByRole('radio', { name: 'Solid border' }).click();
    await editor.getByRole('radio', { name: 'Box' }).click();
    await settle(page);
    const back = (await map(page)).cards.find((c) => c.id === 't-elab')!;
    expect(back.color).toBeUndefined();
    expect(back.style).toBeUndefined();
  });

  test('Delete removes a selected card and the links on it, in one write; notes cannot be deleted', async ({ page }) => {
    await card(page, 't-ghost').click();
    await node(page, 'B-3').click({ modifiers: ['Shift'] });
    await page.keyboard.press('Delete');
    await settle(page);
    const after = await map(page);
    expect(after.cards.map((c) => c.id)).not.toContain('t-ghost');
    expect(after.links.map((l) => l.id)).not.toContain('e10');
    expect(after.links.some((l) => JSON.stringify(l).includes('t-ghost'))).toBe(false);
    await expect(node(page, 'B-3')).toBeVisible(); // the note stays
  });

  test('Cmd/Ctrl+A then Delete asks before erasing more than a few cards and links, and never selects frames', async ({ page }) => {
    await page.locator('.react-flow__pane').click({ position: { x: 700, y: 20 } });
    await page.keyboard.press('Control+a');
    await expect(page.locator('.react-flow__node-frame.selected')).toHaveCount(0);
    await expect(page.locator('.react-flow__node-card.selected')).toHaveCount(5);
    await page.keyboard.press('Delete');
    const dialog = page.getByRole('dialog', { name: 'Delete' });
    await expect(dialog).toContainText('Delete 5 selected cards, frames and links');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await settle(page);
    expect((await map(page)).cards).toHaveLength(5);
    expect(await page.evaluate(() => window.gsDev.writes())).toBe(0);
    await page.keyboard.press('Delete');
    await page.getByRole('dialog', { name: 'Delete' }).getByRole('button', { name: 'Delete' }).click();
    await settle(page);
    const after = await map(page);
    expect(after.cards).toEqual([]);
    expect(after.frames).toHaveLength(2); // the frames were never selected
    expect(Object.keys(after.positions)).toHaveLength(18); // nor were the notes deletable
    await expect(node(page, 'B-1')).toBeVisible();
  });

  test('promoting a card to a bet creates the note, moves the card\'s place and links to it, and removes the card', async ({ page }) => {
    const before = await map(page);
    const at = before.cards.find((c) => c.id === 't-ghost')!;
    await card(page, 't-ghost').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Promote to bet…' }).click();
    const form = page.getByRole('form', { name: 'Promote to bet' });
    await expect(form.getByLabel('Title', { exact: true })).toHaveValue('Golden visa path?');
    await form.getByLabel('Title', { exact: true }).fill('Golden visa path');
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(node(page, 'B-9')).toBeVisible();
    await settle(page);
    const after = await map(page);
    expect(after.cards.map((c) => c.id)).not.toContain('t-ghost');
    expect(after.positions['B-9']).toEqual({ x: at.x, y: at.y }); // the card's place is the note's
    // Its link now ends on the note.
    expect(after.links.find((l) => l.id === 'e10')).toMatchObject({ from: { note: 'B-9' }, to: { note: 'B-2' } });
    expect(await page.evaluate(() => window.gsDev.file('Strategy/Bets/B-9 Golden visa path.md'))).toContain('type: bet');
    await expect(node(page, 'B-9')).toContainText('Golden visa path');
  });

  test('a card can also become an assumption or a milestone; a refused promotion keeps the card', async ({ page }) => {
    await card(page, 't-elab').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Promote to milestone…' }).click();
    const form = page.getByRole('form', { name: 'Promote to milestone' });
    await form.getByLabel('Title', { exact: true }).fill('???'); // nothing left of it as a filename
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(form.getByRole('alert')).toContainText('title is empty');
    await form.getByLabel('Title', { exact: true }).fill('Lease signed');
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(node(page, 'M-1')).toBeVisible();
    await expect(node(page, 'M-1')).toContainText('Lease signed');
    await settle(page);
    expect((await map(page)).cards.map((c) => c.id)).not.toContain('t-elab');

    await card(page, 't-route').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Promote to assumption…' }).click();
    await expect(page.getByRole('form', { name: 'Promote to assumption' }).getByLabel('The assumption')).toHaveValue('Visa Route');
  });

  test('a vault note dropped on the graph, or picked from the empty-space menu, becomes a note card; a strategy note is shown instead', async ({ page }) => {
    const pane = page.locator('.react-flow__pane');
    const box = (await pane.boundingBox())!;
    const drop = async (path: string, x: number, y: number) => {
      const dataTransfer = await page.evaluateHandle((p) => {
        const data = new DataTransfer();
        data.setData('text/plain', p);
        return data;
      }, path);
      await pane.dispatchEvent('dragover', { dataTransfer, clientX: x, clientY: y });
      await pane.dispatchEvent('drop', { dataTransfer, clientX: x, clientY: y });
    };
    const before = (await map(page)).cards.length;
    await drop('Strategy/Strategic Inbox.md', box.x + 120, box.y + 700);
    await settle(page);
    let cards = (await map(page)).cards;
    expect(cards).toHaveLength(before + 1);
    expect(cards[cards.length - 1]).toMatchObject({ kind: 'note-ref', file: 'Strategy/Strategic Inbox.md', width: 250, height: 60 });
    await expect(page.locator('.react-flow__node-card', { hasText: 'Strategic Inbox' })).toBeVisible();

    // A strategy note is a node already: no card, the view goes to it.
    await drop('Strategy/Bets/B-3 Sell pottery at weekend markets.md', box.x + 600, box.y + 700);
    await expect(page.getByRole('status')).toContainText('B-3 is on the graph already.');
    await settle(page);
    expect((await map(page)).cards).toHaveLength(before + 1);

    // The menu asks the host for a note (the dev page's picker is a prompt).
    page.once('dialog', (dialog) => dialog.accept('Templates/Bet Template.md'));
    await page.mouse.click(box.x + 300, box.y + 40, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Add note card…' }).click();
    await settle(page);
    cards = (await map(page)).cards;
    expect(cards).toHaveLength(before + 2);
    expect(cards[cards.length - 1]).toMatchObject({ kind: 'note-ref', file: 'Templates/Bet Template.md' });
  });

  test('a card\'s handles are drawn whole, outside its box, as on a note', async ({ page }) => {
    const c = card(page, 't-route');
    await c.hover();
    const box = (await c.locator('.gs-card-box').boundingBox())!;
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const handle = c.locator(`.react-flow__handle-${side}.source`);
      await expect(handle).toHaveCount(1);
      const h = (await handle.boundingBox())!;
      // The half of the handle outside the box is there to be hit, not clipped away.
      const outside = {
        top: { x: h.x + h.width / 2, y: h.y + 1 },
        right: { x: h.x + h.width - 1, y: h.y + h.height / 2 },
        bottom: { x: h.x + h.width / 2, y: h.y + h.height - 1 },
        left: { x: h.x + 1, y: h.y + h.height / 2 },
      }[side]!;
      expect(overlap({ ...outside, width: 0.1, height: 0.1 }, box), side).toBe(false);
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.react-flow__handle')?.className ?? '', outside);
      expect(hit, side).toContain(`react-flow__handle-${side}`);
    }
  });

  test('a note card follows its note when the note is renamed or moved', async ({ page }) => {
    await expect(card(page, 'note')).toContainText('lisbon-neighbourhoods-research');
    await page.evaluate(() => window.gsDev.rename('lisbon-neighbourhoods-research.md', 'Research/Lisbon neighbourhoods.md'));
    await expect(card(page, 'note')).toContainText('Lisbon neighbourhoods');
    await expect(card(page, 'note')).not.toContainText('lisbon-neighbourhoods-research');
    await settle(page);
    expect((await map(page)).cards.find((c) => c.id === 'note')).toMatchObject({ kind: 'note-ref', file: 'Research/Lisbon neighbourhoods.md' });
  });

  test('a selection box selects a frame it holds whole, as on a canvas, but not one it only touches', async ({ page }) => {
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.click(pane.x + 80, pane.y + 420, { button: 'right' });
    await page.getByRole('menuitem', { name: 'New frame here' }).click();
    await page.getByRole('textbox', { name: 'Frame label' }).fill('Ideas');
    await page.getByRole('textbox', { name: 'Frame label' }).press('Enter');
    const made = page.locator('.react-flow__node-frame', { hasText: 'Ideas' });
    await page.keyboard.press('Escape');
    await expect(made).not.toHaveClass(/selected/);
    const f = (await made.boundingBox())!;
    const onPane = (x: number, y: number) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.classList.contains('react-flow__pane'), [x, y]);
    const sweep = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      expect(await onPane(from.x, from.y)).toBe(true);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 10 });
      await page.mouse.up();
    };

    // A box drawn inside the frame, or over part of it, leaves it be.
    await sweep({ x: f.x + 40, y: f.y + 60 }, { x: f.x + f.width + 30, y: f.y + f.height - 40 });
    await expect(made).not.toHaveClass(/selected/);
    // A box that holds all of it selects it, while the box is still being drawn too.
    const start = { x: f.x - 10, y: f.y - 10 };
    expect(await onPane(start.x, start.y)).toBe(true);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2, { steps: 6 });
    await expect(made).not.toHaveClass(/selected/);
    await page.mouse.move(f.x + f.width + 10, f.y + f.height + 10, { steps: 6 });
    await expect(made).toHaveClass(/selected/);
    await page.mouse.up();
    await expect(made).toHaveClass(/selected/);
    // Selected that way, it is dragged with the rest of the selection, and saved.
    await settle(page);
    const before = (await map(page)).frames.find((x) => x.label === 'Ideas')!;
    const label = (await made.locator('.gs-frame-label').boundingBox())!;
    await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
    await page.mouse.down();
    await page.mouse.move(label.x + label.width / 2 + 50, label.y + label.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const after = (await map(page)).frames.find((x) => x.label === 'Ideas')!;
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.width).toBe(before.width);
  });

  test('a frame is made around a selection of several nodes from its menu, and carries them', async ({ page }) => {
    await node(page, 'B-7').click();
    await node(page, 'B-8').click({ modifiers: ['Shift'] });
    await card(page, 't-elab').click({ modifiers: ['Shift'] });
    // A node outside the selection keeps its own menu.
    await node(page, 'B-1').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Create frame around selection' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await node(page, 'B-8').click({ button: 'right' });
    await expect(page.getByRole('menu', { name: '3 selected' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Create frame around selection' }).click();
    const label = page.getByRole('textbox', { name: 'Frame label' });
    await label.fill('Jobs');
    await label.press('Enter');
    await settle(page);
    const made = (await map(page)).frames.find((f) => f.label === 'Jobs')!;
    expect(made).toBeDefined();
    // It holds them all, on screen too.
    const frameBox = (await page.locator('.react-flow__node-frame', { hasText: 'Jobs' }).boundingBox())!;
    for (const held of [node(page, 'B-7'), node(page, 'B-8'), card(page, 't-elab')]) {
      const r = (await held.boundingBox())!;
      expect(r.x).toBeGreaterThan(frameBox.x);
      expect(r.y).toBeGreaterThan(frameBox.y);
      expect(r.x + r.width).toBeLessThan(frameBox.x + frameBox.width);
      expect(r.y + r.height).toBeLessThan(frameBox.y + frameBox.height);
    }
    // Dragging it by its label carries what it was made around.
    await page.keyboard.press('Escape');
    const before = await map(page);
    const grip = (await page.locator('.react-flow__node-frame', { hasText: 'Jobs' }).locator('.gs-frame-label').boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + grip.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const after = await map(page);
    const moved = after.frames.find((f) => f.label === 'Jobs')!;
    const [dx, dy] = [moved.x - made.x, moved.y - made.y];
    expect(dx).toBeGreaterThan(0);
    for (const key of ['B-7', 'B-8']) expect(after.positions[key], key).toEqual({ x: before.positions[key].x + dx, y: before.positions[key].y + dy });
    const elab = after.cards.find((c) => c.id === 't-elab')!;
    expect(elab).toMatchObject({ x: before.cards.find((c) => c.id === 't-elab')!.x + dx });
  });

  test('a selection drawn with a box has the same menu', async ({ page }) => {
    const [a, b] = [(await card(page, 't-route').boundingBox())!, (await card(page, 't-routec').boundingBox())!];
    const box = { x1: Math.min(a.x, b.x) - 8, y1: Math.min(a.y, b.y) - 8, x2: Math.max(a.x + a.width, b.x + b.width) + 8, y2: Math.max(a.y + a.height, b.y + b.height) + 8 };
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.classList.contains('react-flow__pane'), [box.x1, box.y1])).toBe(true);
    await page.mouse.move(box.x1, box.y1);
    await page.mouse.down();
    await page.mouse.move(box.x2, box.y2, { steps: 8 });
    await page.mouse.up();
    await expect(card(page, 't-route')).toHaveClass(/selected/);
    await expect(card(page, 't-routec')).toHaveClass(/selected/);
    await card(page, 't-route').click({ button: 'right', force: true });
    await page.getByRole('menuitem', { name: 'Create frame around selection' }).click();
    await page.getByRole('textbox', { name: 'Frame label' }).press('Enter');
    await settle(page);
    expect((await map(page)).frames).toHaveLength(3);
  });

  test('a note-reference card opens its note', async ({ page }) => {
    await card(page, 'note').dblclick();
    expect(await page.evaluate(() => window.gsDev.opened())).toEqual(['lisbon-neighbourhoods-research.md']);
    await card(page, 'note').click({ button: 'right' });
    await expect(page.getByRole('menuitem').allTextContents()).resolves.toEqual(['Style…', 'Open note', 'Delete card']);
  });

  test('a .gsmap that cannot be read shows no cards and offers no card editing, and writes nothing', async ({ page }) => {
    await page.goto('/?gsmap=broken');
    await expect(node(page, 'B-1')).toBeVisible();
    await expect(page.locator('.react-flow__node-card')).toHaveCount(0);
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.dblclick(pane.x + 120, pane.y + 700);
    await page.mouse.click(pane.x + 120, pane.y + 700, { button: 'right' });
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Card text' })).toHaveCount(0);
    await settle(page);
    expect(await page.evaluate(() => window.gsDev.writes())).toBe(0);
  });
});

test.describe('smells panel and review walk (Phase 8)', () => {
  const panel = (page: Page) => page.getByRole('region', { name: 'Smells' });
  const walk = (page: Page) => page.getByRole('dialog', { name: 'Review walk' });
  /** How far a node's centre is from the centre of the graph's box. */
  async function offCentre(page: Page, key: string) {
    const [n, pane] = [(await node(page, key).boundingBox())!, (await page.locator('.react-flow').boundingBox())!];
    return Math.hypot(n.x + n.width / 2 - (pane.x + pane.width / 2), n.y + n.height / 2 - (pane.y + pane.height / 2));
  }

  test('lists what review would flag, in groups, worst first, and a click centres the note and selects it', async ({ page }) => {
    await page.goto('/?today=2026-10-20'); // B-3 (deadline 2026-10-15) is overdue
    await expect(node(page, 'B-1')).toBeVisible();
    const toggle = page.getByRole('button', { name: /^\d+ smells?$/ });
    await toggle.click();
    const titles = await panel(page).locator('h4').allTextContents();
    expect(titles.map((t) => t.replace(/\s*\d+$/, ''))).toEqual([
      'Active on assumptions with no verify-by',
      'Active on falsified assumptions',
      'Past its deadline while active',
      'No serves chain to a fixed point',
      'Dormant, and no bet\'s next',
    ]);
    // The count on the button is the sum of the badges on the notes.
    const badges = await page.locator('.gs-node-smell').allTextContents();
    expect(await toggle.textContent()).toBe(`${badges.reduce((n, b) => n + Number(b), 0)} smells`);
    await panel(page).locator('[data-code=overdue-bet]').getByRole('button', { name: /B-3/ }).click();
    await expect(node(page, 'B-3')).toHaveClass(/selected/);
    await expect.poll(() => offCentre(page, 'B-3')).toBeLessThan(40);
    // The smell reads as the badge does.
    await expect(panel(page).locator('[data-code=overdue-bet] button').first()).toHaveAttribute('title', /passed its deadline/);
  });

  test('says so when there is nothing to flag', async ({ page }) => {
    await page.goto('/?today=2026-09-01');
    await expect(node(page, 'B-1')).toBeVisible();
    for (const key of ['B-2', 'B-7', 'B-8']) await page.evaluate((k) => k, key);
    // Fix the notes with smells in the in-memory vault, as an edit would.
    await page.evaluate(() => {
      const put = (path: string, text: string) => window.gsDev.setFile(path, text);
      const bet = (id: string, extra = '') => `---\nid: ${id}\ntype: bet\nstatus: won\n${extra}---\n`;
      for (const path of ['Strategy/Bets/B-1 Get a D7 visa.md', 'Strategy/Bets/B-2 Apply for a digital nomad visa.md', 'Strategy/Bets/B-3 Sell pottery at weekend markets.md', 'Strategy/Bets/B-4 Save 20000 for kiln and lease.md', 'Strategy/Bets/B-7  Part-time barista job.md', 'Strategy/Bets/B-8 Teach pottery workshops.md']) {
        put(path, bet(path.match(/B-\d+/)![0], 'serves: "[[FP-1 Live in Portugal]]"\n'));
      }
      put('Strategy/Bets/B-6 Online ceramics course.md', bet('B-6', 'serves: "[[FP-2 Own a profitable ceramics studio]]"\n'));
    });
    await expect(page.locator('.gs-node-smell')).toHaveCount(0);
    await page.getByRole('button', { name: /smells?$/ }).click();
    await expect(page.getByRole('region', { name: 'Smells' })).toContainText('Nothing to flag');
    await expect(page.getByRole('button', { name: '0 smells' })).toBeVisible();
  });

  test('the walk goes through each fixed point, then outward along its serves chains, in a fixed order', async ({ page }) => {
    await page.goto('/?today=2026-10-04');
    await expect(node(page, 'B-1')).toBeVisible();
    await page.getByRole('button', { name: 'Review walk' }).click();
    const dialog = walk(page);
    await expect(dialog).toContainText('Step 1 of 10');
    await expect(dialog).toContainText('Fixed point');
    await expect(dialog).toContainText('FP-1 Live in Portugal');
    await expect(dialog.getByText('A-6 Portugal stays open')).toBeVisible(); // the assumption held by the fixed point is reviewed with it
    await expect(node(page, 'FP-1')).toHaveClass(/selected/);
    await expect(page.getByRole('complementary', { name: /^Inspector/ })).toHaveCount(0); // the walk has the floor
    const seen: string[] = [];
    for (let i = 1; i < 10; i++) {
      await dialog.getByRole('button', { name: /Next/ }).click();
      await expect(dialog).toContainText(`Step ${i + 1} of 10`);
      seen.push((await dialog.locator('h3').textContent())!.match(/^[A-Z]+-\d+/)![0]);
    }
    // B-7 serves B-4 here, and B-6's only serves is the phantom note kept as it is (D13): it is on no route.
    expect(seen).toEqual(['B-1', 'B-2', 'B-5', 'FP-2', 'B-4', 'B-3', 'B-7', 'B-8', 'B-6']);
    await expect(dialog).toContainText('Not on any route to a fixed point');
    await expect(dialog.getByRole('button', { name: /Next/ })).toBeDisabled();
    await expect(node(page, 'B-6')).toHaveClass(/selected/);
    await expect.poll(() => offCentre(page, 'B-6')).toBeLessThan(40);
  });

  test('a step shows the route, the dates, the smells and the assumptions of the note; Previous and the arrow keys go back and forth', async ({ page }) => {
    await page.goto('/?today=2026-10-20');
    await expect(node(page, 'B-1')).toBeVisible();
    await page.getByRole('button', { name: 'Review walk' }).click();
    const dialog = walk(page);
    for (let i = 0; i < 6; i++) await dialog.getByRole('button', { name: /Next/ }).click(); // → B-3
    await expect(dialog.locator('h3')).toContainText('B-3 Sell pottery at weekend markets');
    await expect(dialog).toContainText('On the way to FP-2 · 2 steps out');
    await expect(dialog).toContainText('B-3 → B-4 → FP-2');
    await expect(dialog).toContainText('Deadline 2026-10-15');
    await expect(dialog.getByRole('list', { name: 'Smells' })).toContainText('passed its deadline');
    await expect(dialog).toContainText('A-3 Weekend market stalls are available');
    await expect(dialog).toContainText('falsified');
    await dialog.press('ArrowLeft');
    await expect(dialog.locator('h3')).toContainText('B-4');
    await dialog.press('ArrowRight');
    await expect(dialog.locator('h3')).toContainText('B-3');
    await dialog.getByRole('button', { name: /Previous/ }).click();
    await expect(dialog.locator('h3')).toContainText('B-4');
  });

  test('the walk ends with Escape or ×, keeps the last note selected, and stays on its note when an edit changes the order', async ({ page }) => {
    await page.goto('/?today=2026-10-04&saveDelay=200');
    await expect(node(page, 'B-1')).toBeVisible();
    await page.getByRole('button', { name: 'Review walk' }).click();
    const dialog = walk(page);
    await dialog.getByRole('button', { name: /Next/ }).click(); // B-1
    await expect(dialog.locator('h3')).toContainText('B-1');
    // B-1 stops serving FP-1 (as an edit would do): the walk stays on it.
    await page.evaluate(() => window.gsDev.setFile('Strategy/Bets/B-1 Get a D7 visa.md', '---\nid: B-1\ntype: bet\nstatus: active\n---\n'));
    await expect(dialog.locator('h3')).toContainText('B-1');
    await expect(dialog).toContainText('Not on any route to a fixed point');
    await dialog.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(node(page, 'B-1')).toHaveClass(/selected/);
    await expect(page.getByRole('complementary', { name: /^Inspector/ })).toBeVisible();
    await page.getByRole('button', { name: 'Review walk' }).click();
    await walk(page).getByRole('button', { name: 'End the review walk' }).click();
    await expect(walk(page)).toHaveCount(0);
  });
});

test.describe('screenshots @visual', () => {
  // ?today pins the clock: the overdue smell, and so the badges, would otherwise change with the date.
  test('migrated test vault, light', async ({ page }) => {
    await page.goto('/?today=2026-10-01');
    await expect(node(page, 'B-1')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('migrated-light.png');
  });

  test('migrated test vault, automatic layout', async ({ page }) => {
    await page.goto('/?layout=auto&today=2026-10-01');
    await expect(page.locator(NOTES)).toHaveCount(18);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('migrated-auto.png');
  });

  // The two above are zoomed out to fit, so the styling is a few pixels; this one is zoomed in on it.
  for (const theme of ['light', 'dark']) {
    test(`migrated test vault, zoomed in, ${theme}`, async ({ page }) => {
      await page.goto(`/?today=2026-10-01${theme === 'dark' ? '&theme=dark' : ''}`);
      await expect(node(page, 'B-1')).toBeVisible();
      const zoomIn = page.getByRole('button', { name: 'Zoom In' });
      for (let i = 0; i < 5; i++) await zoomIn.click();
      await page.waitForTimeout(600);
      await expect(page).toHaveScreenshot(`migrated-zoomed-${theme}.png`);
    });
  }

  test('inspector and a right-click menu on a selected bet', async ({ page }) => {
    await page.goto('/?today=2026-10-01');
    await expect(node(page, 'B-1')).toBeVisible();
    const zoomIn = page.getByRole('button', { name: 'Zoom In' });
    for (let i = 0; i < 3; i++) await zoomIn.click();
    await page.waitForTimeout(500);
    await node(page, 'B-3').click({ position: { x: 60, y: 40 } });
    await node(page, 'B-3').click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('migrated-inspector.png');
  });

  test('smells panel and review walk', async ({ page }) => {
    await page.goto('/?today=2026-10-20');
    await expect(node(page, 'B-1')).toBeVisible();
    await page.getByRole('button', { name: /smells?$/ }).click();
    await page.getByRole('button', { name: 'Review walk' }).click();
    for (let i = 0; i < 6; i++) await page.getByRole('dialog', { name: 'Review walk' }).getByRole('button', { name: /Next/ }).click();
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot('migrated-walk.png');
  });

  test('legacy test vault, dark', async ({ page }) => {
    await page.goto('/?vault=legacy&theme=dark&today=2026-10-01');
    await expect(page.locator(NOTES)).toHaveCount(17);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('legacy-dark.png');
  });
});
