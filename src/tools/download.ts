import { readPdfText } from "../pdf-text.js";
import { renderPdfText } from "./pdf-render.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bytesToBase64, isTextMime } from "../content.js";
import { MoodleClient, MoodleClientError, MoodleTimeoutError } from "../moodle-client.js";
import type { MultiSiteContext } from "../multi-site-context.js";
import { FILE_TRANSFER_POLICY, TEXT_OUTPUT_POLICY, PDF_READ_POLICY } from "../policy.js";
import { truncateText } from "../text.js";
import type { FileRef } from "../file-id-store.js";
import { readOnlyTool } from "./read-only-tool.js";

const EMBED_MAX_BYTES = TEXT_OUTPUT_POLICY.maxEmbeddedBinaryFileBytes;
const EMBED_MAX_MB = Math.round(EMBED_MAX_BYTES / 1024 / 1024);

/**
 * A fileId is sealed with the minting site's own token-derived key, so only
 * that site's client can open it (a wrong site's open() returns null). Finds
 * the owning client (anchor first, then each additional linked site) and runs
 * `use` on it. Once a client opens the id, its result and errors are final:
 * no other site is tried.
 */
export async function withOwningSite<T>(
  anchor: MoodleClient,
  multiSite: MultiSiteContext | undefined,
  fileId: string,
  use: (client: MoodleClient) => Promise<T>,
): Promise<T | null> {
  if (await anchor.fileIdStore.open(fileId, anchor.userId)) return use(anchor);

  let buildError: unknown;
  for (const { config } of multiSite?.additionalSites ?? []) {
    let candidate: MoodleClient;
    try { candidate = await MoodleClient.create(config); } catch (err) {
      // An unreachable unrelated site must not mask the owner, but if nobody claims the id, surface this.
      buildError ??= err;
      continue;
    }
    if (await candidate.fileIdStore.open(fileId, candidate.userId)) return use(candidate);
  }
  if (buildError) throw buildError;
  return null;
}

function errorText(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

/** Maps a failed transfer to a message that says what happened and what to try. */
function transferFailure(err: unknown): string {
  if (err instanceof MoodleTimeoutError) return err.message;
  if (err instanceof MoodleClientError && (err.code === "timeout" || err.code === "too-large" || err.code === "cancelled")) return err.message;
  return "File download failed. Please try again.";
}

/** Not registered at all when disabled — see REMOTE_COURSE_CONTENT_ENABLED (oauth/env.ts) — so the MCP tool list itself accurately reflects that full file retrieval is unavailable, not just an error message on call. */
/**
 * Issues a signed, expiring download link for a file. `baseUrl` is the Moodle
 * site that owns the file (not necessarily the anchor site). Provided on the remote Worker only.
 */
export type FileLinkFor = (ref: FileRef, baseUrl: string) => Promise<string>;

export function registerDownloadTool(
  server: McpServer,
  client: MoodleClient,
  contentEnabled = true,
  multiSite?: MultiSiteContext,
  saveToolAvailable = false,
  fileLinkFor?: FileLinkFor,
): void {
  if (!contentEnabled) return;
  const saveHint = saveToolAvailable
    ? " For larger files, use moodle_save_file, which saves them to the local download folder."
    : "";
  readOnlyTool(server,
    "moodle_download_file",
    `Download a Moodle file by its opaque fileId: a course file (from moodle_list_resources) or a submission attachment (from moodle_list_assignment_submissions, teaching assistants only). Returns text for text/JSON/XML files and native image content for PNG/JPEG/GIF/WebP. PDF downloads also include readable text from the first ${PDF_READ_POLICY.defaultPages} pages when extraction succeeds; use moodle_read_file for other page ranges. The original PDF remains available for visual inspection. Returns raw bytes as an embedded resource for other binary formats like PDFs and DOCX, up to ${EMBED_MAX_MB} MB.${saveHint} The server fetches the file, so you never need to fetch Moodle URLs directly.`,
    {
      fileId: z.string().describe("Opaque fileId returned by moodle_list_resources, moodle_get_page or moodle_list_assignment_submissions"),
    },
    async ({ fileId }, extra) => {
      const signal = extra?.signal;
      let result;
      try {
        result = await withOwningSite(client, multiSite, fileId, async (owner) => {
          const ref = await owner.authorizeFile(fileId);
          if (!ref) return null;
          // Refuse from the metadata before fetching, so a large file costs no transfer.
          if (!isTextMime(ref.mime) && ref.filesize > EMBED_MAX_BYTES) {
            return { ref, tooLarge: true as const, link: fileLinkFor ? await fileLinkFor(ref, owner.baseUrl) : undefined };
          }
          const downloaded = await owner.downloadFile(ref.fileurl, {
            maxBytes: EMBED_MAX_BYTES,
            timeoutMs: FILE_TRANSFER_POLICY.embedTimeoutMs,
            signal,
          });
          return { ref, downloaded, tooLarge: false as const };
        });
      } catch (err) {
        if (err instanceof MoodleClientError && err.code === "too-large") {
          return errorText(`Binary file is too large to embed safely (over ${EMBED_MAX_MB} MB).${saveHint}`);
        }
        return errorText(transferFailure(err));
      }
      if (!result) {
        return errorText("fileId is invalid, expired, or was not issued to the current user. Re-run moodle_list_resources, moodle_get_page or moodle_list_assignment_submissions to get fresh IDs.");
      }
      if (result.tooLarge) {
        const size = `${(result.ref.filesize / 1024 / 1024).toFixed(1)} MB`;
        if (result.link) {
          return errorText(
            `This file is ${size}. The MCP embeds files up to ${EMBED_MAX_MB} MB, so it was not downloaded. Give the user this download link, which works for one hour and opens the file directly in a browser: ${result.link}`,
          );
        }
        return errorText(
          `This file is ${size}. The MCP embeds files up to ${EMBED_MAX_MB} MB, so it was not downloaded.${saveHint}`,
        );
      }

      const { ref, downloaded } = result;
      const mime = downloaded.mime || ref.mime || "application/octet-stream";
      const resourceUri = `moodle://files/${fileId}`;

      if (isTextMime(mime)) {
        const text = truncateText(
          new TextDecoder("utf-8", { fatal: false }).decode(downloaded.bytes),
          TEXT_OUTPUT_POLICY.maxTextFileCharacters,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `**${truncateText(ref.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** (${mime})\n\n${text}`,
            },
          ],
        };
      }

      if (/^image\/(png|jpeg|gif|webp)$/.test(mime)) {
        return {
          content: [
            { type: "text" as const, text: `**${truncateText(ref.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** (${mime}, ${downloaded.bytes.length} bytes). Inspect the image below.` },
            { type: "image" as const, mimeType: mime, data: bytesToBase64(downloaded.bytes) },
          ],
        };
      }

      let pdfPreview: string | undefined;
      if (mime === "application/pdf") {
        try {
          pdfPreview = renderPdfText(ref.filename, await readPdfText(downloaded.bytes.slice(), 1, PDF_READ_POLICY.defaultPages, signal));
        } catch {
          pdfPreview = "PDF downloaded successfully, but text extraction was unavailable. The document has not been read. Use moodle_read_file for a smaller page range or inspect the original PDF; do not infer its contents from its filename.";
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `**${truncateText(ref.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** (${mime}, ${downloaded.bytes.length} bytes), embedded below.`,
          },
          {
            type: "resource" as const,
            resource: {
              uri: resourceUri,
              mimeType: mime,
              blob: bytesToBase64(downloaded.bytes),
            },
          },
          ...(pdfPreview ? [{ type: "text" as const, text: pdfPreview }] : []),
        ],
      };
    },
  );
}
