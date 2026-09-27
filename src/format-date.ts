// Single source of truth for rendering a Moodle Unix timestamp as
// human-readable text. Never rely on the host process's own timezone: the
// Cloudflare Worker runtime defaults to UTC regardless of where the student
// is, so an unqualified `toLocaleString()` silently renders a South African
// deadline up to two hours early — confirmed live against a real assignment
// due "23:59" Africa/Johannesburg, which rendered as "9:59 p.m." (21:59 UTC).
//
// All currently-supported SUNLearn deployments (src/sunlearn-sites.ts) are
// Stellenbosch University instances in the same timezone, so one registry-
// wide constant is accurate today without needing to thread a per-site
// timezone through every render call. If a future site needs a different
// timezone, add it here deliberately rather than letting a new tool file
// bake in its own guess.
export const DEFAULT_MOODLE_TIMEZONE = "Africa/Johannesburg";

/** Renders a Moodle timestamp (Unix seconds) as a date + time in the Moodle deployment's timezone. */
export function formatMoodleDateTime(ts: number, timeZone: string = DEFAULT_MOODLE_TIMEZONE): string {
  return new Date(ts * 1000).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone });
}

/** Renders a Moodle timestamp (Unix seconds) as a date only, in the Moodle deployment's timezone. */
export function formatMoodleDateOnly(ts: number, timeZone: string = DEFAULT_MOODLE_TIMEZONE): string {
  return new Date(ts * 1000).toLocaleString("en-CA", { dateStyle: "medium", timeZone });
}
