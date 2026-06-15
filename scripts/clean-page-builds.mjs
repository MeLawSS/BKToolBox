import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export const PAGE_BUILD_OUTPUTS = [
  'public/home/index.html',
  'public/home/assets',
  'public/elsa/assets',
  'public/ahmed/index.html',
  'public/ahmed/assets',
  'public/ethan/index.html',
  'public/ethan/assets',
  'public/monitor/index.html',
  'public/monitor/assets',
  'public/price/index.html',
  'public/price/assets',
  'public/inject/index.html',
  'public/inject/assets',
];

export async function cleanPageBuilds(root = projectRoot) {
  const removed = [];
  for (const relativePath of PAGE_BUILD_OUTPUTS) {
    const target = path.join(root, relativePath);
    await rm(target, { recursive: true, force: true });
    removed.push(target);
  }
  return removed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cleanPageBuilds().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
