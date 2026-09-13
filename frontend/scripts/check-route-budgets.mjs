import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const defaultBaselinePath = new URL('./route-budget-baseline.json', import.meta.url);
const defaultRouteTablePath = new URL('../.next-route-sizes.txt', import.meta.url);

function parseKilobytes(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(kB|MB)$/i.exec(value.trim());
  if (!match) throw new Error(`Invalid First Load JS value: ${value}`);

  const amount = Number(match[1]);
  return match[2].toLowerCase() === 'mb' ? amount * 1000 : amount;
}

export function parseNotesFirstLoadKb(routeTable) {
  const notesRow = routeTable
    .split(/\r?\n/)
    .find((line) => /(?:^|\s)\/notes(?:\s|$)/.test(line));

  if (!notesRow) {
    throw new Error('Route budget check failed: /notes row is absent from .next-route-sizes.txt');
  }

  const columns = [...notesRow.matchAll(/(\d+(?:\.\d+)?\s*(?:kB|MB))/gi)].map((match) => match[1]);
  if (columns.length < 2) {
    throw new Error(`Route budget check failed: could not parse First Load JS from /notes row: ${notesRow}`);
  }

  return parseKilobytes(columns.at(-1));
}

export function assertNotesBudget(notesFirstLoadKb, baseline) {
  const reductionPercent = ((baseline.notesFirstLoadKb - notesFirstLoadKb) / baseline.notesFirstLoadKb) * 100;
  const errors = [];

  if (notesFirstLoadKb > baseline.maxNotesFirstLoadKb) {
    errors.push(`/notes First Load JS is ${notesFirstLoadKb.toFixed(1)} kB, above ${baseline.maxNotesFirstLoadKb} kB`);
  }
  if (reductionPercent < baseline.minReductionPercent) {
    errors.push(`/notes reduction is ${reductionPercent.toFixed(1)}%, below ${baseline.minReductionPercent}% from ${baseline.notesFirstLoadKb} kB`);
  }
  if (errors.length) throw new Error(`Route budget check failed: ${errors.join('; ')}`);

  return { notesFirstLoadKb, reductionPercent };
}

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

function main() {
  const baselinePath = process.env.ROUTE_BUDGET_BASELINE
    ? new URL(process.env.ROUTE_BUDGET_BASELINE, `file://${process.cwd()}/`)
    : defaultBaselinePath;
  const routeTablePath = process.env.NEXT_ROUTE_SIZES_FILE
    ? new URL(process.env.NEXT_ROUTE_SIZES_FILE, `file://${process.cwd()}/`)
    : defaultRouteTablePath;
  const baseline = readJson(baselinePath);
  const notesFirstLoadKb = parseNotesFirstLoadKb(readFileSync(routeTablePath, 'utf8'));
  const result = assertNotesBudget(notesFirstLoadKb, baseline);

  console.log(`/notes First Load JS: ${result.notesFirstLoadKb.toFixed(1)} kB; reduction: ${result.reductionPercent.toFixed(1)}%`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
