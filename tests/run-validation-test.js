// Puppeteer script to run project validation tests headlessly
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  
  // Collect console messages
  const logs = [];
  page.on('console', msg => {
    logs.push({
      type: msg.type(),
      text: msg.text()
    });
  });
  
  page.on('pageerror', err => {
    logs.push({
      type: 'error',
      text: err.message
    });
  });
  
  // Navigate to test page
  const testUrl = 'http://localhost:8000/tests/project-validation-test.html';
  console.log(`Loading ${testUrl}...`);
  await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 30000 });
  
  // Wait for results to populate
  await page.waitForSelector('#summary', { timeout: 10000 });
  
  // Extract test results
  const summary = await page.$eval('#summary', el => el.textContent);
  const passCount = await page.$$eval('#results li.pass', els => els.length);
  const failCount = await page.$$eval('#results li.fail', els => els.length);
  
  console.log('\n' + '='.repeat(60));
  console.log('PROJECT VALIDATION TEST RESULTS');
  console.log('='.repeat(60));
  console.log(summary);
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);
  console.log('='.repeat(60) + '\n');
  
  // Show failed tests if any
  if (failCount > 0) {
    const failures = await page.$$eval('#results li.fail', els => 
      els.map(el => el.textContent)
    );
    console.log('FAILED TESTS:');
    failures.forEach(f => console.log('  ' + f));
    console.log('');
  }
  
  await browser.close();
  
  // Exit with appropriate code
  process.exit(failCount > 0 ? 1 : 0);
})();
