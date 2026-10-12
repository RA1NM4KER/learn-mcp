import { afterEach, describe, expect, it, vi } from "vitest";
import { PDF_READ_POLICY } from "../src/policy.js";
const proxy = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("unpdf", () => ({ getDocumentProxy: proxy.load }));
import { readPdfText } from "../src/pdf-text.js";

afterEach(() => { vi.useRealTimers(); proxy.load.mockReset(); });
describe("PDF extraction interruption", () => {
  it("times out parsing and destroys a document that finishes loading afterward", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    proxy.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const result = readPdfText(new Uint8Array([1]), 1, 1);
    const rejected = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(PDF_READ_POLICY.extractionTimeoutMs);
    await rejected;
    const destroy = vi.fn().mockResolvedValue(undefined);
    finish({ loadingTask: { destroy } });
    await vi.advanceTimersByTimeAsync(0);
    expect(destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels pending parsing without exposing parser errors", async () => {
    vi.useFakeTimers();
    proxy.load.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const result = readPdfText(new Uint8Array([1]), 1, 1, controller.signal);
    const rejected = expect(result).rejects.toThrow("cancelled");
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
