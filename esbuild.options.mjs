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
    // Unminified, like the legacy plugin, so errors in the dev console stay readable.
    minify: false,
    define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
    outfile: 'dist/main.js',
  };
}
