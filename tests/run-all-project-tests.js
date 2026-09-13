// Puppeteer script to run all project tests headlessly
import puppeteer from 'puppeteer';

async function runTest(testUrl, testName) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  
  // Navigate to test page
  console.log(`Loading ${testName}...`);
  await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 30000 });
  
  // Wait for results to populate
  await page.waitForSelector('#summary', { timeout: 10000 });
  
  // Extract test results
  const summary = await page.$eval('#summary', el => el.textContent);
  const passCount = await page.$$eval('#results li.pass, #results li[class*="pass"]', els => els.length);
  const failCount = await page.$$eval('#results li.fail, #results li[class*="fail"]', els => els.length);
  
  await browser.close();
  
  return { summary, passCount, failCount };
}

(async () => {
  const baseUrl = 'http://localhost:8000/tests/';
  
  const tests = [
    { url: baseUrl + 'project-validation-test.html', name: 'Project Validation Tests' },
    { url: baseUrl + 'project-test.html', name: 'Project Serialization Tests' },
  ];
  
  let totalPass = 0;
  let totalFail = 0;
  
  console.log('\n' + '='.repeat(70));
  console.log('RUNNING ALL PROJECT TESTS');
  console.log('='.repeat(70) + '\n');
  
  for (const test of tests) {
    try {
      const result = await runTest(test.url, test.name);
      console.log(`${test.name}:`);
      console.log(`  ${result.summary}`);
      console.log(`  Passed: ${result.passCount}, Failed: ${result.failCount}\n`);
      totalPass += result.passCount;
      totalFail += result.failCount;
    } catch (err) {
      console.log(`${test.name}: ERROR - ${err.message}\n`);
      totalFail++;
    }
  }
  
  console.log('='.repeat(70));
  console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed`);
  console.log('='.repeat(70) + '\n');
  
  process.exit(totalFail > 0 ? 1 : 0);
})();
