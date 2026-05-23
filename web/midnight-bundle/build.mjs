/**
 * Midnight Bundle Builder
 * =======================
 * 
 * Builds the Midnight SDK into a single browser-ready bundle.
 * Output: dist/midnight.bundle.js
 * 
 * Usage:
 *   npm install
 *   npm run build
 *   npm run build:copy  (also copies to Unity assets)
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function build() {
  console.log('=== Midnight Bundle Builder ===');
  console.log('');

  // Ensure dist directory exists
  const distDir = join(__dirname, 'dist');
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  const entryPoint = join(__dirname, 'src', 'index.ts');
  const outfile = join(distDir, 'midnight.bundle.js');

  console.log('Entry point:', entryPoint);
  console.log('Output:', outfile);
  console.log('');

  try {
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: outfile,
      format: 'iife',
      globalName: 'MidnightSDK',
      platform: 'browser',
      target: ['es2020'],
      minify: false, // Keep readable for debugging
      sourcemap: true,
      
      // Node.js polyfills for browser
      define: {
        'process.env.NODE_ENV': '"production"',
        'global': 'globalThis',
      },
      
      // Inject polyfills
      inject: [],
      
      // External packages that should not be bundled
      // (none - we want everything bundled)
      external: [],
      
      // Resolve Node.js built-ins to browser equivalents
      alias: {
        'buffer': 'buffer',
        'stream': 'stream-browserify',
        'events': 'events',
      },
      
      // Loader configuration
      loader: {
        '.wasm': 'binary',
      },
      
      // Log level
      logLevel: 'info',
      
      // Metafile for analysis
      metafile: true,
    });

    // Write metafile for bundle analysis
    writeFileSync(
      join(distDir, 'midnight.bundle.meta.json'),
      JSON.stringify(result.metafile, null, 2)
    );

    console.log('');
    console.log('Build successful!');
    console.log('Output:', outfile);
    
    // Print bundle size
    const stats = readFileSync(outfile);
    const sizeMB = (stats.length / 1024 / 1024).toFixed(2);
    console.log('Size:', sizeMB, 'MB');

  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
