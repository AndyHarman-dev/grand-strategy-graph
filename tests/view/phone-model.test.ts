import { describe, expect, it } from 'vitest';
import { bottomInset, FREE_MARGIN, NAVBAR_GAP, panIntoFree } from '../../src/ui/model';

/** Where a node (graph coordinates) is drawn under a viewport, in pixels of the graph's box. */
const onScreen = (node: { x: number; y: number; width: number; height: number }, v: { x: number; y: number; zoom: number }) => ({
  x: node.x * v.zoom + v.x,
  y: node.y * v.zoom + v.y,
  width: node.width * v.zoom,
  height: node.height * v.zoom,
});

const inside = (inner: ReturnType<typeof onScreen>, outer: { x: number; y: number; width: number; height: number }) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

describe('panIntoFree (phone: a docked card never covers its node)', () => {
  // Portrait, 390×844: the toolbar row ends at 64, the peek card starts at 560.
  const portraitFree = { x: 0, y: 64, width: 390, height: 496 };
  // Landscape, 844×390: the rail ends at 64 on the left, the docked card starts at 520 on the right.
  const landscapeFree = { x: 64, y: 0, width: 456, height: 340 };
  const node = { x: 100, y: 100, width: 220, height: 80 };

  it('leaves the view alone when the node is in the free area already', () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    expect(panIntoFree(node, portraitFree, viewport)).toEqual(viewport);
  });

  it('portrait: pans a node that sits under the peek card up, just enough', () => {
    const viewport = { x: 0, y: 450, zoom: 1 }; // the node is drawn at y 550..630, under the card
    const next = panIntoFree(node, portraitFree, viewport);
    expect(next.x).toBe(0);
    expect(onScreen(node, next).y + 80).toBe(portraitFree.y + portraitFree.height - FREE_MARGIN);
    expect(inside(onScreen(node, next), portraitFree)).toBe(true);
  });

  it('portrait: pans a node hidden under the toolbar down', () => {
    const next = panIntoFree(node, portraitFree, { x: 0, y: -90, zoom: 1 });
    expect(onScreen(node, next).y).toBe(portraitFree.y + FREE_MARGIN);
  });

  it('landscape: pans a node under the docked card (right) or the rail (left) sideways', () => {
    const right = panIntoFree(node, landscapeFree, { x: 400, y: 0, zoom: 1 });
    expect(onScreen(node, right).x + 220).toBe(landscapeFree.x + landscapeFree.width - FREE_MARGIN);
    const left = panIntoFree(node, landscapeFree, { x: -120, y: 0, zoom: 1 });
    expect(onScreen(node, left).x).toBe(landscapeFree.x + FREE_MARGIN);
    expect(inside(onScreen(node, left), landscapeFree)).toBe(true);
  });

  it('keeps the zoom it is given, and works at other zooms', () => {
    const viewport = { x: 0, y: 300, zoom: 0.5 };
    const next = panIntoFree(node, portraitFree, viewport);
    expect(next.zoom).toBe(0.5);
    expect(inside(onScreen(node, next), portraitFree)).toBe(true);
  });

  it('centres a node too big for the free area on it', () => {
    const big = { x: 0, y: 0, width: 600, height: 80 };
    const next = panIntoFree(big, portraitFree, { x: 0, y: 0, zoom: 1 });
    const drawn = onScreen(big, next);
    expect(drawn.x + drawn.width / 2).toBe(portraitFree.x + portraitFree.width / 2);
    // The other axis still fits, so it moves only as far as it must: out from under the toolbar.
    expect(drawn.y).toBe(portraitFree.y + FREE_MARGIN);
  });

  it('centres the node when the zoom changes', () => {
    const next = panIntoFree(node, landscapeFree, { x: 0, y: 0, zoom: 0.4 }, 1);
    const drawn = onScreen(node, next);
    expect(next.zoom).toBe(1);
    expect(drawn.x + drawn.width / 2).toBe(landscapeFree.x + landscapeFree.width / 2);
    expect(drawn.y + drawn.height / 2).toBe(landscapeFree.y + landscapeFree.height / 2);
  });
});

describe('bottomInset (phone: clear Obsidian\'s mobile navbar)', () => {
  it('is the part of the graph the navbar covers, plus the gap', () => {
    // The view runs to the bottom of an 844 px screen; the floating navbar starts at 768.
    expect(bottomInset({ bottom: 844 }, { top: 768, height: 48 })).toBe(76 + NAVBAR_GAP);
  });

  it('is just the gap when the view ends above the navbar', () => {
    expect(bottomInset({ bottom: 700 }, { top: 768, height: 48 })).toBe(NAVBAR_GAP);
  });

  it('is null (the CSS fallback applies) when there is no navbar to measure', () => {
    expect(bottomInset({ bottom: 844 }, null)).toBeNull();
    expect(bottomInset({ bottom: 844 }, { top: 0, height: 0 })).toBeNull();
  });
});
