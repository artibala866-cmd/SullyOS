/** Audit remaining direct references before deleting the retired 彼方 source tree.
 * Reports source imports only; deleting live dependencies without a replacement breaks web builds.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const roots = ['apps', 'components', 'context', 'hooks', 'utils', 'worker/amsg/src'];
const excluded = new Set(['node_modules', 'dist', 'build', '.git']);
const imports = [];
const states = [];
function visit(path) {
  for (const child of readdirSync(path, { withFileTypes: true })) {
    if (excluded.has(child.name)) continue;
    const next = join(path, child.name).replaceAll('\\', '/');
    if (child.isDirectory()) { visit(next); continue; }
    if (!child.isFile() || !['.ts', '.tsx', '.js', '.jsx'].includes(extname(next))) continue;
    if (next.startsWith('utils/vrWorld/') || /(?:\.test|\.spec)\.[jt]sx?$/.test(next)) continue;
    const lines = readFileSync(next, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\b(?:from|import\s*\(|require\s*\()\s*['"`][^'"`]*vrWorld\//.test(line)) imports.push(`${next}:${i + 1} ${line.trim().slice(0, 160)}`);
      if (/\b(?:vrState|vr_card|sarLocalState|amsgSar|VRWorld)\b/.test(line)) states.push(`${next}:${i + 1}`);
    }
  }
}
for (const root of roots) visit(root);
console.log('RETIRED_VR_EXTERNAL_IMPORTS=' + imports.length);
for (const line of imports.slice(0, 130)) console.log('VR_DEP ' + line);
if (imports.length > 130) console.log('VR_DEP ...and ' + (imports.length - 130) + ' more');
console.log('RETIRED_VR_DATA_REFERENCES=' + states.length);
console.log('VR_DATA_FILES ' + [...new Set(states.map(line => line.split(':')[0]))].join(', '));
// Informational until migration and removal pass; never hide the current dependency graph.

const deletedPaths = ['utils/vrWorld', 'components/sar', 'assets/sar', 'worker/amsg/src/sarEnvelope.ts'];
const remaining = deletedPaths.filter(path => existsSync(path));
if (remaining.length > 0) console.error('RETIRED_VR_FILES_STILL_PRESENT ' + remaining.join(', '));
if (imports.length > 0 || remaining.length > 0) {
  console.error('Retired VR dependency or source asset has returned.');
  process.exitCode = 1;
}
