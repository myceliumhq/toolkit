import { describe, expect, it, vi } from "vitest";
import { CliError, EXIT_CODES, reportError } from "./exit.js";

describe("reportError", () => {
  it("maps a CliError to its own exit code and writes message + fix to stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const error = new CliError("missing <noteId>", {
      exitCode: EXIT_CODES.usage,
      fix: "see: tri note get --help",
    });

    const code = reportError(error);

    expect(code).toBe(EXIT_CODES.usage);
    expect(write).toHaveBeenCalledWith("error: missing <noteId> -- see: tri note get --help\n");
    write.mockRestore();
  });

  it("omits the fix segment when a CliError doesn't set one", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    reportError(new CliError("boom"));
    expect(write).toHaveBeenCalledWith("error: boom\n");
    write.mockRestore();
  });

  it("defaults a CliError with no exitCode to EXIT_CODES.error", () => {
    expect(reportError(new CliError("boom"))).toBe(EXIT_CODES.error);
  });

  it("maps a plain Error to EXIT_CODES.error", () => {
    expect(reportError(new Error("network down"))).toBe(EXIT_CODES.error);
  });

  it("maps a non-Error throw to EXIT_CODES.error via String()", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(reportError("raw string throw")).toBe(EXIT_CODES.error);
    expect(write).toHaveBeenCalledWith("error: raw string throw\n");
    write.mockRestore();
  });
});
