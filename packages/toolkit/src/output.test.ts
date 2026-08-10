import { describe, expect, it, vi } from "vitest";
import { writeJson, writeJsonLines, writeTable, writeTruncationNotice } from "./output.js";

function captureStdout(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    calls.push(String(chunk));
    return true;
  });
  return { calls, restore: () => spy.mockRestore() };
}

function captureStderr(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    calls.push(String(chunk));
    return true;
  });
  return { calls, restore: () => spy.mockRestore() };
}

describe("writeJson", () => {
  it("writes compact JSON, not pretty-printed", () => {
    const out = captureStdout();
    writeJson({ a: 1, b: [1, 2] });
    out.restore();
    expect(out.calls).toEqual(['{"a":1,"b":[1,2]}\n']);
  });
});

describe("writeJsonLines", () => {
  it("writes one compact JSON object per line", () => {
    const out = captureStdout();
    writeJsonLines([{ id: 1 }, { id: 2 }]);
    out.restore();
    expect(out.calls).toEqual(['{"id":1}\n', '{"id":2}\n']);
  });
});

describe("writeTable", () => {
  it("aligns columns and truncates values past maxWidth with an ellipsis", () => {
    const out = captureStdout();
    writeTable(
      [{ id: "abc123", title: "a very long title that overflows" }],
      [
        { header: "ID", value: (r) => r.id },
        { header: "TITLE", value: (r) => r.title, maxWidth: 10 },
      ],
    );
    out.restore();
    expect(out.calls[0]).toBe("ID      TITLE\n");
    expect(out.calls[1]).toBe("abc123  a very lo…\n");
  });
});

describe("writeTruncationNotice", () => {
  it("writes to stderr, not stdout", () => {
    const out = captureStdout();
    const err = captureStderr();
    writeTruncationNotice({ shown: 20, total: 143 });
    out.restore();
    err.restore();
    expect(out.calls).toEqual([]);
    expect(err.calls).toEqual(["showing 20 of 143 -- use --limit\n"]);
  });

  it("includes a cursor hint when provided", () => {
    const err = captureStderr();
    writeTruncationNotice({ shown: 20, nextCursor: "abc123" });
    err.restore();
    expect(err.calls).toEqual(["showing 20 -- use --limit or --cursor abc123\n"]);
  });
});
