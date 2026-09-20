import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkRouteBudgets(manifest, budgets, assetBytes) {
  const failures = [];
  for (const [route, budget] of Object.entries(budgets.routes ?? {})) {
    const assets = manifest.pages?.[route] ?? manifest.pages?.[`${route}/page`];
    if (!Array.isArray(assets)) {
      failures.push(`${route}: route assets were not found in build manifest`);
      continue;
    }
    const bytes = assets.reduce((total, asset) => total + assetBytes(asset), 0);
    if (bytes > budget.maxBytes) failures.push(`${route}: ${bytes} bytes exceeds ${budget.maxBytes} bytes`);
  }
  return failures;
}

async function main() {
  const root = process.argv[2] ?? '.next';
  const [manifestRaw, appManifestRaw, budgetsRaw] = await Promise.all([
    readFile(path.join(root, 'build-manifest.json'), 'utf8'),
    readFile(path.join(root, 'app-build-manifest.json'), 'utf8'),
    readFile(new URL('./route-budget-baseline.json', import.meta.url), 'utf8'),
  ]);
  const manifest = {
    pages: { ...JSON.parse(manifestRaw).pages, ...JSON.parse(appManifestRaw).pages },
  };
  const sizes = new Map();
  for (const asset of Object.values(manifest.pages).flat()) {
    const file = path.join(root, asset.replace(/^\/_next\//, ''));
    sizes.set(asset, (await stat(file)).size);
  }
  const failures = checkRouteBudgets(manifest, JSON.parse(budgetsRaw), (asset) => sizes.get(asset) ?? 0);
  if (failures.length) throw new Error(`Route-budget regression:\n${failures.join('\n')}`);
  console.log('Route budgets are within the checked-in limits.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
