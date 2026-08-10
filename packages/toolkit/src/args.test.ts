import { describe, expect, it } from "vitest";
import { parseBoundedInt, parseId } from "./args.js";
import { CliError, EXIT_CODES } from "./exit.js";

describe("parseBoundedInt", () => {
  it("parses a valid value within bounds", () => {
    expect(parseBoundedInt("5", { min: 1, max: 100, flag: "--limit" })).toBe(5);
  });

  it("clamps a value below min", () => {
    expect(parseBoundedInt("0", { min: 1, max: 100, flag: "--limit" })).toBe(1);
  });

  it("clamps a value above max", () => {
    expect(parseBoundedInt("500", { min: 1, max: 100, flag: "--limit" })).toBe(100);
  });

  it("throws a usage-exit CliError naming the flag for a non-numeric value", () => {
    let caught: unknown;
    try {
      parseBoundedInt("abc", { min: 1, max: 100, flag: "--limit" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(EXIT_CODES.usage);
    expect((caught as CliError).message).toBe("--limit must be a number");
  });
});

describe("parseId", () => {
  it("parses a valid numeric id", () => {
    expect(parseId("42")).toBe(42);
  });

  it("does not clamp -- any finite number passes", () => {
    expect(parseId("-1")).toBe(-1);
  });

  it("throws a usage-exit CliError for a non-numeric value", () => {
    let caught: unknown;
    try {
      parseId("abc", "--correspondent");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(EXIT_CODES.usage);
    expect((caught as CliError).message).toBe("--correspondent must be a number");
  });

  it("documents that an empty string is accepted as id 0, not rejected", () => {
    // Number("") is 0, not NaN, so Number.isFinite(0) is true -- this is a
    // known quirk of JS numeric coercion, not a validated "empty is
    // invalid" case. Documented here so a future change to this behavior
    // is a deliberate decision, not an accidental regression.
    expect(parseId("")).toBe(0);
  });

  it("defaults the label to '<id>' for a positional argument", () => {
    let caught: unknown;
    try {
      parseId("not-a-number");
    } catch (error) {
      caught = error;
    }
    expect((caught as CliError).message).toBe("<id> must be a number");
  });
});
