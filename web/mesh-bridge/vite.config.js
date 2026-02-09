import { defineConfig } from 'vite';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
  ],
  build: {
    target: 'es2020',
    outDir: 'dist',
    lib: {
      entry: 'src/mesh-unity-bridge.ts',
      name: 'MeshSDK',
      formats: ['iife'],
      fileName: () => 'mesh-sdk.bundle.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        format: 'iife',
        name: 'MeshSDK',
        extend: true,
      },
      plugins: [
        nodeResolve({
          browser: true,
          preferBuiltins: false,
        }),
        nodePolyfills({
          include: ['buffer', 'process', 'events', 'stream', 'util'],
          exclude: ['crypto'],
        }),
      ],
    },
    minify: false,
    sourcemap: true,
  },
  define: {
    'global': 'globalThis',
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.browser': 'true',
  },
  resolve: {
    alias: {
      'crypto': require.resolve('crypto-browserify'),
      'stream': require.resolve('stream-browserify'),
      'buffer': require.resolve('buffer/'),
      'events': require.resolve('events/'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2020',
      define: {
        global: 'globalThis',
      },
    },
  },
});
