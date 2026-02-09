import { copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const source = join(projectRoot, 'dist', 'mesh-sdk.bundle.js');
const destinations = [
  // Unity WebGL Template
  join(projectRoot, '..', '..', 'Assets', 'WebGLTemplates', 'MidnightTemplate', 'TemplateData', 'mesh-sdk.bundle.js'),
  // Also copy to Plugins/WebGL for reference
  join(projectRoot, '..', '..', 'Assets', 'Plugins', 'WebGL', 'mesh-sdk.bundle.js'),
];

console.log('Copying mesh-sdk.bundle.js to Unity...');

for (const dest of destinations) {
  try {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(source, dest);
    console.log(`  ✓ ${dest}`);
  } catch (err) {
    console.error(`  ✗ Failed to copy to ${dest}:`, err.message);
  }
}

// Also copy sourcemap if it exists
try {
  const sourceMap = source + '.map';
  for (const dest of destinations) {
    copyFileSync(sourceMap, dest + '.map');
  }
  console.log('  ✓ Sourcemaps copied');
} catch {
  console.log('  (no sourcemap to copy)');
}

console.log('Done!');
