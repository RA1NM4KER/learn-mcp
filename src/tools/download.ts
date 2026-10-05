import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bytesToBase64, isTextMime } from "../content.js";
import { MoodleClient, MoodleClientError, MoodleTimeoutError } from "../moodle-client.js";
import type { MultiSiteContext } from "../multi-site-context.js";
import { FILE_TRANSFER_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { truncateText } from "../text.js";
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
export function registerDownloadTool(
  server: McpServer,
  client: MoodleClient,
  contentEnabled = true,
  multiSite?: MultiSiteContext,
  saveToolAvailable = false,
): void {
  if (!contentEnabled) return;
  const saveHint = saveToolAvailable
    ? " For larger files, use moodle_save_file, which saves them to the local download folder."
    : "";
  readOnlyTool(server,
    "moodle_download_file",
    `Download a Moodle file by its opaque fileId: a course file (from moodle_list_resources) or a submission attachment (from moodle_list_assignment_submissions, teaching assistants only). Returns text for text/JSON/XML files; returns the raw bytes as an embedded resource for binary formats like PDFs, DOCX, images, up to ${EMBED_MAX_MB} MB.${saveHint} The server fetches the file, so you never need to fetch Moodle URLs directly.`,
    {
      fileId: z.string().describe("Opaque fileId returned by moodle_list_resources or moodle_list_assignment_submissions"),
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
            return { ref, tooLarge: true as const };
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
        return errorText("fileId is invalid, expired, or was not issued to the current user. Re-run moodle_list_resources or moodle_list_assignment_submissions to get fresh IDs.");
      }
      if (result.tooLarge) {
        return errorText(
          `This file is ${(result.ref.filesize / 1024 / 1024).toFixed(1)} MB. The MCP embeds files up to ${EMBED_MAX_MB} MB, so it was not downloaded.${saveHint}`,
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
        ],
      };
    },
  );
}
