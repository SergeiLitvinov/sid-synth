// Compatibility adapter for the old journey's three page operations.
// Only trusted repository test callbacks run in the same-origin test iframe.
import journey from './integration.js';

const frame = document.createElement('iframe');
frame.style.cssText = 'width:1400px;height:900px';
document.body.appendChild(frame);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function reload() {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Application load timeout')), 15000);
    frame.onload = () => { clearTimeout(timer); resolve(); };
    frame.src = '../index.html?integration=' + Date.now();
  });
  for (let i = 0; i < 150; i++) {
    if (frame.contentDocument.querySelector('#inpRec')) return;
    await wait(100);
  }
  throw new Error('Application bootstrap timeout');
}
try {
  await reload();
  const result = await journey({
    reload, waitForTimeout: wait,
    evaluate: fn => frame.contentWindow.Function('return (' + fn.toString() + ')()')(),
  });
  let failed = 0;
  for (const step of result.steps) {
    const li = document.createElement('li');
    li.textContent = (step.ok ? 'PASS ' : 'FAIL ') + step.name;
    document.getElementById('results').append(li);
    if (!step.ok) failed++;
  }
  document.getElementById('summary').textContent = `${result.steps.length - failed} passed, ${failed} failed`;
} catch (error) {
  const li = document.createElement('li');
  li.textContent = 'FAIL legacy journey: ' + error.message;
  document.getElementById('results').append(li);
  document.getElementById('summary').textContent = '0 passed, 1 failed';
} finally { frame.remove(); }
