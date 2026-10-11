import { describe, expect, it } from 'vitest';
import { applyOps, emptyGsMap, parseGsMap, renamedPath, renameTouches, serializeGsMap, writeOps, type GsCard, type GsLink, type GsMap, type GsOp } from '../../src/core/gsmap';

const card = (id: string, extra: Partial<GsCard> = {}): GsCard => ({ id, kind: 'text', text: id, x: 10, y: 20, width: 200, height: 60, ...extra }) as GsCard;
const link = (id: string, from: GsLink['from'], to: GsLink['to']): GsLink => ({ id, from, to });

const base = (): GsMap => ({
  ...emptyGsMap(),
  positions: { 'B-1': { x: 1, y: 2 } },
  cards: [card('a'), card('b')],
  frames: [{ id: 'f', label: 'Visa', x: 0, y: 0, width: 500, height: 300 }],
  links: [link('l1', { card: 'a' }, { note: 'B-1' }), link('l2', { note: 'B-1' }, { card: 'b' }), link('l3', { card: 'b' }, { note: 'B-2' })],
});

const run = (ops: GsOp[], map = base()) => {
  const read = parseGsMap(writeOps(serializeGsMap(map), ops));
  if (!read.ok) throw new Error(read.error);
  return read.map;
};

describe('writeOps', () => {
  it('adds a card, and replaces one with the same id in place', () => {
    const added = run([{ op: 'put-card', card: card('c', { text: 'new' }) }]);
    expect(added.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    const replaced = run([{ op: 'put-card', card: card('a', { text: 'edited', x: 99 }) }]);
    expect(replaced.cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(replaced.cards[0]).toMatchObject({ text: 'edited', x: 99 });
  });

  it('deleting a card takes the links on it, and only those', () => {
    const map = run([{ op: 'delete-card', id: 'b' }]);
    expect(map.cards.map((c) => c.id)).toEqual(['a']);
    expect(map.links.map((l) => l.id)).toEqual(['l1']);
  });

  it('puts and deletes frames and links by id', () => {
    const map = run([
      { op: 'put-frame', frame: { id: 'f', label: 'Renamed', x: 0, y: 0, width: 600, height: 300 } },
      { op: 'put-frame', frame: { id: 'g', label: 'New', x: 5, y: 5, width: 50, height: 50 } },
      { op: 'put-link', link: { ...link('l1', { card: 'a' }, { note: 'B-1' }), label: 'because' } },
      { op: 'delete-link', id: 'l2' },
      { op: 'delete-frame', id: 'zzz' },
    ]);
    expect(map.frames).toEqual([
      { id: 'f', label: 'Renamed', x: 0, y: 0, width: 600, height: 300 },
      { id: 'g', label: 'New', x: 5, y: 5, width: 50, height: 50 },
    ]);
    expect(map.links.map((l) => [l.id, l.label])).toEqual([['l1', 'because'], ['l3', undefined]]);
  });

  it('promoting a card removes it, re-ends its links on the note, and gives the note its place', () => {
    const map = run([{ op: 'promote-card', card: 'a', note: 'B-9' }]);
    expect(map.cards.map((c) => c.id)).toEqual(['b']);
    expect(map.links.find((l) => l.id === 'l1')).toEqual({ id: 'l1', from: { note: 'B-9' }, to: { note: 'B-1' } });
    expect(map.positions['B-9']).toEqual({ x: 10, y: 20 });
    expect(map.positions['B-1']).toEqual({ x: 1, y: 2 });
  });

  it('promoting keeps a position the note already has, and is a no-op when the card is gone', () => {
    const withPosition = { ...base(), positions: { 'B-1': { x: 1, y: 2 }, 'B-9': { x: 7, y: 8 } } };
    expect(run([{ op: 'promote-card', card: 'a', note: 'B-9' }], withPosition).positions['B-9']).toEqual({ x: 7, y: 8 });
    const once = run([{ op: 'promote-card', card: 'a', note: 'B-9' }]);
    expect(run([{ op: 'promote-card', card: 'a', note: 'B-9' }], once)).toEqual(once);
  });

  it('a renamed file or folder takes the note cards on it along, and nothing else', () => {
    const ref = (id: string, file: string) => card(id, { kind: 'note-ref', file } as Partial<GsCard>);
    const map = { ...base(), cards: [ref('n1', 'Notes/Old.md'), ref('n2', 'Notes/Sub/Other.md'), ref('n3', 'Notes Old.md'), card('Notes/Old.md')] };
    const file = run([{ op: 'rename-file', from: 'Notes/Old.md', to: 'Notes/New.md' }], map);
    expect(file.cards.map((c) => (c.kind === 'note-ref' ? c.file : c.kind === 'text' ? c.text : c.url))).toEqual(['Notes/New.md', 'Notes/Sub/Other.md', 'Notes Old.md', 'Notes/Old.md']);
    const folder = run([{ op: 'rename-file', from: 'Notes', to: 'Archive/Notes' }], map);
    expect(folder.cards.map((c) => (c.kind === 'note-ref' ? c.file : c.kind === 'text' ? c.text : c.url))).toEqual(['Archive/Notes/Old.md', 'Archive/Notes/Sub/Other.md', 'Notes Old.md', 'Notes/Old.md']);
    expect(renameTouches(map, 'Notes/Sub')).toBe(true);
    expect(renameTouches(map, 'Notes/Old')).toBe(false); // a prefix that is not the folder
    expect(renameTouches(base(), 'a')).toBe(false); // text cards name no file
    expect(renamedPath('a/b.md', 'a/b.md', 'c.md')).toBe('c.md');
  });

  it('keeps everything it does not touch, unknown keys and their order included', () => {
    const text = JSON.stringify({ version: 1, extra: { keep: true }, positions: { 'B-1': { x: 1, y: 2 } }, cards: [{ ...card('a'), unknown: 'x' }], frames: [], links: [] }, null, '\t') + '\n';
    const out = JSON.parse(writeOps(text, [{ op: 'put-card', card: card('b') }]));
    expect(Object.keys(out)).toEqual(['version', 'extra', 'positions', 'cards', 'frames', 'links']);
    expect(out.extra).toEqual({ keep: true });
    expect(out.cards[0].unknown).toBe('x');
  });

  it('writes onto an empty file, and refuses a file it cannot read', () => {
    expect(parseGsMap(writeOps('', [{ op: 'put-card', card: card('a') }]))).toMatchObject({ ok: true, map: { cards: [{ id: 'a' }] } });
    expect(() => writeOps('{"version": 99}', [])).toThrow("can't be read");
    expect(() => writeOps('not json', [])).toThrow("can't be read");
  });
});

describe('applyOps', () => {
  it('gives what writing the ops and reading the file back would, and keeps the viewport', () => {
    const map = { ...base(), viewport: { x: 1, y: 2, zoom: 0.5 } };
    const ops: GsOp[] = [{ op: 'delete-card', id: 'a' }, { op: 'put-card', card: card('z') }];
    expect(applyOps(map, ops)).toEqual({ ...run(ops), viewport: map.viewport });
    expect(applyOps(map, [])).toBe(map);
  });
});
