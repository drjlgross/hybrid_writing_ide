import { defineConfig } from 'vite';

/**
 * Vite is build tooling, not a runtime dependency — nothing under src/ or the
 * server imports it, and the shipped output is plain JS and CSS. It is a
 * devDependency; see the chunk-06 report for why a bundler had to appear at all.
 *
 * There is no JSX plugin because there is no JSX: the components use
 * `createElement` directly so that `node --test` can import them with no
 * transform. Vite only bundles here; it never stands between a test and the
 * component it tests.
 */
export default defineConfig({
  root: 'client',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // The client imports src/tiptap-config.js and src/addressing.js from outside
    // client/, which is the point: the editor must use the same extension list the
    // round-trip tests proved the store against (§0.1).
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
