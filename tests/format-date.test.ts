import { describe, expect, it } from "vitest";
import { formatMoodleDateOnly, formatMoodleDateTime } from "../src/format-date.js";

// Deliberately timestamp-first, not clock-first: computed independently of
// whatever timezone the test runner's own process happens to be in (the
// Cloudflare Worker runtime defaults to UTC; a contributor's laptop may not),
// so this regression can't accidentally pass only because the machine
// running it happens to already be in Africa/Johannesburg.
const DUE_23H59_SAST = Date.UTC(2026, 9, 1, 21, 59) / 1000; // 2026-10-01 23:59 SAST == 21:59 UTC

describe("formatMoodleDateTime", () => {
  it("renders a SAST due date in the Moodle deployment's timezone, not UTC", () => {
    // Regression: rendering without an explicit timeZone used the host
    // process's own timezone. On the Cloudflare Worker runtime (UTC), a real
    // "SS244 Practical 2 - Due 1/10 at 23h59" assignment rendered as
    // "Oct 1, 2026, 9:59 p.m." — two hours early.
    const result = formatMoodleDateTime(DUE_23H59_SAST);
    expect(result).toContain("11:59 p.m.");
    expect(result).not.toContain("9:59 p.m.");
  });

  it("accepts an explicit override timezone", () => {
    const result = formatMoodleDateTime(DUE_23H59_SAST, "UTC");
    expect(result).toContain("9:59 p.m.");
  });
});

describe("formatMoodleDateOnly", () => {
  it("keeps a timestamp on the correct calendar day when SAST has already rolled over past UTC midnight", () => {
    // SAST is UTC+2, so it crosses into the next calendar day two hours
    // before UTC does. Rendering with the process's own (UTC) timezone
    // instead of Africa/Johannesburg would show the wrong (earlier) day.
    const ts = Date.UTC(2026, 9, 1, 23, 0) / 1000; // 2026-10-01 23:00 UTC == 2026-10-02 01:00 SAST
    expect(formatMoodleDateOnly(ts)).toContain("Oct 2, 2026");
  });
});
