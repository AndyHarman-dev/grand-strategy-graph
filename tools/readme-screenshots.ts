/**
 * The README pictures (`docs/images/*.png`): the dev page over the migrated test vault, driven by
 * Playwright. Run `npm run dev:web` in one terminal, then `npm run screenshots` in another.
 *
 * The test vault has no milestones (its Milestones folder is empty, as in the real vault), so the
 * milestone picture adds two in memory through `window.gsDev`, the way the e2e tests change notes.
 * Nothing is written to `test-vault/`.
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';

const BASE = process.env.DEV_URL ?? 'http://localhost:5173';
const OUT = new URL('../docs/images/', import.meta.url);
// A pinned clock, so the overdue smell (and so the badges) don't change with the day.
const TODAY = '2026-10-20';

const node = (page: Page, key: string) => page.locator(`.react-flow__node[data-id="${key}"]`);

async function open(page: Page, query = '') {
  await page.goto(`${BASE}/?today=${TODAY}${query}`);
  await node(page, 'B-1').waitFor();
  // The dev bar (vault picker, theme toggle) is the harness, not the plugin.
  await page.addStyleTag({ content: '.dev-bar { display: none !important; }' });
  await page.waitForTimeout(400);
}

async function zoom(page: Page, steps: number) {
  const button = page.getByRole('button', { name: steps > 0 ? 'Zoom In' : 'Zoom Out' });
  for (let i = 0; i < Math.abs(steps); i++) await button.click();
  await page.waitForTimeout(500);
}

type Box = { x: number; y: number; width: number; height: number };

/** The screen box around the given nodes. */
async function around(page: Page, keys: string[]): Promise<Box> {
  const boxes = await Promise.all(keys.map(async (key) => (await node(page, key).boundingBox())!));
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Pans so that the nodes' box is centred on (x, y) of the viewport (default: the middle). A scroll
 * pans 1:1, as a trackpad swipe does; it is repeated because a long one can stop short.
 */
async function centerOn(page: Page, keys: string[], x = 700, y = 430) {
  for (let i = 0; i < 6; i++) {
    const box = await around(page, keys);
    const [dx, dy] = [box.x + box.width / 2 - x, box.y + box.height / 2 - y];
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    await page.mouse.move(700, 850); // the empty pane at the bottom
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(300);
  }
}

/** Only the notes: hides the canvas's free cards, frames and their links, to see the layout itself. */
async function notesOnly(page: Page) {
  await page.addStyleTag({
    content: '.react-flow__node-card, .react-flow__node-frame, .react-flow__edge.gs-link { display: none !important; }',
  });
}

async function fit(page: Page) {
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page.waitForTimeout(500);
}

/** A screenshot of the viewport, or only of the box around `keys` (with a margin). */
async function shot(page: Page, name: string, keys?: string[], margin = 40) {
  let clip: Box | undefined;
  if (keys) {
    const box = await around(page, keys);
    const x = Math.max(0, box.x - margin);
    const y = Math.max(0, box.y - margin);
    clip = { x, y, width: Math.min(1400, box.x + box.width + margin) - x, height: Math.min(860, box.y + box.height + margin) - y };
  }
  await page.screenshot({ path: new URL(name, OUT).pathname, clip });
  console.log('wrote docs/images/' + name);
}

/** Two milestones (plan D17), in memory: B-4 now works toward an open one, B-1 toward a reached one. */
async function addMilestones(page: Page) {
  await page.evaluate(() => {
    const dev = window.gsDev;
    const replace = (path: string, from: string, to: string) => dev.setFile(path, dev.file(path).replace(from, to));
    dev.setFile(
      'Strategy/Milestones/M-1 Studio lease signed.md',
      [
        '---',
        'id: M-1',
        'type: milestone',
        'status: open',
        'serves:',
        '  - "[[FP-2 Own a profitable ceramics studio]]"',
        'assumptions:',
        '---',
        '## The Milestone',
        'A signed lease on a small studio with room for a kiln.',
        '',
        '## Log',
        '- 2026-10-01: Created',
        '',
      ].join('\n'),
    );
    dev.setFile(
      'Strategy/Milestones/M-2 Residence permit issued.md',
      [
        '---',
        'id: M-2',
        'type: milestone',
        'status: reached',
        'serves:',
        '  - "[[FP-1 Live in Portugal]]"',
        'assumptions:',
        '---',
        '## The Milestone',
        'The residence card is in hand.',
        '',
        '## Log',
        '- 2026-10-01: Created',
        '',
      ].join('\n'),
    );
    replace('Strategy/Bets/B-4 Save 20000 for kiln and lease.md', 'serves:\n  - "[[FP-2 Own a profitable ceramics studio]]"', 'serves:\n  - "[[M-1 Studio lease signed]]"');
    replace('Strategy/Bets/B-1 Get a D7 visa.md', 'serves:\n  - "[[FP-1 Live in Portugal]]"', 'serves:\n  - "[[M-2 Residence permit issued]]"');
    // A bet that starts from the milestone: it `requires` it, and waits (dormant) until it is reached.
    dev.setFile(
      'Strategy/Bets/B-9 Open the studio for walk-in sales.md',
      [
        '---',
        'id: B-9',
        'type: bet',
        'status: dormant',
        'started:',
        'deadline:',
        'expected-result: 30 walk-in sales a month',
        'serves:',
        '  - "[[FP-2 Own a profitable ceramics studio]]"',
        'requires:',
        '  - "[[M-1 Studio lease signed]]"',
        'next:',
        'assumptions:',
        '---',
        '## The Bet',
        '',
        '## Log',
        '- 2026-10-01: Created',
        '',
      ].join('\n'),
    );
  });
  await node(page, 'M-1').waitFor();
  await node(page, 'B-9').waitFor();
  await page.waitForTimeout(600);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 2 });
try {
  // 1. The whole strategy: the canvas positions, frames and free cards, as migrated.
  await open(page);
  await shot(page, 'overview.png');

  // 2. The same graph, dark theme (Obsidian's CSS variables).
  await open(page, '&theme=dark');
  await shot(page, 'overview-dark.png');

  // 3. The automatic layout (D19): time runs left to right, assumptions above their bets.
  const notes = ['CP', 'A-2', 'A-5', 'B-8', 'FP-1', 'FP-2'];
  await open(page, '&layout=auto');
  await notesOnly(page);
  await fit(page);
  await zoom(page, 1);
  await centerOn(page, notes);
  await shot(page, 'auto-layout.png', notes);

  // 4. Close up on the studio route: bet statuses, assumption colours, the AND junction.
  const studio = ['A-3', 'B-3', 'B-4', 'A-4', 'B-5', 'B-7'];
  await open(page);
  await zoom(page, 3);
  await centerOn(page, studio);
  await shot(page, 'bets-and-assumptions.png', studio);

  // 5. Milestones: an open checkpoint that a dormant bet requires, and a reached one.
  const milestones = ['B-1', 'M-2', 'FP-1', 'B-4', 'M-1', 'B-9', 'FP-2'];
  await open(page, '&layout=auto');
  await notesOnly(page);
  await addMilestones(page);
  await fit(page);
  await zoom(page, 2);
  await centerOn(page, milestones);
  await shot(page, 'milestones.png', milestones);

  // 6. Editing: the inspector of a selected bet and its right-click menu.
  await open(page);
  await zoom(page, 3);
  await centerOn(page, ['B-3'], 500, 430);
  await node(page, 'B-3').click({ position: { x: 60, y: 40 } });
  await node(page, 'B-3').click({ button: 'right' });
  await page.getByRole('menu').waitFor();
  await page.waitForTimeout(300);
  await shot(page, 'inspector.png');

  // 7. Smells and the review walk.
  await open(page);
  await page.getByRole('button', { name: /smells?$/ }).click();
  await page.getByRole('button', { name: 'Review walk' }).click();
  const walk = page.getByRole('dialog', { name: 'Review walk' });
  for (let i = 0; i < 6; i++) await walk.getByRole('button', { name: /Next/ }).click();
  await page.waitForTimeout(600);
  await shot(page, 'smells-and-walk.png');
} finally {
  await browser.close();
}
