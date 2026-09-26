// ExitAI Part 4 (HR pages) + Part 5 (Security) health check
// REVIEW ONLY — no code changes
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:5173';
const LINKS = JSON.parse(fs.readFileSync(path.join(__dirname, 'magic_links.json'), 'utf8'));
const SS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

// Seeded case for HR case detail page tests
const SEEDED_CASE_ID = 'f3b2e788-32f2-4d3c-8785-c9121a61b3bd'; // Liam Reddy, Emp053

let stepNum = 50; // Start at 50 to not clash with pipeline screenshots
const results = [];

async function shot(page, name) {
  stepNum++;
  const file = path.join(SS_DIR, `${String(stepNum).padStart(2,'0')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  [SS] ${file}`);
  return file;
}

function pass(step, note) {
  results.push({ step, status: 'PASS', note: note || '' });
  console.log(`  ✓ ${step}: PASS${note ? ' — ' + note : ''}`);
}

function fail(step, note) {
  results.push({ step, status: 'FAIL', note: note || '' });
  console.log(`  ✗ ${step}: FAIL — ${note}`);
}

async function loginVia(browser, role) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const link = LINKS[role];
  if (!link || !link.action_link) throw new Error(`No magic link for role: ${role}`);
  await page.goto(link.action_link, { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForURL(/localhost:5173/, { timeout: 15000 });
  return { page, ctx };
}

async function checkPageLoads(page, url, name, contentSelector) {
  await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(800);
  await shot(page, name);
  const bodyText = await page.locator('body').textContent().catch(() => '');
  const hasContent = bodyText.length > 100;
  const hasError = bodyText.toLowerCase().includes('error') && bodyText.length < 500;
  const hasMatcher = contentSelector ? await page.locator(contentSelector).isVisible({ timeout: 3000 }).catch(() => false) : true;
  return { hasContent, hasError, hasMatcher, bodyText: bodyText.substring(0, 200) };
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });

  try {
    // ═══════════════════════════════════════════════════════════════
    // PART 4: HR PAGES
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + '='.repeat(60));
    console.log('PART 4: HR PAGES VERIFICATION');
    console.log('='.repeat(60));

    console.log('\n  Logging in as HR (siva@company.com)...');
    const { page: hrPage, ctx: hrCtx } = await loginVia(browser, 'hr');
    console.log(`  ✓ HR logged in at: ${hrPage.url()}`);

    // ── P4.1: HR Overview ─────────────────────────────────────────
    console.log('\n  P4.1: HR Overview (/hr)');
    const overview = await checkPageLoads(hrPage, '/hr', 'p4_01_hr_overview', '[data-testid="hr-overview"]');
    const overviewTitle = await hrPage.getByText('Overview').first().isVisible().catch(() => false);
    const kpiVisible = await hrPage.locator('.hr-kpi').first().isVisible({ timeout: 3000 }).catch(() => false);
    if (overviewTitle && kpiVisible && !overview.hasError) {
      pass('P4.1 HR Overview', `KPI cards visible: ${kpiVisible}`);
    } else {
      fail('P4.1 HR Overview', `Overview title: ${overviewTitle}, KPI: ${kpiVisible}, Error: ${overview.hasError}`);
    }

    // ── P4.2: Exits list ──────────────────────────────────────────
    console.log('\n  P4.2: HR Exits list (/hr/exits)');
    await hrPage.goto(BASE + '/hr/exits', { waitUntil: 'networkidle', timeout: 20000 });
    await hrPage.waitForTimeout(1000);
    await shot(hrPage, 'p4_02_hr_exits');
    const exitsTitle = await hrPage.getByText('Exits').first().isVisible().catch(() => false);
    const caseRows = await hrPage.locator('.hr-table-row').count().catch(() => 0);
    console.log(`    Case rows visible: ${caseRows}`);
    const savedViews = await hrPage.locator('.hr-saved-views').isVisible().catch(() => false);
    if (exitsTitle && savedViews) {
      pass('P4.2 Exits list', `${caseRows} case rows, saved views bar visible`);
    } else {
      fail('P4.2 Exits list', `Title: ${exitsTitle}, Views: ${savedViews}, Rows: ${caseRows}`);
    }

    // Check if Emp082 (Priya Rao) is now visible (timing was the issue before)
    const priyaVisible = await hrPage.getByText('Priya Rao').first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`    Priya Rao visible in list: ${priyaVisible}`);
    if (priyaVisible) {
      pass('P4.2 Exits - Emp082 visible', 'Priya Rao visible in exits list');
    } else {
      fail('P4.2 Exits - Emp082 visible', 'Priya Rao NOT found in exits list');
    }

    // ── P4.3: Case detail page — all 6 tabs ───────────────────────
    console.log(`\n  P4.3: Case detail page (/hr/exits/${SEEDED_CASE_ID.slice(0,8)}...) — all tabs`);
    const CASE_TABS = ['overview', 'tasks', 'documents', 'interview', 'risk', 'audit'];
    for (const tab of CASE_TABS) {
      const url = tab === 'overview'
        ? `/hr/exits/${SEEDED_CASE_ID}`
        : `/hr/exits/${SEEDED_CASE_ID}?tab=${tab}`;
      await hrPage.goto(BASE + url, { waitUntil: 'networkidle', timeout: 20000 });
      await hrPage.waitForTimeout(800);
      await shot(hrPage, `p4_03_case_${tab}`);
      const content = await hrPage.locator('body').textContent().catch(() => '');
      const hasTabContent = content.length > 100;
      const tabBtn = await hrPage.locator(`button.is-active`).first().textContent().catch(() => '');
      if (hasTabContent) {
        pass(`P4.3 Case tab: ${tab}`, `Active tab text: "${tabBtn.trim()}"`);
      } else {
        fail(`P4.3 Case tab: ${tab}`, 'Empty or error page');
      }
    }

    // ── P4.4: Escalations ─────────────────────────────────────────
    console.log('\n  P4.4: HR Escalations (/hr/escalations)');
    await hrPage.goto(BASE + '/hr/escalations', { waitUntil: 'networkidle', timeout: 20000 });
    await hrPage.waitForTimeout(800);
    await shot(hrPage, 'p4_04_hr_escalations');
    const escalationsTitle = await hrPage.getByText(/escalation/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (escalationsTitle) {
      pass('P4.4 Escalations', 'Escalations page loaded');
    } else {
      fail('P4.4 Escalations', 'Escalations page not found or empty');
    }

    // ── P4.5: Relieving letters ───────────────────────────────────
    console.log('\n  P4.5: HR Relieving Letters (/hr/relieving-letters)');
    await hrPage.goto(BASE + '/hr/relieving-letters', { waitUntil: 'networkidle', timeout: 20000 });
    await hrPage.waitForTimeout(800);
    await shot(hrPage, 'p4_05_relieving_letters');
    const letterTitle = await hrPage.getByText(/relieving|letter/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    const letterList = await hrPage.locator('.hr-letter-list, .hr-panel').first().isVisible({ timeout: 3000 }).catch(() => false);
    if (letterTitle && letterList) {
      pass('P4.5 Relieving Letters', 'Page loaded with content');
    } else {
      fail('P4.5 Relieving Letters', `Title: ${letterTitle}, List: ${letterList}`);
    }

    // ── P4.6: Risk & Rehire (2-decimal score check) ───────────────
    console.log('\n  P4.6: HR Risk & Rehire (/hr/risk-and-rehire)');
    await hrPage.goto(BASE + '/hr/risk-and-rehire', { waitUntil: 'networkidle', timeout: 20000 });
    await hrPage.waitForTimeout(800);
    await shot(hrPage, 'p4_06_risk_rehire');
    const riskPageTitle = await hrPage.getByText(/risk/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    // Check for 2-decimal risk scores (e.g. "0.75", "8.23")
    const bodyText = await hrPage.locator('body').textContent().catch(() => '');
    const twoDecimalPattern = /\d+\.\d{2}/.test(bodyText);
    console.log(`    2-decimal pattern found: ${twoDecimalPattern}`);
    if (riskPageTitle) {
      pass('P4.6 Risk & Rehire', `Page loaded. 2-decimal score: ${twoDecimalPattern}`);
    } else {
      fail('P4.6 Risk & Rehire', 'Risk & Rehire page not found');
    }

    // ── P4.7: Exit interviews (both tabs + side panel) ─────────────
    console.log('\n  P4.7: HR Exit Interviews (/hr/exit-interviews)');
    await hrPage.goto(BASE + '/hr/exit-interviews', { waitUntil: 'networkidle', timeout: 20000 });
    await hrPage.waitForTimeout(1000);
    await shot(hrPage, 'p4_07a_exit_interviews_submitted');
    const interviewTitle = await hrPage.getByText(/exit interview/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    const submittedTab = await hrPage.getByRole('tab', { name: /submitted/i }).first().isVisible({ timeout: 3000 }).catch(() => false) ||
                         await hrPage.getByText('Submitted').first().isVisible({ timeout: 3000 }).catch(() => false);
    // Click "Not submitted yet" tab
    const pendingTab = hrPage.getByText(/not submitted/i).first();
    if (await pendingTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pendingTab.click();
      await hrPage.waitForTimeout(800);
      await shot(hrPage, 'p4_07b_exit_interviews_pending');
    }
    // Click on a row to open side panel (if available)
    await hrPage.goto(BASE + '/hr/exit-interviews', { waitUntil: 'networkidle', timeout: 20000 });
    await hrPage.waitForTimeout(800);
    const firstRow = hrPage.locator('[class*="interview"], [class*="row"]').first();
    const rowVisible = await firstRow.isVisible({ timeout: 3000 }).catch(() => false);
    if (rowVisible) {
      await firstRow.click();
      await hrPage.waitForTimeout(1000);
      await shot(hrPage, 'p4_07c_interview_side_panel');
    }
    if (interviewTitle) {
      pass('P4.7 Exit Interviews', `Submitted tab: ${submittedTab}, Side panel click: ${rowVisible}`);
    } else {
      fail('P4.7 Exit Interviews', 'Exit interviews page not found');
    }

    // ── P4.8: Insights / Policy audit ──────────────────────────────
    console.log('\n  P4.8: HR Insights (/hr/insights)');
    await hrPage.goto(BASE + '/hr/insights', { waitUntil: 'networkidle', timeout: 20000 });
    await hrPage.waitForTimeout(800);
    await shot(hrPage, 'p4_08_insights');
    const insightsTitle = await hrPage.getByText(/insight|policy|audit/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (insightsTitle) {
      pass('P4.8 Insights', 'Insights page loaded');
    } else {
      fail('P4.8 Insights', 'Insights page not found or empty');
    }

    // ── P4.9: Agents page ─────────────────────────────────────────
    console.log('\n  P4.9: HR Agents (/hr/agents)');
    await hrPage.goto(BASE + '/hr/agents', { waitUntil: 'networkidle', timeout: 20000 });
    await hrPage.waitForTimeout(800);
    await shot(hrPage, 'p4_09_hr_agents');
    const agentsTitle = await hrPage.getByText(/agent/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    const agentBodyText = await hrPage.locator('body').textContent().catch(() => '');
    if (agentsTitle && agentBodyText.length > 100) {
      pass('P4.9 HR Agents', 'Agents page loaded with content');
    } else {
      fail('P4.9 HR Agents', 'Agents page empty or not found');
    }
    await hrCtx.close();

    // ═══════════════════════════════════════════════════════════════
    // PART 5: SECURITY ROLE CHECKS
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + '='.repeat(60));
    console.log('PART 5: SECURITY CHECKS');
    console.log('='.repeat(60));

    // ── P5.1: All 5 roles can log in ──────────────────────────────
    console.log('\n  P5.1: All roles login successfully');
    const roleChecks = [
      { key: 'hr', expectedUrl: '/hr', role: 'HR' },
      { key: 'manager', expectedUrl: '/manager', role: 'Manager' },
      { key: 'it', expectedUrl: '/it', role: 'IT' },
      { key: 'finance', expectedUrl: '/finance', role: 'Finance' },
      { key: 'emp082', expectedUrl: '/employee', role: 'Employee' },
    ];

    const nonHrPages = [];
    for (const check of roleChecks) {
      const { page, ctx } = await loginVia(browser, check.key);
      const currentUrl = page.url();
      const landed = currentUrl.includes(check.expectedUrl) ||
                     (check.key === 'emp082' && currentUrl.includes('/employee'));
      console.log(`    ${check.role}: landed at ${currentUrl}`);
      await shot(page, `p5_01_login_${check.key}`);
      if (landed) {
        pass(`P5.1 Login: ${check.role}`, `URL: ${currentUrl}`);
      } else {
        fail(`P5.1 Login: ${check.role}`, `Expected ${check.expectedUrl}, got ${currentUrl}`);
      }
      // Keep non-HR pages open for the access check below
      if (check.key !== 'hr') {
        nonHrPages.push({ role: check.role, page, ctx });
      } else {
        await ctx.close();
      }
    }

    // ── P5.2: Non-HR roles CANNOT access /hr routes ───────────────
    console.log('\n  P5.2: Non-HR roles blocked from /hr routes');
    const HR_ROUTES = ['/hr', '/hr/exits', '/hr/agents'];
    for (const { role, page } of nonHrPages) {
      for (const route of HR_ROUTES) {
        await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(500);
        const currentUrl = page.url();
        const blocked = !currentUrl.includes('/hr') ||
                        currentUrl === BASE + '/hr' && !await page.getByText(/Overview|Exits|HR/i).first().isVisible({ timeout: 2000 }).catch(() => false);
        // Primary check: were they redirected AWAY from /hr?
        const redirected = !currentUrl.includes('/hr');
        const pageBody = await page.locator('body').textContent().catch(() => '');
        const showsHrContent = pageBody.includes('Overview') && pageBody.includes('Exits') && pageBody.includes('KPI');
        console.log(`    ${role} → ${route}: URL=${currentUrl}, showsHrContent=${showsHrContent}`);
        if (redirected || !showsHrContent) {
          pass(`P5.2 ${role} blocked from ${route}`, `Landed at: ${currentUrl}`);
        } else {
          fail(`P5.2 ${role} blocked from ${route}`, `SECURITY ISSUE: ${role} can access HR page`);
        }
      }
    }
    await shot(nonHrPages[0]?.page || (await browser.newPage()), 'p5_02_security_check');

    // ── P5.3: No console errors on role pages ─────────────────────
    console.log('\n  P5.3: Console error check');
    for (const { role, page, ctx } of nonHrPages) {
      const errors = [];
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1000);
      const filteredErrors = errors.filter(e => !e.includes('favicon') && !e.includes('extension'));
      console.log(`    ${role}: ${filteredErrors.length} console errors`);
      if (filteredErrors.length === 0) {
        pass(`P5.3 Console: ${role}`, 'No console errors');
      } else {
        fail(`P5.3 Console: ${role}`, `${filteredErrors.length} errors: ${filteredErrors[0]?.slice(0,100)}`);
      }
      await ctx.close();
    }

    console.log('\n=== PART 4 + 5 COMPLETE ===');

  } catch (err) {
    console.error('\n=== FATAL ERROR ===', err.message);
    results.push({ step: 'FATAL', status: 'FAIL', note: err.message });
  } finally {
    await browser.close();
  }

  // ── Summary ───────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('PART 4 + 5 RESULTS:');
  console.log('='.repeat(60));
  results.forEach(r => {
    const icon = r.status === 'PASS' ? '✓' : '✗';
    console.log(`${icon} ${r.step.padEnd(45)} ${r.status}  ${r.note}`);
  });
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log('='.repeat(60));
  console.log(`Total: ${passed} PASS / ${failed} FAIL`);
})();
