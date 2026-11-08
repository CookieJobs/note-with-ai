/** Generate every raster icon and App Router metadata file from the single SVG master. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const brand = path.join(frontend, 'public/brand');
const app = path.join(frontend, 'src/app');
const source = await readFile(path.join(brand, 'notewithai.svg'));
await mkdir(brand, { recursive: true });
const pngs = new Map();
for (const size of [16, 24, 32, 48, 180, 192, 512]) {
  const png = await sharp(source, { density: 384 }).resize(size, size).png().toBuffer();
  pngs.set(size, png);
  await writeFile(path.join(brand, `icon-${size}.png`), png);
}
// PNG payloads in an ICO container: modern browsers can choose the native 16/32/48px entry.
const sizes = [16, 32, 48];
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  header[entry] = size;
  header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(pngs.get(size).length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += pngs.get(size).length;
}
await writeFile(path.join(app, 'favicon.ico'), Buffer.concat([header, ...sizes.map(size => pngs.get(size))]));
await copyFile(path.join(brand, 'notewithai.svg'), path.join(app, 'icon.svg'));
// Apple adds its own corner mask. Keep the blue mark centered on an opaque white tile.
const appleMark = await sharp(source, { density: 384 }).resize(120, 120).png().toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: '#FFFFFF' } })
  .composite([{ input: appleMark, left: 30, top: 30 }]).png().toFile(path.join(app, 'apple-icon.png'));
console.log('Generated 7 transparent PNG sizes, 16/32/48px favicon.ico, icon.svg and Apple touch icon.');
