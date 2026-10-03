import { describe, expect, it } from 'vitest';
import { describeIdChange, IdTracker } from '../../src/core/id-changes';

const node = (path: string, id: string | null) => ({ path, basename: path.replace(/^.*\/|\.md$/g, ''), id });

describe('IdTracker', () => {
  it('reports nothing on the first build or when ids stay', () => {
    const t = new IdTracker();
    expect(t.update([node('S/B-1.md', 'B-1')])).toEqual([]);
    expect(t.update([node('S/B-1.md', 'B-1')])).toEqual([]);
  });

  it('reports a changed or removed id, once', () => {
    const t = new IdTracker();
    t.update([node('S/B-1.md', 'B-1'), node('S/B-2.md', 'B-2')]);
    expect(t.update([node('S/B-1.md', 'B-9'), node('S/B-2.md', null)])).toEqual([
      { path: 'S/B-1.md', basename: 'B-1', from: 'B-1', to: 'B-9' },
      { path: 'S/B-2.md', basename: 'B-2', from: 'B-2', to: null },
    ]);
    expect(t.update([node('S/B-1.md', 'B-9'), node('S/B-2.md', null)])).toEqual([]);
  });

  it('a rename keeps the id: nothing to report', () => {
    const t = new IdTracker();
    t.update([node('S/B-1 Old.md', 'B-1')]);
    t.rename('S/B-1 Old.md', 'S/Bets/B-1 New.md');
    expect(t.update([node('S/Bets/B-1 New.md', 'B-1')])).toEqual([]);
  });

  it('a rename together with an id change is still reported', () => {
    const t = new IdTracker();
    t.update([node('S/B-1.md', 'B-1')]);
    t.rename('S/B-1.md', 'S/B-7.md');
    expect(t.update([node('S/B-7.md', 'B-7')]).map((c) => `${c.from}>${c.to}`)).toEqual(['B-1>B-7']);
  });

  it('a note that gains its first id is not a change', () => {
    const t = new IdTracker();
    t.update([node('S/x.md', null)]);
    expect(t.update([node('S/x.md', 'B-3')])).toEqual([]);
  });
});

describe('describeIdChange', () => {
  it('says where the position went when there was one', () => {
    const change = { path: 'S/B-1.md', basename: 'B-1 Visa', from: 'B-1', to: 'B-9' };
    expect(describeIdChange(change, true)).toBe(
      'B-1 Visa changed id from "B-1" to "B-9". Its saved position stays under "B-1" in Strategy.gsmap, so the node is placed automatically until you drag it.'
    );
    expect(describeIdChange({ ...change, to: null }, false)).toBe('B-1 Visa lost its id "B-1".');
  });
});
