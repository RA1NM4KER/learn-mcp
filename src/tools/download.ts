import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bytesToBase64, isTextMime } from "../content.js";
import { MoodleClient, MoodleTimeoutError } from "../moodle-client.js";
import type { MultiSiteContext } from "../multi-site-context.js";
import { TEXT_OUTPUT_POLICY } from "../policy.js";
import { truncateText } from "../text.js";

type Authorized = NonNullable<Awaited<ReturnType<MoodleClient["downloadAuthorizedFile"]>>>;

/**
 * A fileId is sealed with the minting site's own token-derived key, so only
 * that site's client can open it (a wrong site's open() returns null). Finds
 * the owning client — anchor first, then each additional linked site — and
 * lets THAT client's downloadAuthorizedFile() re-check current course access.
 * Once a client opens the id, its result/errors are final: no other site is tried.
 */
async function downloadFromOwningSite(
  anchor: MoodleClient,
  multiSite: MultiSiteContext | undefined,
  fileId: string,
): Promise<Authorized | null> {
  if (await anchor.fileIdStore.open(fileId, anchor.userId)) return anchor.downloadAuthorizedFile(fileId);

  let buildError: unknown;
  for (const { config } of multiSite?.additionalSites ?? []) {
    let candidate: MoodleClient;
    try { candidate = await MoodleClient.create(config); } catch (err) {
      // An unreachable unrelated site must not mask the owner, but if nobody claims the id, surface this.
      buildError ??= err;
      continue;
    }
    if (await candidate.fileIdStore.open(fileId, candidate.userId)) return candidate.downloadAuthorizedFile(fileId);
  }
  if (buildError) throw buildError;
  return null;
}

/** Not registered at all when disabled — see REMOTE_COURSE_CONTENT_ENABLED (oauth/env.ts) — so the MCP tool list itself accurately reflects that full file retrieval is unavailable, not just an error message on call. */
export function registerDownloadTool(server: McpServer, client: MoodleClient, contentEnabled = true, multiSite?: MultiSiteContext): void {
  if (!contentEnabled) return;
  server.tool(
    "moodle_download_file",
    "Download a Moodle course file by its opaque fileId (from moodle_list_resources). Returns text for text/JSON/XML files; returns the raw bytes as an embedded resource for binary formats like PDFs, DOCX, images. The server fetches the file, so you never need to fetch Moodle URLs directly.",
    {
      fileId: z.string().describe("Opaque fileId returned by moodle_list_resources"),
    },
    async ({ fileId }) => {
      let authorized;
      try { authorized = await downloadFromOwningSite(client, multiSite, fileId); } catch (err) {
        const message = err instanceof MoodleTimeoutError
          ? err.message : "File download failed. Please try again.";
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
      if (!authorized) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "fileId is invalid, expired, or was not issued to the current user. Re-run moodle_list_resources to get fresh IDs.",
            },
          ],
        };
      }

      const { ref, downloaded } = authorized;

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

      if (downloaded.bytes.length > TEXT_OUTPUT_POLICY.maxEmbeddedBinaryFileBytes) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Binary file is too large to embed safely. The MCP binary limit is ${Math.round(TEXT_OUTPUT_POLICY.maxEmbeddedBinaryFileBytes / 1024 / 1024)} MB.`,
          }],
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
