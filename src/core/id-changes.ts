import type { GraphNode } from './schema';

/**
 * Positions are keyed by `id`, so a rename needs no handling, but a changed `id` leaves the
 * node's saved position behind under the old one (plan Phase 5a). This tracks the id of each
 * note by path across rebuilds and reports such changes.
 */
export interface IdChange {
  path: string;
  basename: string;
  from: string;
  /** Null when the id was removed. */
  to: string | null;
}

export class IdTracker {
  private ids = new Map<string, string | null>();

  /** A note moved or was renamed: carry its last known id over to the new path. */
  rename(oldPath: string, newPath: string): void {
    if (!this.ids.has(oldPath)) return;
    this.ids.set(newPath, this.ids.get(oldPath)!);
    this.ids.delete(oldPath);
  }

  /** Compare with the previous build and remember this one. The first build reports nothing. */
  update(nodes: readonly Pick<GraphNode, 'path' | 'basename' | 'id'>[]): IdChange[] {
    const changes: IdChange[] = [];
    const next = new Map<string, string | null>();
    for (const node of nodes) {
      const before = this.ids.get(node.path);
      if (before != null && before !== node.id) changes.push({ path: node.path, basename: node.basename, from: before, to: node.id });
      next.set(node.path, node.id);
    }
    this.ids = next;
    return changes;
  }
}

export function describeIdChange(change: IdChange, hadPosition: boolean): string {
  const what = change.to === null ? `lost its id "${change.from}"` : `changed id from "${change.from}" to "${change.to}"`;
  const after = hadPosition
    ? ` Its saved position stays under "${change.from}" in Strategy.gsmap, so the node is placed automatically until you drag it.`
    : '';
  return `${change.basename} ${what}.${after}`;
}
