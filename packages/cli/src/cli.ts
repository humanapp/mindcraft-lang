import { runPublishCommand } from "./publish-command.js";
import { runUnpackCommand } from "./unpack-command.js";
import { runVersionCommand } from "./version-command.js";

const CLI_USAGE = `usage: mindcraft <command> [arguments]

commands:
  publish   publish a version of a Mindcraft project to GitHub
  version   increment a Mindcraft project's version in its mindcraft.json
  unpack    convert a .mindcraft export into a publishable project directory
`;

/**
 * Run the `mindcraft` command line with `argv` (the arguments after the
 * program name). Returns the process exit code.
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "publish") {
    return runPublishCommand(rest);
  }
  if (command === "version") {
    return runVersionCommand(rest);
  }
  if (command === "unpack") {
    return runUnpackCommand(rest);
  }
  process.stderr.write(command === undefined ? CLI_USAGE : `mindcraft: unknown command "${command}"\n${CLI_USAGE}`);
  return 1;
}
