import { EXIT_CODES, type ExitCode } from "./exit.js";
import { writeStderr } from "./output.js";

export type DoctorCheck = {
  name: string;
  run: () => Promise<void>;
};

// Every mycelium CLI's `doctor` subcommand is one call to this: run each
// check, print a PASS/FAIL line as it resolves (not batched at the end --
// a hung network check should still show what already passed), and map
// to EXIT_CODES.config if anything failed so scripting `tri doctor &&
// tri note read ...` works without parsing output.
export async function runDoctorChecks(checks: readonly DoctorCheck[]): Promise<ExitCode> {
  let allOk = true;
  for (const check of checks) {
    try {
      await check.run();
      writeStderr(`PASS  ${check.name}`);
    } catch (error) {
      allOk = false;
      const message = error instanceof Error ? error.message : String(error);
      writeStderr(`FAIL  ${check.name} -- ${message}`);
    }
  }
  return allOk ? EXIT_CODES.ok : EXIT_CODES.config;
}
