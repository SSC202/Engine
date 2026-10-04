import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

const htmlFiles = (await walk(distDir)).filter(file => file.endsWith('.html'));
const failures = [];
let references = 0;

for (const htmlFile of htmlFiles) {
  const html = await readFile(htmlFile, 'utf8');
  if (html.includes('$$')) failures.push(`${path.relative(distDir, htmlFile)} 仍含未渲染公式`);
  for (const [, reference] of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    if (/^(?:https?:|data:|mailto:|#)/i.test(reference)) continue;
    const clean = reference.split(/[?#]/)[0];
    if (!clean) continue;
    references += 1;
    try { await access(path.resolve(path.dirname(htmlFile), decodeURIComponent(clean))); }
    catch { failures.push(`${path.relative(distDir, htmlFile)} -> ${reference}`); }
  }
}

if (failures.length) {
  console.error(`检查失败，共 ${failures.length} 项：`);
  failures.slice(0, 50).forEach(item => console.error(`- ${item}`));
  process.exitCode = 1;
} else {
  console.log(`检查通过：${htmlFiles.length} 个页面，${references} 个本地引用。`);
}
