const fs = require('fs');
const path = require('path');

const backendDir = '/Users/liujin/Documents/noteWithAI/backend';

function getRelativeLoggerImportPath(filePath) {
  const loggerPath = path.join(backendDir, 'utils', 'logger');
  let relativePath = path.relative(path.dirname(filePath), loggerPath);
  if (!relativePath.startsWith('.')) {
    relativePath = './' + relativePath;
  }
  return relativePath;
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  if (!content.match(/console\.(log|error|warn|info|debug)/)) {
    return;
  }

  let newContent = content
    .replace(/console\.log/g, 'logger.info')
    .replace(/console\.error/g, 'logger.error')
    .replace(/console\.warn/g, 'logger.warn')
    .replace(/console\.info/g, 'logger.info')
    .replace(/console\.debug/g, 'logger.debug');

  if (!newContent.includes('import { logger }')) {
    const importStatement = `import { logger } from '${getRelativeLoggerImportPath(filePath)}';`;
    
    // Insert after the last import statement or at the top
    const lines = newContent.split('\n');
    let lastImportIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('import ')) {
        lastImportIndex = i;
      }
    }

    if (lastImportIndex !== -1) {
      lines.splice(lastImportIndex + 1, 0, importStatement);
    } else {
      lines.unshift(importStatement);
    }
    newContent = lines.join('\n');
  }

  fs.writeFileSync(filePath, newContent, 'utf-8');
  console.log(`Updated ${filePath}`);
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist' && !file.startsWith('.')) {
        walkDir(fullPath);
      }
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.js')) {
      if (fullPath !== path.join(backendDir, 'utils', 'logger.ts') && fullPath !== path.join(backendDir, 'replace_logger.ts') && fullPath !== path.join(backendDir, 'replace_logger.js')) {
        processFile(fullPath);
      }
    }
  }
}

walkDir(backendDir);
