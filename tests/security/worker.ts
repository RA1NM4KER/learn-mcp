// Local-only test entry point. NEVER configured by production wrangler.toml.
// Real repository provider, routes, KV, D1, transport and crypto; Moodle is a fixture.
import { oauthProvider } from "../../src/oauth/provider.js";
import { oauthHelpers, type Env } from "../../src/oauth/env.js";
import { lookupAlias } from "../../src/oauth/canonical-identity.js";
import { deleteCredential } from "../../src/linking/credential-store.js";
import { FileIdStore } from "../../src/file-id-store.js";
import { MoodleClient } from "../../src/moodle-client.js";

import media from "../compatibility/media.json" with { type: "json" };

const stem = "https://stemlearn.sun.ac.za";
const ems = "https://emslearn.sun.ac.za";
const identities = new Map([
  ["fixture-alice", { id: 101, name: "Alice", base: stem }],
  ["fixture-bob", { id: 102, name: "Bob", base: stem }],
  ["fixture-bob-new", { id: 102, name: "Bob", base: stem }],
  ["fixture-alice-ems", { id: 201, name: "Alice EMS", base: ems }],
  ["fixture-ta", { id: 104, name: "TA", base: stem }],
  ["fixture-legacy", { id: 103, name: "Legacy", base: stem }],
]);
let mode = "normal";
let rejectOldBob = false;
let courseAccess = true;
let submissionAccess = true;
const requests: { host: string; fn: string; method: string; identity: string }[] = [];
const functions = ["core_webservice_get_site_info", "core_enrol_get_users_courses", "core_course_get_contents", "mod_assign_get_assignments", "mod_assign_get_submission_status", "mod_assign_get_submissions", "mod_assign_list_participants", "core_group_get_activity_allowed_groups", "core_user_get_users_by_field"];
const fileUrl = (base: string) => `${base}/pluginfile.php/1/notes.txt`;
const json = (value: unknown) => Response.json(value);

// No fixture request may ever reach real Moodle or arbitrary network destinations.
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const body = new URLSearchParams(String(init?.body ?? ""));
  const token = body.get("wstoken") ?? url.searchParams.get("token") ?? "";
  const identity = identities.get(token);
  if (!identity || url.origin !== identity.base) throw new Error("Fixture refused a credential destination");
  if (rejectOldBob && token === "fixture-bob") return json({ exception: "moodle_exception", errorcode: "invalidtoken", message: "Private fixture credential rejection" });
  const fn = body.get("wsfunction") ?? "file";
  requests.push({ host: url.host, fn, method: init?.method ?? "GET", identity: identity.name });
  if (init?.redirect !== "manual") throw new TypeError("Fixture requires Workers-supported redirect protection");
  if (mode === "redirect" || (mode === "file-redirect" && fn === "file")) return new Response(null, { status: 307, headers: { Location: "https://untrusted.invalid/receive" } });
  if (mode === "stall" || (mode === "file-stall" && fn === "file")) return new Response(new ReadableStream({ start(controller) {
    init?.signal?.addEventListener("abort", () => controller.error(new DOMException("fixture secret must stay hidden", "AbortError")), { once: true });
  } }), { headers: { "content-type": fn === "file" ? "text/plain" : "application/json" } });
  if (fn === "file") {
    if (mode === "oversize") return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < 6; i++) controller.enqueue(new Uint8Array(1024 * 1024));
      controller.close();
    } }), { headers: { "content-type": "text/plain" } });
    const file = media.find(f => url.pathname.endsWith("/" + f.filename));
    if (file) return new Response(Uint8Array.from(atob(file.base64), c => c.charCodeAt(0)), { headers: { "content-type": file.mime } });
    return new Response("fixture notes", { headers: { "content-type": "text/plain" } });
  }
  if (!functions.includes(fn)) throw new Error("Fixture refuses unlisted Moodle functions");
  if (mode === "upstream-error") return json({ exception: "fixture", errorcode: "invalidtoken", message: `private ${token} ${fileUrl(identity.base)}` });
  const course = { id: 1, fullname: `${identity.name} course`, shortname: identity.name };
  switch (fn) {
    case "core_webservice_get_site_info": return json({ userid: identity.id, sitename: identity.name, functions: functions.map(name => ({ name })) });
    case "core_enrol_get_users_courses": return json(courseAccess ? [course] : []);
    case "core_course_get_contents": return json(courseAccess ? [{ id: 1, name: "General", summary: `<a href='${fileUrl(identity.base)}?token=${token}'>${fileUrl(identity.base)}?token=${token}</a>`, modules: [{ id: 10, name: "Notes", modname: "resource", contents: [{ type: "file", filename: "notes.txt", fileurl: fileUrl(identity.base), filesize: 13, mimetype: "text/plain" }, ...media.map(f => ({ type: "file", filename: f.filename, fileurl: `${identity.base}/pluginfile.php/1/${f.filename}`, filesize: atob(f.base64).length, mimetype: f.mime }))] }] }] : []);
    case "mod_assign_get_assignments": return json({ courses: [{ id: 1, assignments: [{ id: 20, cmid: 30, name: "Assignment", duedate: 0 }] }] });
    case "mod_assign_get_submission_status": {
      if (identity.name === "TA" && !submissionAccess) return json({ exception: "required_capability_exception", errorcode: "nopermissions", message: "private fixture-ta" });
      const userid = Number(body.get("userid") ?? identity.id);
      return json({ lastattempt: { submission: { id: 1, userid, status: "submitted", plugins: identity.name === "TA" ? [{ type: "file", fileareas: [{ area: "submission_files", files: [{ filename: "submission.txt", filesize: 13, mimetype: "text/plain", fileurl: `${stem}/pluginfile.php/1/submission.txt` }] }] }] : [] } } });
    }
    case "core_user_get_users_by_field": return json([{ id: 102, fullname: "Hidden Bob", idnumber: "00102" }]);
    case "mod_assign_list_participants": if (identity.name === "TA") return json([{ id: 101, fullname: "Visible Alice", idnumber: "00101", groups: [{ id: 7, name: "Allowed" }] }]); return json({ exception: "required_capability_exception", errorcode: "nopermissions" });
    case "core_group_get_activity_allowed_groups": if (identity.name === "TA") return json({ groups: [{ id: 7, name: "Allowed" }] }); return json({ exception: "required_capability_exception", errorcode: "nopermissions", message: `private ${token}` });
    case "mod_assign_get_submissions": return json({ assignments: [] });
    default: throw new Error("Unreachable fixture function");
  }
};

export default {
  async fetch(request: Request, bindings: Env, ctx: ExecutionContext): Promise<Response> {
    const env: Env = {
      ...bindings, MOODLE_URL: stem, MOODLE_TOKEN: "fixture-legacy", MCP_ACCESS_TOKEN: "fixture-legacy-bearer",
      CREDENTIAL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ACCESS_MODE: "public", OAUTH_ISSUER_URL_OVERRIDE: new URL(request.url).origin,
      MOODLE_MCP_REQUEST_TIMEOUT_MS: "1000",
    };
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/__fixture/")) return oauthProvider.fetch(request, env, ctx);
    // Obtain helpers from the ACTUAL configured provider, without bypassing auth routes.
    await oauthProvider.fetch(new Request(`${url.origin}/fixture-helper-initialization`), env, ctx);
    const data = await request.json() as { action: string; user?: string; token?: string; value?: string };
    const userToken = data.user === "bob" ? "fixture-bob" : "fixture-alice";
    const userId = await lookupAlias(env.DB, stem, identities.get(userToken)!.id);
    if (!userId) return new Response("Fixture identity missing", { status: 400 });
    switch (data.action) {
      case "reject-old-bob": rejectOldBob = true; return json({ ok: true });
      case "mode": mode = data.value ?? "normal"; return json({ ok: true });
      case "submission-access": submissionAccess = data.value !== "deny"; return json({ ok: true });
      case "access": courseAccess = data.value !== "deny"; return json({ ok: true });
      case "requests": return json(requests);
      case "unlink": await deleteCredential(env.DB, userId, stem); return json({ ok: true });
      case "revoke": {
        const grants = await oauthHelpers(env).listUserGrants(userId);
        for (const grant of grants.items) await oauthHelpers(env).revokeGrant(grant.id, userId);
        return json({ ok: true });
      }
      case "audience":
      case "expire": {
        // Fixture-only storage mutation: tests actual expired-token validation, not elapsed TTL cleanup.
        const entries = await env.OAUTH_KV.list({ prefix: "token:" });
        for (const entry of entries.keys) {
          const record = await env.OAUTH_KV.get<Record<string, unknown>>(entry.name, "json");
          if (record) await env.OAUTH_KV.put(entry.name, JSON.stringify(data.action === "expire" ? { ...record, expiresAt: 1 } : { ...record, audience: data.value ?? `${url.origin}/mcp` }));
        }
        return json({ ok: true });
      }
      case "expired-file": return json({ fileId: await new FileIdStore(userToken, -1).seal({ userId: identities.get(userToken)!.id, courseId: 1, fileurl: fileUrl(stem), filename: "notes.txt", filesize: 13, mime: "text/plain" }) });
      case "unsafe-file": return json({ fileId: await new FileIdStore(userToken).seal({ userId: identities.get(userToken)!.id, courseId: 1, fileurl: data.value ?? "https://untrusted.invalid/pluginfile.php/x", filename: "notes.txt", filesize: 13, mime: "text/plain" }) });
      case "cancel": {
        const client = await MoodleClient.create({ baseUrl: stem, auth: { kind: "token", token: userToken }, maxFileBytes: 1024, requestTimeoutMs: 100 });
        mode = "stall";
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 10);
        try { await client.downloadFile(fileUrl(stem), { signal: controller.signal, timeoutMs: 100 }); return json({ cancelled: false }); }
        catch (error) { return json({ cancelled: error instanceof Error && /cancelled/i.test(error.message) }); }
        finally { mode = "normal"; }
      }
      default: return new Response("Unknown local fixture action", { status: 400 });
    }
  },
};
