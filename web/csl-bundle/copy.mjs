import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const targets = [
  '../../../Assets/WebGLTemplates/MidnightTemplate/TemplateData/csl.bundle.js',
  '../../../Assets/WebGLTemplates/MidnightTemplate/TemplateData/csl.bundle.js.map',
];

console.log('Copying CSL bundle to Unity...');

for (const target of targets) {
  const src = join(__dirname, 'dist', target.split('/').pop());
  const dest = join(__dirname, target);
  
  // Ensure directory exists
  const destDir = dirname(dest);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  
  try {
    copyFileSync(src, dest);
    console.log('  ✓', dest);
  } catch (e) {
    console.log('  ✗', dest, '-', e.message);
  }
}

console.log('Done!');
