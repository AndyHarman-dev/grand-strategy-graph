import { builtinModules } from 'node:module';

/**
 * esbuild options for the plugin bundle, shared by esbuild.config.mjs and the
 * bundle test (tests/characterization/bundle.test.ts), so the test exercises
 * exactly what ships.
 * @param {{ production: boolean }} opts
 * @returns {import('esbuild').BuildOptions}
 */
export function buildOptions({ production }) {
  return {
    entryPoints: ['src/main.ts'],
    bundle: true,
    external: [
      'obsidian',
      'electron',
      '@codemirror/autocomplete',
      '@codemirror/collab',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lint',
      '@codemirror/search',
      '@codemirror/state',
      '@codemirror/view',
      '@lezer/common',
      '@lezer/highlight',
      '@lezer/lr',
      ...builtinModules,
    ],
    format: 'cjs',
    target: 'es2018',
    jsx: 'automatic',
    logLevel: 'info',
    sourcemap: production ? false : 'inline',
    treeShaking: true,
    // ELK and React make the bundle ~4.4 MB unminified, ~1.9 MB minified, and Obsidian parses it at
    // every startup. So releases are minified; the watch build (`npm run dev`) stays readable, with
    // an inline source map.
    minify: production,
    define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
    outfile: 'dist/main.js',
  };
}

/**
 * esbuild options for dist/styles.css: src/styles.css with its `@import`s (React Flow's
 * stylesheet, the graph's) inlined, since Obsidian loads a single styles.css per plugin.
 * @returns {import('esbuild').BuildOptions}
 */
export function cssBuildOptions() {
  return {
    entryPoints: ['src/styles.css'],
    bundle: true,
    logLevel: 'info',
    outfile: 'dist/styles.css',
  };
}
