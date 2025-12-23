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

function headerForExt(ext, rel) {
  const posGuess = rel.includes('backend') ? '后端' : rel.includes('frontend') ? '前端' : '脚本/通用';
  const commonNote = 'Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README';
  if (ext === '.css' || ext === '.scss') {
    return `/*\nInput: 待补充\nOutput: 待补充\nPos: ${posGuess} 样式\n${commonNote}\n*/\n`;
  }
  if (ext === '.sh') {
    return `# Input: 待补充\n# Output: 待补充\n# Pos: ${posGuess} 脚本\n# ${commonNote}\n`;
  }
  return `/*\nInput: 待补充\nOutput: 待补充\nPos: ${posGuess} 模块\n${commonNote}\n*/\n`;
}

function ensureReadme(dir) {
  const readmePath = path.join(dir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    const rel = path.relative(ROOT, dir);
    const content = `# 目录说明\n\n本目录待补充：用 1–3 行描述职责与架构定位。\n\n## 文件清单（名字 / 地位 / 功能）\n- 待补充：列出本目录下各文件的名字/地位/功能\n\n一旦我所属的文件夹有所变化，请更新我。\n`;
    fs.writeFileSync(readmePath, content, 'utf8');
  }
}

function walk(dir, changed) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  ensureReadme(dir);
  for (const ent of ents) {
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      walk(path.join(dir, ent.name), changed);
    } else if (ent.isFile()) {
      const fp = path.join(dir, ent.name);
      if (isCodeFile(fp) && !hasHeader(fp)) {
        const ext = path.extname(fp);
        const rel = path.relative(ROOT, fp);
        const header = headerForExt(ext, rel);
        const original = fs.readFileSync(fp, 'utf8');
        fs.writeFileSync(fp, header + original, 'utf8');
        changed.push(rel);
      }
    }
  }
}

function main() {
  const changed = [];
  walk(ROOT, changed);
  console.log('=== 注入完成 ===');
  console.log('新增头注释文件数量:', changed.length);
  if (changed.length) {
    changed.slice(0, 50).forEach(f => console.log('-', f));
    if (changed.length > 50) console.log('... 其余省略');
  }
}

main();
