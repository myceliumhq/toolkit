import { CliError, EXIT_CODES } from "./exit.js";

export type ConfigSpec = Record<string, { env: string; required?: boolean; description?: string }>;

type ResolvedConfig<S extends ConfigSpec> = { [K in keyof S]?: string };

// Every mycelium CLI reads config from env vars only -- no config-file
// parsing here, no interactive setup. That keeps a fresh agent session
// (a container, a CI job) working with nothing but exported env vars, which
// is the lowest-friction thing to script around. A wrapping shell profile
// or .env loader is the right place for anything fancier; this stays a
// pure `process.env` reader so it's trivial to reason about and test.
export function loadConfig<S extends ConfigSpec>(spec: S): ResolvedConfig<S> {
  const result = {} as ResolvedConfig<S>;
  for (const [key, { env }] of Object.entries(spec) as [keyof S, S[keyof S]][]) {
    const value = process.env[env];
    if (value !== undefined && value !== "") {
      result[key] = value;
    }
  }
  return result;
}

// Same resolution as loadConfig, but throws a CliError (exit code 4, the
// shared auth/config code) naming exactly which env var is missing --
// every write/read command that needs config calls this instead of
// hand-rolling its own "is this set" check, so the error shape (and exit
// code) stays identical across tri/ppl.
export function requireConfig<S extends ConfigSpec>(spec: S): { [K in keyof S]: string } {
  const resolved = loadConfig(spec);
  const missingEnvNames = (Object.entries(spec) as [keyof S, S[keyof S]][])
    .filter(([key, entry]) => entry.required !== false && resolved[key] === undefined)
    .map(([, entry]) => entry.env);
  if (missingEnvNames.length > 0) {
    const envNames = missingEnvNames.join(", ");
    throw new CliError(`missing required config: ${envNames}`, {
      exitCode: EXIT_CODES.config,
      fix: `set ${envNames} and retry, or run the doctor command`,
    });
  }
  return resolved as { [K in keyof S]: string };
}
