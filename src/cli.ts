import { checkProject } from "./check.js";
import { formatViolations } from "./diagnostics.js";
import { describeError } from "./errors.js";

export interface CliIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export const VERSION = "0.1.0";

const HELP = `Semantic Architecture Checker ${VERSION}

Usage:
  arch check [project-root] [--config path]
  arch --help
  arch --version

Exit codes:
  0  No architecture violations
  1  Architecture violations found
  2  Configuration or tool error`;

export async function runCli(
  args: readonly string[],
  io: CliIO = {
    stdout: (message) => console.log(message),
    stderr: (message) => console.error(message),
  },
): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    io.stdout(HELP);
    return 0;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    io.stdout(VERSION);
    return 0;
  }

  if (args[0] !== "check") {
    io.stderr(`Unknown command "${args[0]}".\n\n${HELP}`);
    return 2;
  }

  if (args.includes("--help") || args.includes("-h")) {
    io.stdout(HELP);
    return 0;
  }

  try {
    const options = parseCheckArguments(args.slice(1));
    const result = await checkProject(options);

    if (result.violations.length > 0) {
      io.stdout(formatViolations(result.violations));
      return 1;
    }

    io.stdout(`No architecture violations found (${result.graph.files.size} files checked).`);
    return 0;
  } catch (error) {
    io.stderr(`Architecture checker error\n\n${describeError(error)}`);
    return 2;
  }
}

function parseCheckArguments(args: readonly string[]): {
  projectRoot: string;
  configPath?: string;
} {
  let projectRoot: string | undefined;
  let configPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;

    if (argument === "--config") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--config requires a path.");
      }
      if (configPath !== undefined) throw new Error("--config may only be specified once.");
      configPath = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("-")) throw new Error(`Unknown option "${argument}".`);
    if (projectRoot !== undefined) throw new Error("Only one project root may be specified.");
    projectRoot = argument;
  }

  return configPath === undefined
    ? { projectRoot: projectRoot ?? process.cwd() }
    : { projectRoot: projectRoot ?? process.cwd(), configPath };
}
