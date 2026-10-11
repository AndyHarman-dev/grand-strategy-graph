import { moment } from 'obsidian';

// obsidian.d.ts types `moment` through `import * as Moment from 'moment'`,
// which TypeScript (esModuleInterop is always on since TS 6) treats as a
// non-callable namespace. At runtime it is the moment function.
const callMoment = moment as unknown as () => { format(fmt: string): string };

/** Today's local date as YYYY-MM-DD. */
export function today(): string {
  return callMoment().format('YYYY-MM-DD');
}
