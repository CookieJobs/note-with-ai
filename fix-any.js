const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    if (file === 'node_modules' || file === '.next' || file === 'dist' || file === 'build') return;
    file = path.resolve(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('./frontend/src').concat(walk('./backend'));

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let changed = false;

  // Replace catch (err: any) with catch (err: unknown)
  let newContent = content.replace(/catch\s*\(\s*([a-zA-Z0-9_]+)\s*:\s*any\s*\)/g, 'catch ($1: unknown)');
  
  if (content !== newContent) {
    content = newContent;
    changed = true;
    console.log('Fixed catch in', f);
  }
  
  // Also let's replace Record<string, any> with Record<string, unknown>
  newContent = content.replace(/Record<string,\s*any>/g, 'Record<string, unknown>');
  if (content !== newContent) {
    content = newContent;
    changed = true;
    console.log('Fixed Record in', f);
  }

  // Also replace any[] with unknown[] in specific places if needed, but the prompt says "eliminate any types across frontend and backend".
  
  if (changed) {
    fs.writeFileSync(f, content);
  }
});
