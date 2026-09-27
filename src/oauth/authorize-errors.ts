// Error classification for the application-owned /authorize route.  This is
// deliberately free of the Workers OAuth package at runtime so it can be
// regression-tested under Node as well as used inside workerd.

export const CLIENT_METADATA_UNAVAILABLE = "We couldn't verify that application. Please try again.";

/**
 * `parseAuthRequest` can throw CimdFetchError when a URL-form client_id's
 * Client ID Metadata Document is temporarily unavailable or invalid. The
 * library's error class is not safely importable under Node/Vitest because it
 * depends on Workers-only runtime modules, so match its documented stable
 * name. This changes only the public error rendering; no trust decision is
 * based on the match.
 */
export function isCimdFetchError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "CimdFetchError"
  );
}
