/*
Input: 待补充
Output: 待补充
Pos: 脚本/通用 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.trae', '.vercel', '.next', 'dist', 'build']);
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.sh']);

function runScan() {
  try {
    const out = execSync('node scripts/doc-tools/scan.js', { encoding: 'utf8' });
    return out;
  } catch (e) {
    return e.stdout?.toString() || e.message;
  }
}

function parseResult(output) {
  const missingReadmes = [];
  const missingHeaders = [];
  const lines = output.split(/\r?\n/);
  let section = '';
  for (const line of lines) {
    if (line.includes('[缺失 README 目录列表]')) section = 'readmes';
    else if (line.includes('[缺失文件头注释列表]')) section = 'headers';
    else if (line.startsWith('- ')) {
      if (section === 'readmes') missingReadmes.push(line.slice(2));
      else if (section === 'headers') missingHeaders.push(line.slice(2));
    }
  }
  return { missingReadmes, missingHeaders };
}

function isCodeFile(file) {
  const ext = path.extname(file);
  if (file.endsWith('.d.ts')) return false;
  return CODE_EXTS.has(ext);
}

function collectPlaceholders(dir, list) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of ents) {
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      collectPlaceholders(path.join(dir, ent.name), list);
    } else if (ent.isFile()) {
      const fp = path.join(dir, ent.name);
      if (isCodeFile(fp)) {
        try {
          const head = fs.readFileSync(fp, 'utf8').split(/\r?\n/).slice(0, 25).join('\n');
          if (head.includes('待补充')) list.push(path.relative(process.cwd(), fp));
        } catch {}
      }
    }
  }
}

function main() {
  const out = runScan();
  console.log(out);
  const { missingReadmes, missingHeaders } = parseResult(out);
  const placeholders = [];
  collectPlaceholders(process.cwd(), placeholders);
  const hasIssues = missingReadmes.length || missingHeaders.length || placeholders.length;
  if (hasIssues) {
    console.error('\n提交检查失败：');
    if (missingReadmes.length) console.error('缺失目录 README：', missingReadmes.length);
    if (missingHeaders.length) console.error('缺失文件头注释：', missingHeaders.length);
    if (placeholders.length) console.error('存在占位未完善的文件头：', placeholders.length);
    process.exit(1);
  } else {
    console.log('\n提交检查通过：文档与文件头规范已满足');
  }
}

main();
