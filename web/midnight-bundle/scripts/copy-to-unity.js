/**
 * Copy built bundle to Unity assets
 */

import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const source = join(projectRoot, 'dist', 'midnight.bundle.js');
const sourceMap = join(projectRoot, 'dist', 'midnight.bundle.js.map');

// Unity destinations
const unityPlugins = join(projectRoot, '..', '..', 'Assets', 'Plugins', 'WebGL');
const unityTemplate = join(projectRoot, '..', '..', 'Assets', 'WebGLTemplates', 'MidnightTemplate', 'TemplateData');

// Ensure directories exist
[unityPlugins, unityTemplate].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

// Copy files
console.log('Copying midnight.bundle.js to Unity...');

if (existsSync(source)) {
  // Copy to Plugins/WebGL
  const destPlugins = join(unityPlugins, 'midnight.bundle.js');
  copyFileSync(source, destPlugins);
  console.log('  -> ' + destPlugins);

  // Copy to WebGLTemplates/MidnightTemplate/TemplateData
  const destTemplate = join(unityTemplate, 'midnight.bundle.js');
  copyFileSync(source, destTemplate);
  console.log('  -> ' + destTemplate);

  // Copy source map if exists
  if (existsSync(sourceMap)) {
    copyFileSync(sourceMap, join(unityPlugins, 'midnight.bundle.js.map'));
    copyFileSync(sourceMap, join(unityTemplate, 'midnight.bundle.js.map'));
    console.log('  -> Source maps copied');
  }

  console.log('Done!');
} else {
  console.error('Source file not found:', source);
  console.error('Run "npm run build" first');
  process.exit(1);
}
