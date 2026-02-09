import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('Building CSL bundle for browser...');

try {
  await esbuild.build({
    entryPoints: ['src/csl-entry.js'],
    bundle: true,
    format: 'iife',
    globalName: 'CardanoWasm',
    outfile: 'dist/csl.bundle.js',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    sourcemap: true,
    loader: {
      '.wasm': 'binary',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    logLevel: 'info',
  });

  console.log('Build complete!');
  console.log('Output:', join(__dirname, 'dist', 'csl.bundle.js'));

} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
