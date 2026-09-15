// Phase 7 QA -- real Playwright browser test, disposable case only (Emp060 / Ishaan Reddy).
// Manager rejects a KT task -> escalation appears on HR dashboard -> HR resolves it.
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const consoleErrors = [];
const failedRequests = [];

async function newCtx(name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${name}] ${msg.text()}`);
  });
  page.on('requestfailed', (req) => {
    failedRequests.push(`[${name}] ${req.method()} ${req.url()} -- ${req.failure()?.errorText}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`[${name}] ${res.status()} ${res.url()}`);
  });
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

// --- Manager: reject Ishaan Reddy's manager-stage KT task ---
const { page: mgr } = await newCtx('manager');
await login(mgr, 'aravidhan@company.com', 'aravidhan@');
log('MANAGER URL after login:', mgr.url());
await mgr.goto(BASE + '/manager/kt-approvals', { waitUntil: 'networkidle' });
await mgr.waitForTimeout(1000);

const headerXPath = `//div[@data-group-header="true"][.//p[contains(text(),"Ishaan Reddy")]]`;
const header = mgr.locator(`xpath=${headerXPath}`);
log('Header rows found for "Ishaan Reddy":', await header.count());

const taskRow = mgr.locator(`xpath=${headerXPath}/following-sibling::div[contains(@class,"row--split")][1]`);
log('Task row text:', await taskRow.innerText().catch((e) => `(error: ${e.message})`));

await mgr.screenshot({ path: 'agents/.scratch/phase7/01_manager_kt_before.png', fullPage: true });

const rejectBtn = taskRow.locator('button', { hasText: 'Reject' });
log('Reject button visible:', await rejectBtn.isVisible().catch(() => false));

mgr.once('dialog', async (dialog) => {
  log('DIALOG:', dialog.message());
  await dialog.accept('Phase 7 QA: KT handover missing payments vendor integration details');
});
await rejectBtn.click();
await mgr.waitForTimeout(2500);
await mgr.waitForLoadState('networkidle');
await mgr.screenshot({ path: 'agents/.scratch/phase7/02_manager_kt_after_reject.png', fullPage: true });

const afterTaskRow = mgr.locator(`xpath=${headerXPath}/following-sibling::div[contains(@class,"row--split")][1]`);
log('Task row text AFTER reject:', await afterTaskRow.innerText().catch((e) => `(error: ${e.message})`));
const escalatedTag = afterTaskRow.locator('text=Escalated to HR');
log('Manager dashboard shows "Escalated to HR" after reject:', await escalatedTag.count() > 0);

// --- HR: see + resolve the escalation ---
const { page: hr } = await newCtx('hr');
await login(hr, 'siva@company.com', 'siva@1');
log('HR URL after login:', hr.url());
await hr.goto(BASE + '/hr/escalations', { waitUntil: 'networkidle' });
await hr.waitForTimeout(1000);
await hr.screenshot({ path: 'agents/.scratch/phase7/03_hr_escalations_before.png', fullPage: true });

const hrRow = hr.locator('.row', { hasText: 'Ishaan Reddy' });
log('HR escalation row count for Ishaan Reddy:', await hrRow.count());
log('HR escalation row text:', await hrRow.first().innerText().catch(() => '(none)'));

const resolveBtn = hrRow.first().locator('button', { hasText: 'Resolve' });
await resolveBtn.click();
await hr.waitForTimeout(2000);
await hr.waitForLoadState('networkidle');
await hr.screenshot({ path: 'agents/.scratch/phase7/04_hr_escalations_after_resolve.png', fullPage: true });

const resolvedTag = hr.locator('.row', { hasText: 'Ishaan Reddy' }).locator('text=Resolved');
log('HR row shows "Resolved" after click:', await resolvedTag.count() > 0);
log('HR row text AFTER resolve:', await hrRow.first().innerText().catch(() => '(none)'));

log('---CONSOLE ERRORS---', JSON.stringify(consoleErrors, null, 2));
log('---FAILED/4xx-5xx REQUESTS---', JSON.stringify(failedRequests, null, 2));

await browser.close();
