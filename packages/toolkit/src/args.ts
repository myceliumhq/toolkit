import { CliError, EXIT_CODES } from "./exit.js";

// Every command with a bounded-integer option (--limit, --depth, ...) goes
// through this instead of hand-rolling its own parse/clamp/NaN-check --
// search.ts and tree.ts independently reimplemented this with a different
// operation order (clamp-then-check-NaN vs check-then-clamp, functionally
// equivalent but real duplication in the toolkit meant to be the one
// shared base a second CLI copies from).
export function parseBoundedInt(
  raw: string,
  options: { min: number; max: number; flag: string },
): number {
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new CliError(`${options.flag} must be a number`, { exitCode: EXIT_CODES.usage });
  }
  return Math.min(Math.max(value, options.min), options.max);
}

// Every place a CLI parses a resource id (from a required positional or an
// optional --flag) goes through this instead of a bare Number() -- an
// unvalidated NaN id doesn't just fail cleanly: JSON.stringify turns NaN
// into `null`, so a bad --correspondent/--type id silently becomes "clear
// this field" in a PATCH body instead of erroring, a real, wrong,
// unrequested write. `label` names the source in the error (e.g. "<id>"
// for a positional, "--correspondent" for a flag).
export function parseId(raw: string, label = "<id>"): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new CliError(`${label} must be a number`, { exitCode: EXIT_CODES.usage });
  }
  return value;
}
