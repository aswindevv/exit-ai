const { chromium } = require('playwright')
const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const src = path.resolve(__dirname, 'ExitAI_Project_Documentation.html')
  const out = path.resolve(__dirname, 'ExitAI_Project_Documentation.pdf')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(pathToFileURL(src).href, { waitUntil: 'load' })
  await page.pdf({
    path: out,
    preferCSSPageSize: true, // required for the named landscape page rule
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate:
      '<div style="font-size:7pt;color:#8a90a0;width:100%;padding:0 12mm;font-family:Segoe UI,Arial">ExitAI &mdash; Project Documentation</div>',
    footerTemplate:
      '<div style="font-size:7pt;color:#8a90a0;width:100%;padding:0 12mm;font-family:Segoe UI,Arial;display:flex;justify-content:space-between">' +
      '<span>Generated from the repository, 17 Sep 2026</span>' +
      '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
  })
  await browser.close()
  console.log('PDF written:', out)
})()
