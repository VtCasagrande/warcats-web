import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// All authentication and admin requests are intercepted. This test sends no emails.
const base = process.env.TEST_URL || 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [], pageErrors = [];
const check = (condition, label) => { assert.ok(condition, label); results.push(label); console.log('PASS', label); };
const account = { id: 'qa-operator-id', username: 'qa_operator', displayName: 'Operador QA', email: 'operator@example.test', role: 'player', cash: 8400, kills: 18, deaths: 6, wins: 3, rounds: 7, objectiveSeconds: 382, createdAt: '2026-09-15T12:00:00Z' };
await mkdir('artifacts', { recursive: true });
async function fixture(page, provider = 'supabase', initialAccount = null) {
  const state = { account: initialAccount, loginRole: 'player', registerCalls: 0, recoveryCalls: 0, passwordCalls: 0, deniedAdmin: false, adminCalls: 0, completeCalls: 0, resendCalls: 0 };
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/auth/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/').at(-1);
    const body = route.request().postDataJSON();
    let data = { account: state.account, provider }, status = 200;
    if (path === 'register') {
      state.registerCalls++;
      if (provider === 'local') { assert.equal(body.username, 'legacy_qa'); state.account = { ...account, email: undefined }; data.account = state.account; }
      else { assert.equal(body.email, account.email); data = { account: null, provider, requiresConfirmation: true, message: 'Abra o link recebido por email para confirmar sua conta.' }; }
    } else if (path === 'login') {
      assert.ok(body[provider === 'supabase' ? 'email' : 'username']);
      state.account = { ...account, role: state.loginRole }; data.account = state.account;
    } else if (path === 'logout') { state.account = null; data.account = null; }
    else if (path === 'verify') {
      if (body.token !== '12345678') { status = 400; data.error = 'Código inválido ou expirado. Confira o código mais recente.'; }
      else if (body.type === 'recovery') data = { account: null, provider, recoveryToken: 'qa-ephemeral-token', requiresPassword: true };
      else { state.account = { ...account }; data.account = state.account; }
    } else if (path === 'recover') { state.recoveryCalls++; data = { account: null, provider, message: 'Se houver uma conta para este email, você receberá um link de recuperação.' }; }
    else if (path === 'password') { state.passwordCalls++; assert.equal(body.recoveryToken, 'qa-ephemeral-token'); assert.ok(body.password.length >= 8); state.account = { ...account }; data.account = state.account; }
    else if (path === 'resend') { state.resendCalls++; data = { account: null, provider, requiresConfirmation: true, message: 'Se a conta aguarda confirmação, você receberá um link por email.' }; }
    else if (path === 'complete') { state.completeCalls++; assert.equal(new URL(page.url()).hash, ''); assert.equal(body.accessToken, 'qa-access-token'); assert.equal(body.refreshToken, undefined); if (body.type === 'recovery') data = { account: null, provider, recoveryToken: 'qa-ephemeral-token', requiresPassword: true }; else { state.account = { ...account }; data.account = state.account; } }
    else if (path !== 'me') throw new Error(`Unexpected intercepted auth endpoint ${path}`);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.route('**/api/admin/overview', async route => {
    state.adminCalls++;
    const overview = { accounts: 2, totalCash: 18050, matchesPlayed: 14, operators: [{ id: account.id, username: account.username, display_name: account.displayName, cash: 8400, kills: 18, wins: 3, role: 'admin' }, { id: 'qa-b', username: 'lynx', display_name: '<img src=x onerror=alert(1)>', cash: 9650, kills: 12, wins: 2, role: 'player' }], results: [{ account_id: account.id, display_name: account.displayName, match_id: 'nordhaven-qa-20260915', won: true, created_at: '2026-09-15T15:21:00Z' }] };
    await route.fulfill({ status: state.deniedAdmin ? 403 : 200, contentType: 'application/json', body: JSON.stringify(state.deniedAdmin ? { error: 'Acesso reservado a administradores.' } : overview) });
  });
  return state;
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const state = await fixture(page);
  await page.goto(base); await page.waitForFunction(() => !document.getElementById('loading'));
  await page.locator('#account-button').click(); await page.waitForSelector('#account-email');
  check(await page.locator('#account-email').getAttribute('type') === 'email', 'Supabase login uses a native email field');
  await page.locator('#account-switch').click(); await page.fill('#account-email', 'invalid-email'); await page.fill('#account-password', 'ValidTestPassword123!'); await page.locator('#account-submit').click();
  check(state.registerCalls === 0, 'Invalid email is blocked before an API request');
  await page.fill('#account-email', account.email); await page.fill('#account-display-name', account.displayName); await page.locator('#account-submit').click();
  await page.waitForSelector('#account-use-code');
  check(await page.locator('.auth-email-notice').innerText().then(text => text.includes('ABRA O LINK')), 'Email confirmation primarily instructs the native link flow');
  check(await page.locator('#account-resend').isDisabled() && state.resendCalls === 0, 'Confirmation resend is explicit and respects a 60-second cooldown');
  await page.locator('#account-use-code').focus(); await page.keyboard.press('Tab'); check(await page.locator('#account-close').evaluate(el => el === document.activeElement), 'Focus wraps inside the modal while the optional OTP form is hidden');
  await page.evaluate(() => { window.__qaOriginalDateNow = Date.now; Date.now = () => window.__qaOriginalDateNow() + 61000; }); await page.waitForFunction(() => !document.getElementById('account-resend').disabled); await page.locator('#account-resend').click(); await page.waitForFunction(() => document.getElementById('account-resend').disabled); check(state.resendCalls === 1, 'Resending a confirmation link requires a new explicit action after cooldown'); await page.evaluate(() => { Date.now = window.__qaOriginalDateNow; delete window.__qaOriginalDateNow; });
  await page.locator('#account-use-code').click();
  check(await page.locator('#account-title').innerText() === 'CONFIRME SEU EMAIL.', 'Signup requiring confirmation stays on the verification screen');
  check(await page.locator('.account-balance').count() === 0 && !(await page.locator('#account-wallet').isVisible()), 'Unconfirmed signup does not claim a connected wallet');
  check(await page.locator('#account-code').getAttribute('maxlength') === '8' && await page.locator('#account-code').getAttribute('autocomplete') === 'one-time-code', 'OTP matches eight-digit project settings and supports autofill');
  await page.waitForTimeout(220); await page.screenshot({ path: 'artifacts/account-supabase-confirm.png' });
  await page.fill('#account-code', '00000000'); await page.locator('#account-verify').click(); await page.waitForSelector('#account-error:not([hidden])');
  check((await page.locator('#account-error').innerText()).includes('Código inválido'), 'Invalid OTP shows an actionable error without leaving the form');
  await page.fill('#account-code', '12345678'); await page.locator('#account-verify').click(); await page.waitForSelector('.account-balance');
  check(await page.locator('#account-admin').count() === 0, 'A player account has no admin action');
  await page.locator('#account-logout').click(); await page.waitForSelector('#account-forgot'); await page.locator('#account-forgot').click(); await page.fill('#account-email', account.email); await page.locator('#account-recover').click(); await page.waitForSelector('#account-use-code'); await page.locator('#account-use-code').click();
  check(state.recoveryCalls === 1, 'Recovery is requested only by an explicit form submission');
  await page.fill('#account-code', '12345678'); await page.locator('#account-verify').click(); await page.waitForSelector('#account-new-password');
  check(await page.locator('.account-balance').count() === 0, 'Recovery verification does not expose a logged-in account before password update');
  check(await page.evaluate(() => !JSON.stringify([localStorage, sessionStorage]).includes('qa-ephemeral-token')), 'Recovery token stays out of browser storage');
  await page.fill('#account-new-password', 'ChangedTestPassword123!'); await page.fill('#account-confirm-password', 'DifferentTestPassword123!'); await page.locator('#account-save-password').click();
  check(state.passwordCalls === 0 && (await page.locator('#account-error').innerText()).includes('iguais'), 'Password confirmation is checked before submitting');
  await page.fill('#account-confirm-password', 'ChangedTestPassword123!'); await page.locator('#account-save-password').click(); await page.waitForSelector('.account-balance');
  check(state.passwordCalls === 1, 'Verified recovery updates the password exactly once');
  await page.locator('#account-logout').click(); await page.waitForSelector('#account-password'); state.loginRole = 'admin'; await page.fill('#account-email', account.email); await page.fill('#account-password', 'ValidTestPassword123!'); await page.locator('#account-submit').click(); await page.waitForSelector('#account-admin'); await page.locator('#account-admin').click(); await page.waitForSelector('.admin-table');
  check((await page.locator('.admin-metrics').innerText()).includes('18.050'), 'Admin overview shows the server-provided economy totals');
  check(await page.locator('.admin-table img').count() === 0, 'Operator-provided names are escaped in admin tables');
  await page.waitForTimeout(220); await page.screenshot({ path: 'artifacts/account-admin-desktop.png' });
  state.deniedAdmin = true; await page.locator('#admin-refresh').click(); await page.waitForSelector('#admin-retry');
  check((await page.locator('#admin-content').innerText()).includes('Acesso reservado'), 'Server denial replaces admin data with a clear error');
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await fixture(mobile, 'supabase', { ...account, role: 'admin' }); await mobile.goto(base); await mobile.waitForFunction(() => !document.getElementById('loading')); await mobile.locator('#account-button').click(); await mobile.waitForSelector('#account-admin'); await mobile.locator('#account-admin').click(); await mobile.waitForSelector('.admin-table'); await mobile.waitForTimeout(220); await mobile.screenshot({ path: 'artifacts/account-admin-mobile.png' });
  check(await mobile.locator('.admin-dialog').evaluate(el => el.getBoundingClientRect().right <= innerWidth), 'Admin dialog fits a 390px screen with scrollable data tables');
  const legacy = await browser.newPage({ viewport: { width: 1200, height: 800 } }); const legacyState = await fixture(legacy, 'local'); await legacy.goto(base); await legacy.waitForFunction(() => !document.getElementById('loading')); await legacy.locator('#account-button').click(); await legacy.locator('#account-switch').click(); await legacy.fill('#account-username', 'legacy_qa'); await legacy.fill('#account-password', 'ValidTestPassword123!'); await legacy.locator('#account-submit').click(); await legacy.waitForSelector('.account-balance');
  check(legacyState.registerCalls === 1, 'The local provider retains its username registration flow');
  const callback = await browser.newPage({ viewport: { width: 1200, height: 800 } }); const callbackState = await fixture(callback); await callback.goto(`${base}/?room=ABCDEF#access_token=qa-access-token&refresh_token=qa-refresh-token&type=signup`); await callback.waitForSelector('.account-balance');
  check(callbackState.completeCalls === 1 && new URL(callback.url()).hash === '' && new URL(callback.url()).search === '?room=ABCDEF', 'Native signup link clears both URL tokens before completing authentication and preserves the room');
  check(await callback.evaluate(() => !JSON.stringify([localStorage, sessionStorage]).includes('qa-access-token') && !JSON.stringify([localStorage, sessionStorage]).includes('qa-refresh-token')), 'Native link access and refresh tokens are never stored in the browser');
  const recoveryLink = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const recoveryLinkState = await fixture(recoveryLink); await recoveryLink.goto(`${base}/#access_token=qa-access-token&refresh_token=qa-refresh-token&type=recovery`); await recoveryLink.waitForSelector('#account-new-password'); await recoveryLink.waitForFunction(() => !document.getElementById('loading'));
  check(recoveryLinkState.completeCalls === 1 && new URL(recoveryLink.url()).hash === '', 'Native recovery link leads directly to a new password after token verification');
  await recoveryLink.screenshot({ path: 'artifacts/account-recovery-link-mobile.png' });
  const expired = await browser.newPage(); const expiredState = await fixture(expired); await expired.goto(`${base}/#error=access_denied&error_code=otp_expired&type=recovery`); await expired.waitForSelector('#account-error:not([hidden])');
  check(expiredState.completeCalls === 0 && new URL(expired.url()).hash === '' && (await expired.locator('#account-error').innerText()).includes('expirou'), 'Expired native links show recovery guidance and leave no hash behind');
  check(pageErrors.length === 0, 'All account and admin flows are free of application page errors');
  await writeFile('artifacts/account-ui-report.json', JSON.stringify({ results, pageErrors, delivery: 'All auth/admin endpoints intercepted; no real emails or account mutations.' }, null, 2));
} finally { await browser.close(); }
