import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const config = 'tests/security/wrangler.json';
const stateDir = await mkdtemp(`${tmpdir()}/learn-mcp-security-`);
let origin;
let probe;
let runtimeLogs = '';
let runtime;
let count = 0;
const passed = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sensitive = ['fixture-ta', 'fixture-alice', 'fixture-bob', 'fixture-bob-new', 'fixture-alice-ems', 'fixture-legacy', 'fixture-legacy-bearer'];
const safe = value => { const text = typeof value === 'string' ? value : JSON.stringify(value); for (const secret of sensitive) assert.ok(!text.includes(secret), 'Response disclosed a fixture credential'); assert.ok(!/https?:[^\s"<>]*\/pluginfile\.php/i.test(text), 'Response disclosed an authenticated Moodle URL'); };
const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
async function request(path, options = {}) {
  const response = await fetch(new URL(path, origin), { redirect: 'manual', ...options });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { response, status: response.status, data, text };
}
const post = (path, values, headers = {}) => request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(values) });
const fixture = async (action, values = {}) => {
  const result = await request('/__fixture/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...values }) });
  assert.equal(result.status, 200, 'Local fixture control failed'); return result.data;
};
const rpc = (token, method, params = {}) => request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++count, method, params }) });
const call = (token, name, args = {}) => rpc(token, 'tools/call', { name, arguments: args });
const textOf = result => result.data?.result?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
const inputValue = (html, name) => html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];
let clientId;
let bobMoodleToken = "fixture-bob";
const callback = 'http://localhost:54321/callback';
async function consent(user = 'alice', overrides = {}, cookieMode = 'normal', linkEms = false) {
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', scope: 'stemlearn:read offline_access', state: 'fixture-client-state', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${origin}/mcp`, ...overrides });
  const authorize = await request(`/authorize?${params}`);
  if (authorize.status !== 200) return { failure: authorize, verifier };
  const sessionId = inputValue(authorize.text, 'sessionId');
  const passport = authorize.text.match(/passport=([a-f0-9]+)/)?.[1];
  assert.ok(sessionId && passport, 'Authorization linking form not found');
  async function link(siteId, base, token) {
    const siteHash = createHash('md5').update(base + passport).digest('hex');
    const connectionLink = `moodlemobile://token=${Buffer.from(`${siteHash}:::${token}`).toString('base64')}`;
    const linked = await post('/authorize/link', { sessionId, siteId, connectionLink });
    assert.equal(linked.status, 200, 'Fixture account linking failed');
    assert.ok(linked.text.includes('>Reconnect</button>'), 'Saved site lacks reconnect action');
    assert.ok(linked.text.includes(`id="panel-${siteId}"`), 'Saved site lacks replacement dialog');
  }
  await link('stemlearn', 'https://stemlearn.sun.ac.za', user === 'ta' ? 'fixture-ta' : user === 'bob' ? bobMoodleToken : 'fixture-alice');
  if (linkEms) await link('emslearn', 'https://emslearn.sun.ac.za', 'fixture-alice-ems');
  const page = await post('/authorize/continue', { sessionId });
  assert.equal(page.status, 200, 'Consent page failed');
  const handle = inputValue(page.text, 'handle');
  assert.ok(handle, 'Consent handle missing');
  const cookie = page.response.headers.get('set-cookie')?.split(';')[0];
  const form = new URLSearchParams({ sessionId, handle, decision: 'approve' });
  form.append('scope', 'stemlearn:read'); form.append('scope', 'offline_access');
  const submitted = await request('/authorize/consent', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookieMode === 'normal' && cookie ? { cookie } : {}) }, body: form });
  if (cookieMode !== 'normal') return { failure: submitted };
  assert.equal(submitted.status, 302, 'Consent submission failed');
  const redirect = new URL(submitted.response.headers.get('location'));
  assert.equal(redirect.searchParams.get('state'), 'fixture-client-state', 'Client state was not returned unchanged');
  return { code: redirect.searchParams.get('code'), verifier, consentCookie: cookie, consentForm: form };
}
const exchange = (grant, overrides = {}) => post('/oauth/token', { grant_type: 'authorization_code', client_id: clientId, redirect_uri: callback, code: grant.code, code_verifier: grant.verifier, resource: `${origin}/mcp`, ...overrides });
async function login(user = 'alice', linkEms = false) {
  const grant = await consent(user, {}, 'normal', linkEms);
  assert.ok(grant.code, 'No authorization code');
  const token = await exchange(grant);
  assert.equal(token.status, 200, 'Valid PKCE exchange failed');
  assert.ok(token.data.access_token && token.data.refresh_token, 'Tokens missing');
  sensitive.push(token.data.access_token, token.data.refresh_token, grant.code);
  return { ...token.data, grant };
}
try {
  probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  origin = `http://localhost:${port}`;
  const migration = spawnSync('node_modules/.bin/wrangler', ['d1', 'migrations', 'apply', 'security-fixture-db', '--local', '--config', config, '--persist-to', stateDir], { encoding: 'utf8', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
  assert.equal(migration.status, 0, 'Local D1 migrations failed');
  runtime = spawn('node_modules/.bin/wrangler', ['dev', '--local', '--config', config, '--port', String(port), '--persist-to', stateDir], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  runtime.stdout.on('data', chunk => { runtimeLogs += chunk; });
  runtime.stderr.on('data', chunk => { runtimeLogs += chunk; });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { const r = await request('/.well-known/oauth-authorization-server'); if (r.status === 200) { ready = true; break; } } catch {} await sleep(100); }
  assert.ok(ready, 'Local workerd did not start');
  const registration = await request('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Security fixture', redirect_uris: [callback], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  assert.equal(registration.status, 201); clientId = registration.data.client_id;
  pass('real provider discovery and public-client registration');
  for (const [name, bearer] of [['unauthenticated', undefined], ['invalid bearer', 'invalid-fixture-bearer']]) { const r = await rpc(bearer, 'tools/list'); assert.equal(r.status, 401); safe(r.text); pass(`${name} /mcp rejected`); }
  const noPkce = await consent('alice', { code_challenge: '', code_challenge_method: '' }); assert.ok(noPkce.failure && [400, 302].includes(noPkce.failure.status)); if (noPkce.failure.status === 302) assert.equal(new URL(noPkce.failure.response.headers.get('location')).searchParams.get('error'), 'invalid_request'); pass('missing public-client PKCE challenge rejected');
  const plain = await consent('alice', { code_challenge_method: 'plain' }); assert.ok(plain.failure && [400, 302].includes(plain.failure.status)); if (plain.failure.status === 302) assert.equal(new URL(plain.failure.response.headers.get('location')).searchParams.get('error'), 'invalid_request'); pass('plain PKCE rejected');
  const badRedirect = await consent('alice', { redirect_uri: 'https://unregistered.invalid/callback' }); assert.equal(badRedirect.failure?.status, 400); pass('unregistered authorization redirect rejected');
  const unbound = await consent('alice', {}, 'missing'); assert.equal(unbound.failure?.status, 400); pass('consent missing browser-binding cookie rejected');
  for (const [name, verifier] of [['missing', ''], ['wrong', 'x'.repeat(43)]]) { const grant = await consent(); const r = await exchange(grant, { code_verifier: verifier }); assert.equal(r.status, 400); assert.equal(r.data.error, name === 'missing' ? 'invalid_request' : 'invalid_grant'); pass(`${name} PKCE verifier rejected at actual token endpoint`); }
  const redirectGrant = await consent(); const redirectToken = await exchange(redirectGrant, { redirect_uri: 'http://localhost:54321/other' }); assert.equal(redirectToken.status, 400); pass('token-exchange redirect mismatch rejected');
  const resourceGrant = await consent(); const wrongResource = await exchange(resourceGrant, { resource: 'https://wrong-resource.invalid/mcp' }); assert.equal(wrongResource.status, 400); pass('token-exchange wrong resource rejected');
  const replayIdentity = await login('alice'); const replayToken = await exchange(replayIdentity.grant); assert.equal(replayToken.status, 400); const replayAccess = await rpc(replayIdentity.access_token, 'tools/list'); assert.equal(replayAccess.status, 401); pass('authorization-code replay rejected and its grant revoked');
  const alice = await login('alice', true); const bob = await login('bob');
  let r = await rpc(alice.access_token, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Security fixture', version: '1' } }); assert.equal(r.status, 200); assert.ok(r.data.result?.serverInfo); safe(r.text); pass('genuine PKCE token authenticates real remote MCP transport');
  r = await request('/authorize/consent', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: alice.grant.consentCookie }, body: alice.grant.consentForm }); assert.equal(r.status, 400); pass('consent-handle replay rejected');
  const aCourses = await call(alice.access_token, 'moodle_list_courses'); const bCourses = await call(bob.access_token, 'moodle_list_courses'); safe(aCourses.text); safe(bCourses.text);
  assert.ok(textOf(aCourses).includes('Alice course') && textOf(aCourses).includes('Alice EMS course')); assert.ok(textOf(bCourses).includes('Bob course')); assert.ok(!textOf(bCourses).includes('Alice course')); pass('actual authenticated cross-user and linked-site course isolation');
  const emsRef = textOf(aCourses).split('\n').find(line => line.includes('Alice EMS course')).match(/ID: `([^`]+)`/)[1];
  r = await call(bob.access_token, 'moodle_get_course', { courseId: emsRef }); assert.equal(r.data.result?.isError, true); safe(r.text); pass('cross-user secondary-site course reference rejected');
  const files = await call(alice.access_token, 'moodle_list_resources', { courseId: 1 }); const fileId = textOf(files).match(/fileId: `([^`]+)`/)[1]; safe(files.text);
  r = await call(alice.access_token, 'moodle_download_file', { fileId }); assert.ok(textOf(r).includes('fixture notes')); safe(r.text); pass('authorized file retrieved through real transport');
  const emsFiles = await call(alice.access_token, 'moodle_list_resources', { courseId: emsRef }); const emsFileId = textOf(emsFiles).match(/fileId: `([^`]+)`/)[1];
  r = await call(alice.access_token, 'moodle_download_file', { fileId: emsFileId }); assert.ok(textOf(r).includes('fixture notes')); pass('secondary-site file uses owning linked site');
  for (const [name, id, token] of [['cross-account', fileId, bob.access_token], ['tampered', fileId.slice(0, -2) + 'AA', alice.access_token], ['malformed', 'not-a-file-handle', alice.access_token], ['expired', (await fixture('expired-file')).fileId, alice.access_token]]) { r = await call(token, 'moodle_download_file', { fileId: id }); assert.equal(r.data.result?.isError, true); safe(r.text); pass(`${name} file handle rejected`); }
  await fixture('access', { value: 'deny' }); r = await call(alice.access_token, 'moodle_download_file', { fileId }); assert.equal(r.data.result?.isError, true); await fixture('access', { value: 'allow' }); pass('current upstream course permission revocation denies existing handle');
  for (const value of ['https://untrusted.invalid/pluginfile.php/x', 'http://stemlearn.sun.ac.za/pluginfile.php/x', 'https://stemlearn.sun.ac.za/pluginfile.php.evil/x']) { const id = (await fixture('unsafe-file', { value })).fileId; r = await call(alice.access_token, 'moodle_download_file', { fileId: id }); assert.equal(r.data.result?.isError, true); safe(r.text); } pass('host/protocol/path file allowlists enforced in workerd');
  r = await call(alice.access_token, 'moodle_get_course', { courseId: 1 }); safe(r.text); assert.ok(!textOf(r).includes('pluginfile.php')); pass('authenticated authored links redacted through real transport');
  await fixture('mode', { value: 'file-redirect' }); r = await call(alice.access_token, 'moodle_download_file', { fileId }); assert.equal(r.data.result?.isError, true); safe(r.text); await fixture('mode'); pass('file redirects refused without credential forwarding');
  await fixture('mode', { value: 'oversize' }); r = await call(alice.access_token, 'moodle_download_file', { fileId }); assert.equal(r.data.result?.isError, true); assert.ok(/too large|limit/i.test(textOf(r))); safe(r.text); await fixture('mode'); pass('streaming oversized file rejected in workerd');
  await fixture('mode', { value: 'redirect' }); r = await call(alice.access_token, 'moodle_list_courses'); assert.equal(r.status, 502); safe(r.text); await fixture('mode'); pass('credential-bearing API redirect refused in workerd');
  await fixture('mode', { value: 'stall' }); r = await call(alice.access_token, 'moodle_list_courses'); assert.equal(r.status, 502); assert.equal(r.data.code, 'moodle_timeout'); safe(r.text); await fixture('mode'); pass('stalled JSON body bounded by workerd deadline');
  assert.equal((await fixture('cancel')).cancelled, true); pass('active file transfer cancellation in workerd');
  r = await request('/mcp', { method: 'POST', headers: { authorization: `Bearer ${alice.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{bad' }); assert.equal(r.status, 400); assert.equal(r.data.error?.code, -32700); safe(r.text); pass('malformed JSON safely rejected before Moodle');
  r = await call(alice.access_token, 'moodle_list_assignment_submissions', { courseId: 1, assignmentId: 20 }); assert.equal(r.data.result?.isError, true); safe(r.text); pass('unconstrained TA submission lookup rejected');
  r = await call(alice.access_token, 'moodle_list_assignment_submissions', { courseId: 1, assignmentId: 20, group: 7 }); assert.equal(r.data.result?.isError, true); assert.match(textOf(r), /grading access/i); safe(r.text); pass('upstream grading permission denial enforced through actual authenticated transport');
  await fixture('mode', { value: 'upstream-error' }); r = await call(alice.access_token, 'moodle_list_courses'); assert.equal(r.status, 200); assert.equal(r.data.result?.isError, true); assert.match(textOf(r), /Reconnect/); safe(r.text); await fixture('mode'); pass('upstream private error text sanitized');
  await fixture('audience', { value: 'https://wrong-resource.invalid/mcp' }); r = await rpc(alice.access_token, 'tools/list'); assert.equal(r.status, 401); await fixture('audience'); pass('actual stored token with wrong audience rejected');
  const ta = await login('ta');
  r = await call(ta.access_token, 'moodle_list_assignment_submissions', { courseId: 1, assignmentId: 20, group: 8 }); assert.equal(r.data.result?.isError, true); safe(r.text); pass('grader group filter constrained to assignment allowed groups');
  r = await call(ta.access_token, 'moodle_list_assignment_submissions', { courseId: 1, assignmentId: 20, group: 7, studentNumbers: ['00102'] }); assert.ok(!textOf(r).includes('Hidden Bob')); assert.ok(!textOf(r).includes('fileId:')); safe(r.text); pass('exact student lookup cannot escape visible assignment roster');
  r = await call(ta.access_token, 'moodle_list_assignment_submissions', { courseId: 1, assignmentId: 20, group: 7 }); assert.ok(textOf(r).includes('Visible Alice')); const submissionId = textOf(r).match(/fileId `([^`]+)`/)[1]; safe(r.text);
  r = await call(ta.access_token, 'moodle_download_file', { fileId: submissionId }); assert.ok(textOf(r).includes('fixture notes')); safe(r.text); pass('authorized grader submission attachment accessible through sealed handle');
  r = await call(alice.access_token, 'moodle_download_file', { fileId: submissionId }); assert.equal(r.data.result?.isError, true); safe(r.text); pass('grader submission handle rejected for another account');
  await fixture('submission-access', { value: 'deny' }); r = await call(ta.access_token, 'moodle_download_file', { fileId: submissionId }); assert.equal(r.data.result?.isError, true); safe(r.text); await fixture('submission-access', { value: 'allow' }); pass('current submission permission rechecked for existing grader handle');
  const refreshed = await post('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: alice.refresh_token, resource: `${origin}/mcp` }); assert.equal(refreshed.status, 200); sensitive.push(refreshed.data.access_token, refreshed.data.refresh_token); r = await rpc(refreshed.data.access_token, 'tools/list'); assert.equal(r.status, 200); pass('real refresh-token renewal authenticates MCP');
  r = await post('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: bob.refresh_token, resource: 'https://wrong-resource.invalid/mcp' }); assert.equal(r.status, 400); pass('refresh resource mismatch rejected');
  r = await call('fixture-legacy-bearer', 'moodle_list_courses'); assert.ok(textOf(r).includes('Legacy course')); assert.ok(!textOf(r).includes('Alice course')); safe(r.text); pass('legacy static bearer resolves fixed identity only');
  // Replace a rejected Moodle credential while keeping the existing OAuth grant,
  // identity aliases and other users' data. No delete/disconnect endpoint is used.
  await fixture('reject-old-bob');
  r = await call(bob.access_token, 'moodle_list_courses'); assert.equal(r.status, 200); assert.equal(r.data.result?.isError, true); assert.match(textOf(r), /do not need to delete/); safe(r.text); pass('rejected Moodle credential returns actionable MCP tool error without expiring OAuth grant');
  r = await rpc(bob.access_token, 'tools/list'); assert.equal(r.status, 502); assert.equal(r.data.code, 'moodle_relink_required'); safe(r.text); pass('discovery authentication failure has specific recovery code');
  const repairVerifier = randomBytes(32).toString('base64url');
  const repairParams = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', scope: 'stemlearn:read offline_access', state: 'repair', code_challenge: createHash('sha256').update(repairVerifier).digest('base64url'), code_challenge_method: 'S256', resource: `${origin}/mcp` });
  const repairPage = await request(`/authorize?${repairParams}`);
  const repairSession = inputValue(repairPage.text, 'sessionId');
  const repairPassport = repairPage.text.match(/passport=([a-f0-9]+)/)?.[1];
  assert.ok(repairSession && repairPassport);
  bobMoodleToken = 'fixture-bob-new';
  const repairHash = createHash('md5').update('https://stemlearn.sun.ac.za' + repairPassport).digest('hex');
  const repaired = await post('/authorize/link', { sessionId: repairSession, siteId: 'stemlearn', connectionLink: `moodlemobile://token=${Buffer.from(`${repairHash}:::${bobMoodleToken}`).toString('base64')}` });
  assert.equal(repaired.status, 200); assert.ok(repaired.text.includes('>Reconnect</button>')); assert.ok(repaired.text.includes('id="panel-stemlearn"')); safe(repaired.text);
  r = await call(bob.access_token, 'moodle_list_courses'); assert.equal(r.status, 200); assert.ok(textOf(r).includes('Bob course')); pass('fresh Moodle credential restores existing OAuth grant without deleting data');
  r = await call(ta.access_token, 'moodle_list_courses'); assert.equal(r.status, 200); assert.ok(textOf(r).includes('TA course')); pass('credential repair preserves other accounts');
  await fixture('unlink', { user: 'bob' }); r = await call(bob.access_token, 'moodle_list_courses'); assert.equal(r.status, 403); assert.equal(r.data.code, 'account_link_required'); pass('unlinked OAuth user never falls back to legacy/env credential');
  const reconnect = await login('bob'); r = await call(reconnect.access_token, 'moodle_list_courses'); assert.ok(textOf(r).includes('Bob course')); pass('reconnect restores same isolated identity'); r = await rpc(bob.access_token, 'tools/list'); assert.equal(r.status, 401); pass('reconnect revokes superseded grant');
  await fixture('revoke'); r = await rpc(alice.access_token, 'tools/list'); assert.equal(r.status, 401); r = await post('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshed.data.refresh_token }); assert.equal(r.status, 400); pass('real provider grant revocation rejects access and refresh tokens');
  if (process.argv.includes('--compatibility')) {
    const { runSdkCompatibility } = await import('../compatibility/sdk.mjs');
    await runSdkCompatibility({ origin, token: ta.access_token });
  }
  await fixture('expire'); r = await rpc(reconnect.access_token, 'tools/list'); assert.equal(r.status, 401); pass('expired stored access token rejected by real provider');
  const outbound = await fixture('requests'); assert.ok(outbound.every(r => ['stemlearn.sun.ac.za', 'emslearn.sun.ac.za'].includes(r.host))); assert.ok(outbound.every(r => r.fn === 'file' || ['core_webservice_get_site_info', 'core_enrol_get_users_courses', 'core_course_get_contents', 'mod_assign_get_assignments', 'mod_assign_get_submission_status', 'mod_assign_get_submissions', 'mod_assign_list_participants', 'core_group_get_activity_allowed_groups', 'core_user_get_users_by_field'].includes(r.fn))); pass('only approved read-only Moodle functions and file hosts reached');
  safe(runtimeLogs); pass('runtime logs contain no fixture credential or authenticated URL');
  console.log(`\n${passed.length} security integration checks passed (real provider/workerd; fixture Moodle; local KV/D1).`);
} catch (error) {
  // Never print raw response objects, token values or unfiltered runtime logs.
  console.error(`FAIL ${error instanceof Error ? error.message : 'Security integration failed'}`);
  process.exitCode = 1;
} finally {
  if (probe?.listening) await new Promise(resolve => probe.close(resolve));
  if (runtime) { runtime.kill('SIGTERM'); await Promise.race([new Promise(resolve => runtime.once('exit', resolve)), sleep(2000)]); }
  await rm(stateDir, { recursive: true, force: true });
}
