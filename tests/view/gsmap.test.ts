import { describe, expect, it } from 'vitest';
import { clearPositions, emptyGsMap, parseGsMap, serializeGsMap, writePositions } from '../../src/core/gsmap';
import { plannedTestVault } from '../../tools/test-vault';

const planned = plannedTestVault()['Strategy/Strategy.gsmap'];

describe('parseGsMap', () => {
  it('reads the .gsmap the migration planner writes for the test vault', () => {
    const read = parseGsMap(planned);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.map.positions['B-1']).toEqual({ x: 300, y: 0 });
    expect(read.map.cards.length).toBeGreaterThan(0);
    expect(read.map.frames.length).toBeGreaterThan(0);
  });

  it('reads cards of every kind, frames and links that are what they say', () => {
    const text = JSON.stringify({
      version: 1,
      cards: [
        { id: 'a', kind: 'text', text: '', x: 0, y: 0, width: 1, height: 1 },
        { id: 'b', kind: 'note-ref', file: 'x.md', x: 0, y: 0, width: 1, height: 1 },
        { id: 'c', kind: 'link', url: 'https://example.com', x: 0, y: 0, width: 1, height: 1 },
      ],
      frames: [{ id: 'f', label: '', x: 0, y: 0, width: 1, height: 1 }],
      links: [{ id: 'l', from: { card: 'a' }, to: { note: 'B-1' } }],
    });
    expect(parseGsMap(text).ok).toBe(true);
  });

  it('reads an empty file as an empty map', () => {
    expect(parseGsMap('')).toEqual({ ok: true, map: emptyGsMap() });
    expect(parseGsMap(' \n')).toEqual({ ok: true, map: emptyGsMap() });
  });

  it('fills in missing lists', () => {
    expect(parseGsMap('{"version":1}')).toEqual({ ok: true, map: emptyGsMap() });
  });

  it.each([
    ['{', /not valid JSON/],
    ['[]', /not a JSON object/],
    ['{"positions":{}}', /unknown format version null/],
    ['{"version":2,"positions":{}}', /newer plugin/],
    ['{"version":1,"positions":[]}', /`positions` is not an object/],
    ['{"version":1,"positions":{"B-1":{"x":"1","y":2}}}', /position of "B-1"/],
    ['{"version":1,"cards":{}}', /`cards` is not a list/],
    // The graph draws these without checking again, so one that is not what it says is an error, not a crash.
    ['{"version":1,"cards":[{"id":"a","kind":"text","text":"t","x":"0","y":0,"width":1,"height":1}]}', /card 1 is not a card/],
    ['{"version":1,"cards":[{"id":"a","kind":"text","x":0,"y":0,"width":1,"height":1}]}', /card 1 is not a card/],
    ['{"version":1,"cards":[{"id":"a","kind":"photo","x":0,"y":0,"width":1,"height":1}]}', /card 1 is not a card/],
    ['{"version":1,"frames":[{"id":"f","x":0,"y":0,"width":1,"height":1}]}', /frame 1 is not a frame/],
    ['{"version":1,"links":[{"id":"l","from":{"card":"a"}}]}', /link 1 is not a link/],
    ['{"version":1,"links":[{"id":"l","from":"a","to":{"note":"B-1"}}]}', /link 1 is not a link/],
    ['{"version":1,"links":[null]}', /link 1 is not a link/],
  ])('refuses %s', (text, error) => {
    const read = parseGsMap(text);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error).toMatch(error);
  });
});

describe('writePositions', () => {
  it('changes only the given positions and keeps every other byte', () => {
    const out = writePositions(planned, { 'B-1': { x: 310.4, y: -20.6 } });
    const before = JSON.parse(planned);
    const after = JSON.parse(out);
    expect(after.positions['B-1']).toEqual({ x: 310, y: -21 });
    expect({ ...after, positions: { ...after.positions, 'B-1': before.positions['B-1'] } }).toEqual(before);
    expect(out.replace('"x": 310,\n\t\t\t"y": -21', '"x": 300,\n\t\t\t"y": 0')).toBe(planned);
  });

  it('adds a new id at the end of positions', () => {
    const out = JSON.parse(writePositions(planned, { 'B-9': { x: 1, y: 2 } }));
    expect(Object.keys(out.positions).pop()).toBe('B-9');
  });

  it('keeps unknown keys and their order', () => {
    const text = '{\n\t"version": 1,\n\t"extra": {"a": 1},\n\t"positions": {}\n}\n';
    expect(writePositions(text, { X: { x: 0, y: 0 } })).toBe(
      '{\n\t"version": 1,\n\t"extra": {\n\t\t"a": 1\n\t},\n\t"positions": {\n\t\t"X": {\n\t\t\t"x": 0,\n\t\t\t"y": 0\n\t\t}\n\t}\n}\n'
    );
  });

  it('starts an empty file as a full map', () => {
    const out = writePositions('', { CP: { x: 5, y: 6 } });
    expect(out).toBe(serializeGsMap({ ...emptyGsMap(), positions: { CP: { x: 5, y: 6 } } }));
  });

  it('throws, writing nothing, on a file it cannot read', () => {
    expect(() => writePositions('{"version":2}', { CP: { x: 0, y: 0 } })).toThrow(/newer plugin/);
    expect(() => writePositions('not json', { CP: { x: 0, y: 0 } })).toThrow(/not valid JSON/);
  });
});

describe('clearPositions', () => {
  it('empties positions and keeps every other key, unknown ones included, in order', () => {
    const text = '{\n\t"version": 1,\n\t"extra": 1,\n\t"positions": {\n\t\t"B-1": {"x": 1, "y": 2}\n\t},\n\t"cards": []\n}\n';
    expect(clearPositions(text)).toBe('{\n\t"version": 1,\n\t"extra": 1,\n\t"positions": {},\n\t"cards": []\n}\n');
  });

  it('keeps the viewport, cards, frames and links of the planned test vault', () => {
    const after = JSON.parse(clearPositions(planned));
    expect(after.positions).toEqual({});
    expect({ ...after, positions: undefined }).toEqual({ ...JSON.parse(planned), positions: undefined });
  });

  it('throws, writing nothing, on a file it cannot read', () => {
    expect(() => clearPositions('{"version":2}')).toThrow(/newer plugin/);
  });
});
