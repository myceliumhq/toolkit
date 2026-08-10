import { Command, CommanderError } from "commander";
import { EXIT_CODES, type ExitCode, reportError } from "./exit.js";

export type { Command } from "commander";

// Every mycelium CLI builds its top-level program through this instead of
// `new Command()` directly. exitOverride() makes commander throw a
// CommanderError instead of calling process.exit() itself on a parse/usage
// failure or on --help/--version, so runProgram() below can map it to this
// toolkit's own exit-code contract instead of commander's defaults (which
// exit 1 for every failure, including usage errors that should be 2).
//
// `version` is optional and opt-in -- pass it to get a `--version` flag
// wired up (runProgram's commander.version case exists for this); a CLI
// with no package version to report just omits it.
export function createProgram(name: string, description: string, version?: string): Command {
  const program = new Command(name).description(description).exitOverride();
  return version !== undefined ? program.version(version) : program;
}

// Every subcommand (at any nesting level -- `note`, then `note get`) goes
// through this instead of a bare `.command()` call, so exitOverride()
// applies uniformly and a nested subcommand's own usage failure throws
// the same way the root program's does.
export function addSubcommand(parent: Command, nameAndArgs: string): Command {
  return parent.command(nameAndArgs).exitOverride();
}

// Runs a fully-configured program against argv and returns the process
// exit code. Tells apart three cases: commander's own usage failures
// (missing/invalid argument, unknown option or command -- commander has
// already written its own one-line message to stderr, so this maps the
// exit code without printing a second message); a genuine `--help`/
// `--version` (exit 0, commander's output is real content); and a
// command's own thrown CliError/Error, routed through reportError() for
// this toolkit's shared one-line stderr format.
export async function runProgram(program: Command, argv: string[]): Promise<ExitCode> {
  try {
    await program.parseAsync(argv, { from: "user" });
    return EXIT_CODES.ok;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return EXIT_CODES.ok;
      }
      return EXIT_CODES.usage;
    }
    return reportError(error);
  }
}
