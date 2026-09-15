// Phase 7 QA -- HR "Re-route to manager" path + duplicate-reject dedupe check, on Emp055's case.
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const consoleErrors = [];
const failedRequests = [];

async function newCtx(name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${name}] ${msg.text()}`); });
  page.on('requestfailed', (req) => failedRequests.push(`[${name}] ${req.method()} ${req.url()} -- ${req.failure()?.errorText}`));
  page.on('response', (res) => { if (res.status() >= 400) failedRequests.push(`[${name}] ${res.status()} ${res.url()}`); });
  return { ctx, page };
}

async function login(page, email, password) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('button.login-submit');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
}

const { page: hr } = await newCtx('hr');
await login(hr, 'siva@company.com', 'siva@1');
await hr.goto(BASE + '/hr/escalations', { waitUntil: 'networkidle' });
await hr.waitForTimeout(1000);

const emp055Row = hr.locator('.row', { hasText: 'Noah' });
log('Rows matching "Noah" (Emp055):', await emp055Row.count());
log('Row text BEFORE reroute:', await emp055Row.first().innerText().catch(() => '(none)'));
await hr.screenshot({ path: 'agents/.scratch/phase7/05_hr_before_reroute.png', fullPage: true });

const rerouteBtn = emp055Row.first().locator('button', { hasText: 'Re-route' });
log('Re-route button visible:', await rerouteBtn.isVisible().catch(() => false));
await rerouteBtn.click();
await hr.waitForTimeout(2000);
await hr.waitForLoadState('networkidle');
await hr.screenshot({ path: 'agents/.scratch/phase7/06_hr_after_reroute.png', fullPage: true });
log('Row text AFTER reroute:', await emp055Row.first().innerText().catch(() => '(none)'));

// Manager side: after reroute, escalation_state='open' should unblock Review/Reject again on the ORIGINAL kt task
const { page: mgr } = await newCtx('manager');
await login(mgr, 'aravidhan@company.com', 'aravidhan@');
await mgr.goto(BASE + '/manager/kt-approvals', { waitUntil: 'networkidle' });
await mgr.waitForTimeout(1000);
await mgr.screenshot({ path: 'agents/.scratch/phase7/07_manager_after_reroute.png', fullPage: true });

log('---CONSOLE ERRORS---', JSON.stringify(consoleErrors, null, 2));
log('---FAILED/4xx-5xx REQUESTS---', JSON.stringify(failedRequests, null, 2));
await browser.close();
