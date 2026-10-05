import type { Config } from "./config.js";
import { DEFAULT_MAX_FILE_MB, DEFAULT_REQUEST_TIMEOUT_MS } from "./config.js";
import { FILE_TRANSFER_POLICY } from "./policy.js";
import { FileIdStore, type FileRef } from "./file-id-store.js";
import { isMoodleFileContent, MoodleAssignSubmissionStatusSchema, MoodleAssignSubmissionsResponseSchema, MoodleCourseContentsSchema, MoodleErrorResponseSchema, MoodleLoginResponseSchema, MoodleSiteInfoSchema } from "./moodle-api.js";
import type { z } from "zod";

export interface DownloadedFile {
  mime: string;
  /** The whole file, unless the caller streamed it through onChunk (then empty). */
  bytes: Uint8Array;
  size: number;
}

export interface FileTransferOptions {
  /** Deadline for the whole transfer. Defaults to FILE_TRANSFER_POLICY.embedTimeoutMs. */
  timeoutMs?: number;
  /** Byte cap for this transfer. Defaults to the client's maxFileBytes. */
  maxBytes?: number;
  /** Cancels the transfer when aborted. */
  signal?: AbortSignal;
  /** Receives bytes as they arrive, so large files are never held whole in memory. */
  onChunk?: (chunk: Uint8Array) => Promise<void>;
}

export class MoodleClientError extends Error {
  constructor(message: string, readonly code: "timeout" | "network" | "authentication" | "api" | "cancelled" | "too-large") {
    super(message);
    this.name = "MoodleClientError";
  }
}

export class MoodleTimeoutError extends MoodleClientError {
  constructor() { super("Moodle request timed out. Please try again.", "timeout"); this.name = "MoodleTimeoutError"; }
}

/** A file transfer ran past its deadline. The message says how long it waited. */
export class FileTransferTimeoutError extends MoodleClientError {
  constructor(seconds: number) {
    const shown = Math.max(1, seconds);
    super(`The file did not finish downloading within ${shown} second${shown === 1 ? "" : "s"}. Try again, or check the connection.`, "timeout");
    this.name = "FileTransferTimeoutError";
  }
}

/** The caller cancelled the download (for example the MCP client aborted the request). */
export class FileTransferCancelledError extends MoodleClientError {
  constructor() { super("The download was cancelled before it finished.", "cancelled"); this.name = "FileTransferCancelledError"; }
}

export class MoodleValidationError extends MoodleClientError {
  constructor() { super("Moodle returned an unexpected response. Please try again.", "api"); this.name = "MoodleValidationError"; }
}

export class MoodleClient {
  userId: number = 0;
  siteName: string = "";
  release: string = "";
  supportedFunctions: Set<string> = new Set();
  readonly fileIdStore: FileIdStore;

  private readonly baseHost: string;
  readonly maxFileBytes: number;
  readonly requestTimeoutMs: number;

  private constructor(
    readonly baseUrl: string,
    private readonly token: string,
    maxFileBytes = DEFAULT_MAX_FILE_MB * 1024 * 1024,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    this.baseHost = new URL(baseUrl).host;
    this.fileIdStore = new FileIdStore(token);
    this.maxFileBytes = maxFileBytes;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  /** Returns true if the WS function is available on this Moodle server. */
  supports(wsfunction: string): boolean {
    if (this.supportedFunctions.size === 0) return true;
    return this.supportedFunctions.has(wsfunction);
  }

  static async create(config: Config): Promise<MoodleClient> {
    const token = config.auth.kind === "token"
      ? config.auth.token
      : await MoodleClient.login(config.baseUrl, config.auth.username, config.auth.password, config.requestTimeoutMs);
    const client = new MoodleClient(config.baseUrl, token, config.maxFileBytes, config.requestTimeoutMs);
    const info = await client.call("core_webservice_get_site_info", {}, MoodleSiteInfoSchema);
    client.userId = info.userid;
    client.siteName = info.sitename;
    client.release = info.release ?? "";
    client.supportedFunctions = new Set(info.functions?.map((f) => f.name) ?? []);
    return client;
  }

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new MoodleTimeoutError();
      }
      throw new MoodleClientError("Unable to reach Moodle. Please try again.", "network");
    } finally {
      clearTimeout(timer);
    }
  }

  private static async login(baseUrl: string, username: string, password: string, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<string> {
    const url = `${baseUrl}/login/token.php`;
    const body = new URLSearchParams({ username, password, service: "moodle_mobile_app" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let res: Response;
    try { res = await fetch(url, { method: "POST", body, signal: controller.signal }); }
    catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw new MoodleTimeoutError();
      throw new MoodleClientError("Unable to reach Moodle. Please try again.", "network");
    }
    finally { clearTimeout(timer); }
    const text = await res.text();
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error(
        "Moodle login returned an unexpected response. Your school may require SSO; use `npm run auth` or a Moodle token instead."
      );
    }
    const parsed = MoodleLoginResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new Error("Moodle login returned an unexpected response. Use `npm run auth` or a Moodle token instead.");
    }
    const data = parsed.data;
    if (data.error) {
      throw new MoodleClientError("Moodle login failed. Check your credentials and Moodle URL.", "authentication");
    }
    if (!data.token) {
      throw new Error(
        "Moodle login failed: no token returned. Ensure the Moodle Mobile app service is enabled."
      );
    }
    return data.token;
  }

  async call<TSchema extends z.ZodTypeAny>(
    wsfunction: string,
    params: Record<string, string | number | boolean> = {},
    schema: TSchema,
  ): Promise<z.output<TSchema>> {
    const url = `${this.baseUrl}/webservice/rest/server.php`;
    const body = new URLSearchParams({
      wstoken: this.token,
      wsfunction,
      moodlewsrestformat: "json",
      // Moodle's PARAM_BOOL rejects the literal strings "true"/"false" that
      // String(v) would produce — it wants "1"/"0" (confirmed against a real
      // Moodle server: message_popup_get_popup_notifications with
      // newestfirst="true" -> invalidparameter; newestfirst="1" -> works).
      ...Object.fromEntries(
        Object.entries(params).map(([k, v]) => [
          k,
          typeof v === "boolean" ? (v ? "1" : "0") : String(v),
        ]),
      ),
    });
    const res = await this.fetch(url, { method: "POST", body });
    if (!res.ok) throw new Error("Moodle API request failed. Please try again.");
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new MoodleValidationError();
    }
    const moodleError = MoodleErrorResponseSchema.safeParse(data);
    if (moodleError.success) {
      if (moodleError.data.errorcode === "webservicesnotenabled") {
        throw new Error(
          "Web services are not enabled on this Moodle server. Contact your IT department to enable them."
        );
      }
      if (moodleError.data.errorcode === "invalidtoken") {
        throw new MoodleClientError("Invalid or expired Moodle token. Run `npm run auth` to sign in again and get a fresh one.", "authentication");
      }
      throw new MoodleClientError("Moodle API request was rejected. Check that you still have access.", "api");
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      // Never log the raw payload or the token — only the wsfunction and the
      // Zod issue paths/codes, so a schema mismatch against a Moodle version
      // this server hasn't seen yet is diagnosable from Cloudflare's
      // invocation logs without collapsing into an opaque, undebuggable
      // "unexpected response" for every mismatch (this is how the calendar
      // schema bug above went unnoticed against real Moodle 4.5.8 traffic).
      console.error(
        "MoodleValidationError",
        wsfunction,
        JSON.stringify(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message }))),
      );
      throw new MoodleValidationError();
    }
    return parsed.data;
  }

  /**
   * Fetch a Moodle-managed file through the server. Only accepts pluginfile.php
   * URLs on this Moodle host — external `url` module targets are refused so we
   * don't become an SSRF relay. Caps the response at MAX_DOWNLOAD_BYTES.
   *
   * The Moodle WS token is attached to the outbound request only; it never
   * reappears in anything returned to the MCP client.
   */
  /**
   * Stream a Moodle-managed file. One deadline covers the request, the
   * headers, and the body, so a stalled transfer cannot hang. `maxBytes`
   * aborts the stream as soon as it grows past the cap. With `onChunk`,
   * bytes go to the caller as they arrive and nothing is buffered here.
   * `signal` cancels the transfer. The Moodle token is attached to the
   * outbound request only and is never returned or logged.
   */
  async downloadFile(fileurl: string, options: FileTransferOptions = {}): Promise<DownloadedFile> {
    this.assertSafeFileUrl(fileurl);
    const parsed = new URL(fileurl);
    parsed.searchParams.set("token", this.token);

    const timeoutMs = options.timeoutMs ?? FILE_TRANSFER_POLICY.embedTimeoutMs;
    const maxBytes = options.maxBytes ?? this.maxFileBytes;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    const onCancel = () => deadline.abort();
    options.signal?.addEventListener("abort", onCancel, { once: true });
    try {
      const res = await fetch(parsed.toString(), { signal: deadline.signal });
      return await this.readDownloadedFile(res, maxBytes, deadline.signal, options.onChunk);
    } catch (error) {
      if (options.signal?.aborted) throw new FileTransferCancelledError();
      if (deadline.signal.aborted) throw new FileTransferTimeoutError(Math.round(timeoutMs / 1000));
      if (error instanceof MoodleClientError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new FileTransferTimeoutError(Math.round(timeoutMs / 1000));
      throw new MoodleClientError("Unable to reach Moodle while downloading the file. Please try again.", "network");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onCancel);
    }
  }

  /**
   * Open a file for streaming straight to a client, with no buffering. Only
   * the response headers are bounded here; the caller streams the body.
   * The Moodle token is attached to the outbound request only.
   */
  async openFileStream(fileurl: string, timeoutMs = FILE_TRANSFER_POLICY.embedTimeoutMs): Promise<Response> {
    this.assertSafeFileUrl(fileurl);
    const parsed = new URL(fileurl);
    parsed.searchParams.set("token", this.token);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(parsed.toString(), { signal: controller.signal });
      if (!res.ok) throw new MoodleClientError(`Moodle returned HTTP ${res.status} for this file.`, "api");
      return res;
    } catch (error) {
      if (error instanceof MoodleClientError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new FileTransferTimeoutError(Math.round(timeoutMs / 1000));
      throw new MoodleClientError("Unable to reach Moodle while downloading the file. Please try again.", "network");
    } finally {
      clearTimeout(timer);
    }
  }

  /** Validate a sealed file ref and re-check Moodle's current course access. */
  async authorizeFile(fileId: string): Promise<FileRef | null> {
    const ref = await this.fileIdStore.open(fileId, this.userId);
    if (!ref) return null;
    return this.authorizeRef(ref);
  }

  /**
   * Re-check Moodle's current access for an already-opened file reference.
   * Used by sealed fileIds and by signed download links, which carry the same reference.
   */
  async authorizeRef(ref: FileRef): Promise<FileRef | null> {
    try { this.assertSafeFileUrl(ref.fileurl); } catch (error) {
      // The error text names the failed check, never the URL.
      // Hostnames are public and needed to see a mismatch; paths and tokens are never logged.
      let fileHost = "unparseable";
      try { fileHost = new URL(ref.fileurl).host; } catch { /* keep the placeholder */ }
      console.error("authorizeRef url check", error instanceof Error ? error.message.slice(0, 120) : "non-error", `fileHost=${fileHost}`, `clientHost=${this.baseHost}`);
      return null;
    }
    try {
      if (ref.assignmentId !== undefined) {
        // Submission attachments are authorised by the assignment's current
        // submissions. A failed call (no grading access, submission removed)
        // denies the file, the same as a missing course file.
        const hasFile = (plugins: { fileareas: { files: { fileurl: string }[] }[] }[]) =>
          plugins.some((plugin) => plugin.fileareas.some((area) => area.files.some((file) => file.fileurl === ref.fileurl)));
        if (ref.submitterId !== undefined) {
          // Per-student status: cheap, and it only covers the one submitter.
          const status = await this.call(
            "mod_assign_get_submission_status",
            { assignid: ref.assignmentId, userid: ref.submitterId },
            MoodleAssignSubmissionStatusSchema,
          );
          const submissions = [
            status.lastattempt?.submission,
            status.lastattempt?.teamsubmission,
            ...status.previousattempts.map((attempt) => attempt.submission),
          ];
          const found = submissions.some((submission) => submission !== undefined && hasFile(submission.plugins));
          // Counts only: no names, IDs, or URLs reach the logs.
          console.error("authorizeRef status", `attempts=${submissions.filter((s) => s !== undefined).length}`, `files=${submissions.reduce((n, s) => n + (s?.plugins ?? []).reduce((m, p) => m + p.fileareas.reduce((k, a) => k + a.files.length, 0), 0), 0)}`, `match=${found}`);
          return found ? ref : null;
        }
        // Fileids minted before submitterId existed: the whole-assignment check.
        const response = await this.call(
          "mod_assign_get_submissions",
          { "assignmentids[0]": ref.assignmentId },
          MoodleAssignSubmissionsResponseSchema,
        );
        const found = response.assignments.some((assignment) => assignment.submissions.some((submission) => hasFile(submission.plugins)));
        return found ? ref : null;
      }
      const sections = await this.call("core_course_get_contents", { courseid: ref.courseId }, MoodleCourseContentsSchema);
      return sections.some((section) => section.modules.some((mod) =>
        (mod.contents ?? []).some((file) => isMoodleFileContent(file) && file.fileurl === ref.fileurl),
      )) ? ref : null;
    } catch (error) {
      if (error instanceof MoodleTimeoutError) throw error;
      console.error("authorizeRef failed", error instanceof Error ? `${error.name}: ${error.message.slice(0, 120)}` : "non-error");
      return null;
    }
  }

  async downloadAuthorizedFile(fileId: string, options: FileTransferOptions = {}): Promise<{ ref: FileRef; downloaded: DownloadedFile } | null> {
    const ref = await this.authorizeFile(fileId);
    if (!ref) return null;
    return { ref, downloaded: await this.downloadFile(ref.fileurl, options) };
  }

  private assertSafeFileUrl(fileurl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(fileurl);
    } catch {
      throw new Error("Invalid file URL");
    }
    if (parsed.host !== this.baseHost) {
      throw new Error("Refused: file URL is not on this Moodle host");
    }
    if (parsed.protocol !== new URL(this.baseUrl).protocol) {
      throw new Error("Refused: file URL does not use the configured Moodle protocol");
    }
    if (
      !parsed.pathname.includes("/pluginfile.php") &&
      !parsed.pathname.includes("/webservice/pluginfile.php")
    ) {
      throw new Error("Refused: only Moodle-managed pluginfile.php URLs can be fetched");
    }
  }

  private async readDownloadedFile(
    res: Response,
    maxBytes: number,
    signal: AbortSignal,
    onChunk?: (chunk: Uint8Array) => Promise<void>,
  ): Promise<DownloadedFile> {
    if (!res.ok) throw new MoodleClientError(`Moodle returned HTTP ${res.status} for this file.`, "api");
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const tooLarge = (size: number) => new MoodleClientError(
      `File is ${(size / 1024 / 1024).toFixed(1)} MB or larger; the limit for this request is ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      "too-large",
    );

    const lengthHeader = res.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > maxBytes) throw tooLarge(Number(lengthHeader));

    if (!res.body) {
      // Test doubles and very old runtimes may return no stream. The size is checked after the fact.
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) throw tooLarge(buf.byteLength);
      if (onChunk) await onChunk(buf);
      return { mime, bytes: onChunk ? new Uint8Array(0) : buf, size: buf.byteLength };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw tooLarge(total);
        }
        if (onChunk) await onChunk(value);
        else chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (signal.aborted) throw new MoodleClientError("The file transfer was aborted.", "timeout");

    if (onChunk) return { mime, bytes: new Uint8Array(0), size: total };
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { mime, bytes, size: total };
  }
}
