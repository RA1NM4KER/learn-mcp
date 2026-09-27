import { normalizeUrl } from "../config.js";
import { isAllowedMoodleHost } from "../sunlearn-sites.js";

// A credential row's stored moodle_base_url is never trusted as the
// destination for a decrypted token purely because it's present in the
// database — this allowlist (backed by sunlearn-sites.ts, the single
// registry of supported SUNLearn instances) only gates what's allowed to be
// written to, and re-validated from, that column, so a database edit alone
// can never smuggle in a host we'd actually send a token to.

export class DisallowedMoodleHostError extends Error {
  constructor() {
    super("Moodle host is not on the supported list.");
    this.name = "DisallowedMoodleHostError";
  }
}

/** Normalize a Moodle base URL and verify it's HTTPS and on the supported host allowlist. */
export function assertAllowedMoodleBaseUrl(rawUrl: string): string {
  const normalized = normalizeUrl(rawUrl);
  const { protocol, hostname } = new URL(normalized);
  if (protocol !== "https:" || !isAllowedMoodleHost(hostname)) {
    throw new DisallowedMoodleHostError();
  }
  return normalized;
}
