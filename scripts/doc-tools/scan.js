const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.trae', '.vercel', '.next', 'dist', 'build']);
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.sh']);

function isCodeFile(file) {
  const ext = path.extname(file);
  if (file.endsWith('.d.ts')) return false;
  return CODE_EXTS.has(ext);
}

function hasHeader(fp) {
  try {
    const content = fs.readFileSync(fp, 'utf8');
    const head = content.split(/\r?\n/).slice(0, 25).join('\n');
    const required = ['Input:', 'Output:', 'Pos:', 'Note:'];
    return required.every(k => head.includes(k));
  } catch (e) {
    return false;
  }
}

function walk(dir, out) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  let hasReadme = false;
  let hasEntries = false;
  for (const ent of ents) {
    hasEntries = true;
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      walk(path.join(dir, ent.name), out);
    } else if (ent.isFile()) {
      if (ent.name.toLowerCase() === 'readme.md') hasReadme = true;
      const fp = path.join(dir, ent.name);
      if (isCodeFile(fp) && !hasHeader(fp)) {
        out.missingHeaders.push(fp);
      }
    }
  }
  if (hasEntries && !hasReadme) out.missingReadmes.push(dir);
}

function main() {
  const result = { missingReadmes: [], missingHeaders: [] };
  walk(ROOT, result);
  console.log('=== 文档扫描结果 ===');
  console.log('缺失目录 README 数量:', result.missingReadmes.length);
  console.log('缺失文件头注释数量:', result.missingHeaders.length);
  if (result.missingReadmes.length) {
    console.log('\n[缺失 README 目录列表]');
    result.missingReadmes.forEach(d => console.log('-', path.relative(ROOT, d)));
  }
  if (result.missingHeaders.length) {
    console.log('\n[缺失文件头注释列表]');
    result.missingHeaders.forEach(f => console.log('-', path.relative(ROOT, f)));
  }
}

main();
