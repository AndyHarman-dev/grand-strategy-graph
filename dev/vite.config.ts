/**
 * Dev page for the graph (plan Phase 5a, "Dev harness"): `npm run dev:web`. Renders the same
 * <StrategyGraph> the plugin mounts, from a MemoryAdapter over the test vault, with no Obsidian.
 * Playwright drives it (playwright.config.ts).
 */
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { legacyTestVault, plannedTestVault } from '../tools/test-vault';

const VIRTUAL = 'virtual:test-vault';

/** `import vaults from 'virtual:test-vault'`: the test vault as path → text, read and planned in Node. */
function testVault(): Plugin {
  return {
    name: 'test-vault',
    resolveId: (id) => (id === VIRTUAL ? '\0' + VIRTUAL : null),
    load(id) {
      if (id !== '\0' + VIRTUAL) return null;
      return `export default ${JSON.stringify({ planned: plannedTestVault(), legacy: legacyTestVault() })};`;
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [testVault()],
  // `obsidian` never reaches the page; anything that imports it is a mistake worth a loud failure.
  resolve: { alias: { obsidian: fileURLToPath(new URL('./no-obsidian.ts', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
