// Shared exit-code contract across every mycelium CLI (tri, ppl, ...). An
// agent driving the CLI branches on these without parsing stderr text, so
// the mapping must stay stable once a CLI ships -- treat it as a public API.
export const EXIT_CODES = {
  ok: 0,
  error: 1,
  usage: 2,
  notFound: 3,
  config: 4,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

// Thrown by command implementations instead of a bare Error so the CLI
// entrypoint knows which EXIT_CODES value to exit with and, optionally, a
// one-line fix a caller (human or agent) can act on immediately instead of
// re-reading --help.
export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly fix?: string;

  constructor(message: string, options: { exitCode?: ExitCode; fix?: string } = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = options.exitCode ?? EXIT_CODES.error;
    this.fix = options.fix;
  }
}

// Every CLI entrypoint's top-level catch routes here: one line to stderr
// (message, then the fix if one was given), never a stack trace -- an
// agent reading stderr should get the actionable fact, not a trace it has
// no use for. Returns the process exit code rather than calling
// process.exit itself so callers (and tests) stay in control of the
// process lifecycle.
export function reportError(error: unknown): ExitCode {
  if (error instanceof CliError) {
    process.stderr.write(
      error.fix ? `error: ${error.message} -- ${error.fix}\n` : `error: ${error.message}\n`,
    );
    return error.exitCode;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  return EXIT_CODES.error;
}
