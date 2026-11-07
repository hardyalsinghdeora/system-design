/**
 * Runs the demo for one module.
 *
 *   npm run demo -- <module-path>      e.g. npm run demo -- parking-lot
 *   npm run demo                       lists every module that ships a demo
 *
 * A module is any folder under src/ (searched recursively) that contains a demo.ts.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = join(process.cwd(), 'src');

function findDemos(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (existsSync(join(full, 'demo.ts'))) out.push(relative(SRC, full).split(sep).join('/'));
      findDemos(full, out);
    }
  }
  return out.sort();
}

const requested = process.argv[2];
const demos = findDemos(SRC);

if (!requested) {
  console.log('Available demos:\n');
  for (const d of demos) console.log(`  npm run demo -- ${d}`);
  process.exit(0);
}

const match = demos.find((d) => d === requested || d.endsWith(`/${requested}`));
if (!match) {
  console.error(`No demo named "${requested}". Run "npm run demo" to list them.`);
  process.exit(1);
}

await import(pathToFileURL(join(SRC, match, 'demo.ts')).href);
