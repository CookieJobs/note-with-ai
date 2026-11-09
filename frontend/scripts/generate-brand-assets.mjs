/** Generate every raster icon and App Router metadata file from the single PNG master. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const brand = path.join(frontend, 'public/brand');
const app = path.join(frontend, 'src/app');
const masterPath = path.join(brand, 'notewithai.png');
const source = await readFile(masterPath);
await mkdir(brand, { recursive: true });

const meta = await sharp(source).metadata();
if (meta.width !== meta.height) throw new Error(`${masterPath} must be square, got ${meta.width}x${meta.height}`);
if (!meta.hasAlpha) throw new Error(`${masterPath} must carry an alpha channel`);

const png = (size) => sharp(source)
  .resize(size, size, { kernel: 'lanczos3' })
  .png({ palette: false, compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer();

const pngs = new Map();
for (const size of [16, 24, 32, 48, 180, 192, 512]) {
  const buffer = await png(size);
  pngs.set(size, buffer);
  await writeFile(path.join(brand, `icon-${size}.png`), buffer);
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
// App Router file convention: Next.js hashes and links this PNG automatically.
await writeFile(path.join(app, 'icon.png'), pngs.get(192));
// Apple adds its own corner mask. Keep the blue mark centered on an opaque white tile.
const appleMark = await sharp(source).resize(120, 120, { kernel: 'lanczos3' }).png().toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: '#FFFFFF' } })
  .composite([{ input: appleMark, left: 30, top: 30 }]).png().toFile(path.join(app, 'apple-icon.png'));
console.log('Generated 7 transparent PNG sizes from notewithai.png, 16/32/48px favicon.ico, icon.png and Apple touch icon.');
