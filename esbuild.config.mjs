import { copyFile, mkdir } from 'node:fs/promises';
import esbuild from 'esbuild';
import { buildOptions, cssBuildOptions } from './esbuild.options.mjs';

const production = process.argv[2] === 'production';
const outdir = 'dist';

// Obsidian loads main.js, manifest.json and styles.css from the plugin folder.
// test-vault/.obsidian/plugins/strategy-bet-creator is a symlink to dist/.
const copyStatic = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      await mkdir(outdir, { recursive: true });
      await copyFile('manifest.json', `${outdir}/manifest.json`);
    });
  },
};

const contexts = await Promise.all([
  esbuild.context({ ...buildOptions({ production }), plugins: [copyStatic] }),
  esbuild.context(cssBuildOptions()),
]);

if (production) {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
} else {
  await Promise.all(contexts.map((context) => context.watch()));
}
