import { copyFile, mkdir } from 'node:fs/promises';
import esbuild from 'esbuild';
import { buildOptions } from './esbuild.options.mjs';

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
      await copyFile('src/styles.css', `${outdir}/styles.css`);
    });
  },
};

const context = await esbuild.context({ ...buildOptions({ production }), plugins: [copyStatic] });

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
