import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MoodleClient, MoodleClientError, MoodleTimeoutError } from "../moodle-client.js";
import type { MultiSiteContext } from "../multi-site-context.js";
import { FILE_TRANSFER_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { withOwningSite } from "./download.js";
import { readOnlyTool } from "./read-only-tool.js";

// Saves a large file to the local download folder instead of embedding it in
// the MCP response. Registered only by the local stdio server (see
// createSunLearnServer). The Worker has no local disk, so it never gets this tool.
// The reply gives the file name, size, and SHA-256, and never the full path.

const MAX_NAME_CHARACTERS = 120;
const PDF_SIGNATURE = "%PDF-";

/**
 * A Moodle file name, reduced to a safe single path segment. Moodle names are
 * user-supplied, so separators, control characters, and leading dots are removed.
 */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_")
    .replace(/^[.\s]+/, "")
    .trim();
  const name = cleaned.length > 0 ? cleaned : "file";
  return [...name].slice(0, MAX_NAME_CHARACTERS).join("");
}

/** The first free name in `dir`: "report.pdf", then "report (2).pdf", and so on. */
async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    try {
      await fs.access(path.join(dir, candidate));
    } catch {
      return candidate;
    }
  }
  return `${stem} (${randomUUID().slice(0, 8)})${ext}`;
}

function errorText(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function failureText(err: unknown): string {
  if (err instanceof MoodleTimeoutError) return err.message;
  if (err instanceof MoodleClientError && (err.code === "timeout" || err.code === "too-large" || err.code === "cancelled")) return err.message;
  return "File download failed. Please try again.";
}

export function registerSaveTool(
  server: McpServer,
  client: MoodleClient,
  downloadDir: string,
  multiSite?: MultiSiteContext,
): void {
  readOnlyTool(server,
    "moodle_save_file",
    `Save a Moodle file (from moodle_list_resources or moodle_list_assignment_submissions) to the local download folder, for files too large to embed in a response (over ${Math.round(TEXT_OUTPUT_POLICY.maxEmbeddedBinaryFileBytes / 1024 / 1024)} MB). Returns the file name, size, and SHA-256, not the file contents. The folder is set on the server with MOODLE_MCP_DOWNLOAD_DIR.`,
    {
      fileId: z.string().describe("Opaque fileId returned by moodle_list_resources or moodle_list_assignment_submissions"),
    },
    async ({ fileId }, extra) => {
      const signal = extra?.signal;
      let saved;
      try {
        saved = await withOwningSite(client, multiSite, fileId, async (owner) => {
          const ref = await owner.authorizeFile(fileId);
          if (!ref) return null;
          await fs.mkdir(downloadDir, { recursive: true, mode: 0o700 });
          const finalName = await freeName(downloadDir, safeFileName(ref.filename));
          const partPath = path.join(downloadDir, `.${randomUUID()}.part`);
          const handle = await fs.open(partPath, "wx", 0o600);
          const hash = createHash("sha256");
          let head = Buffer.alloc(0);
          let size = 0;
          try {
            const downloaded = await owner.downloadFile(ref.fileurl, {
              maxBytes: owner.maxFileBytes,
              timeoutMs: FILE_TRANSFER_POLICY.saveTimeoutMs,
              signal,
              onChunk: async (chunk) => {
                size += chunk.byteLength;
                hash.update(chunk);
                if (head.length < PDF_SIGNATURE.length) head = Buffer.concat([head, chunk]).subarray(0, PDF_SIGNATURE.length);
                await handle.write(chunk);
              },
            });
            await handle.close();
            await fs.rename(partPath, path.join(downloadDir, finalName));
            return {
              name: finalName,
              size,
              sha256: hash.digest("hex"),
              mime: downloaded.mime || ref.mime,
              pdfSignature: head.toString("latin1") === PDF_SIGNATURE,
            };
          } catch (err) {
            await handle.close().catch(() => undefined);
            await fs.rm(partPath, { force: true });
            throw err;
          }
        });
      } catch (err) {
        return errorText(failureText(err));
      }
      if (!saved) {
        return errorText("fileId is invalid, expired, or was not issued to the current user. Re-run moodle_list_resources or moodle_list_assignment_submissions to get fresh IDs.");
      }

      const megabytes = (saved.size / 1024 / 1024).toFixed(1);
      const signature = saved.pdfSignature
        ? "The file starts with a PDF signature."
        : "The file does not start with a PDF signature. Check its type before opening it.";
      return {
        content: [{
          type: "text" as const,
          text: `Saved "${saved.name}" (${saved.size} bytes, ${megabytes} MB, ${saved.mime}) to the learn-mcp download folder.\nSHA-256: ${saved.sha256}\n${signature}`,
        }],
      };
    },
  );
}
