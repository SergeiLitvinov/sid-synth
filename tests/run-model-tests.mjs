// Node runner for DOM-free model suites. The DOM below only collects reports;
// this does not substitute for the real browser, audio or UI suites.
import { spawnSync } from 'node:child_process';
const suites = ['project-test','project-validation-test','projectStore-test','projectSession-test','audit-test',
  'track-test','song-test','history-test','clipEvents-test'];
if (!process.argv[2]) {
  let failed = false;
  for (const suite of suites) {
    const result = spawnSync(process.execPath, [import.meta.filename, suite], { stdio: 'inherit' });
    failed ||= result.status !== 0;
  }
  process.exit(failed ? 1 : 0);
}
const suite = process.argv[2];
if (!suites.includes(suite)) throw new Error('Unsupported model suite: ' + suite);
const reports = new Map();
let failures = 0;
function append(li) {
  if (li.textContent?.startsWith('FAIL')) { failures++; console.error(li.textContent); }
}
globalThis.window = globalThis;
globalThis.document = {
  getElementById(id) {
    if (!reports.has(id)) reports.set(id, { textContent:'', style:{}, append, appendChild:append });
    return reports.get(id);
  },
  createElement() { return { style:{} }; },
};
await import(new URL(suite + '.js', import.meta.url));
const deadline = Date.now() + 5000;
while (!reports.get('summary')?.textContent && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
const summary = reports.get('summary')?.textContent || 'No completed summary';
console.log(suite + ': ' + summary);
process.exit(failures || !/0 failed/.test(summary) ? 1 : 0);
