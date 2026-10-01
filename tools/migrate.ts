/** `npm run migrate -- --vault <path> [--resolutions <file>] [--out <dir>]` (dry run only). */
import { runMigrate } from './migrate/cli';

process.exitCode = await runMigrate(process.argv.slice(2));
