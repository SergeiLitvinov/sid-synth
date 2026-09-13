import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`[${msg.type()}] ${msg.text()}`);
  });
  
  page.on('pageerror', err => {
    console.log(`PAGE ERROR: ${err.message}`);
  });
  
  const testUrl = 'http://localhost:8000/tests/project-test.html';
  console.log(`Loading ${testUrl}...`);
  await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 30000 });
  
  // Wait for results to populate
  await page.waitForSelector('#summary', { timeout: 10000 });
  
  // Get all result items
  const results = await page.$$eval('#results li', els => 
    els.map(el => ({
      className: el.className,
      text: el.textContent
    }))
  );
  
  console.log('\n=== TEST RESULTS ===');
  results.forEach(r => {
    console.log(`${r.className}: ${r.text.substring(0, 100)}`);
  });
  
  const summary = await page.$eval('#summary', el => el.textContent);
  console.log('\nSummary:', summary);
  
  await browser.close();
})();
