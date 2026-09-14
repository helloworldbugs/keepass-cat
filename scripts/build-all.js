import { execSync } from 'node:child_process';
import fs from 'fs-extra';

const run = (cmd, env = {}) =>
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });

console.log('Cleaning previous build...');
fs.removeSync('extension/dist');
fs.removeSync('extension/manifest.json');
fs.removeSync('build');

console.log('Building shared web/background/content (browser-agnostic)...');
run('npx vite build --config vite.config.background.mts');
run('npx vite build --config vite.config.content.mts');
run('npx vite build'); // web (popup/options)

console.log('Building Chrome (MV3)...');
run('npx esno scripts/manifest.ts'); // no TARGET -> chrome
fs.copySync('extension', 'build/chrome');

console.log('Building Firefox (MV2)...');
run('npx esno scripts/manifest.ts', { TARGET: 'firefox' });
fs.copySync('extension', 'build/firefox');

console.log('Done: build/chrome and build/firefox');
