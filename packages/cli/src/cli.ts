import { runPublishCommand } from "./publish-command.js";

const CLI_USAGE = `usage: mindcraft <command> [arguments]

commands:
  publish   publish the next version of a Mindcraft project to GitHub
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
  process.stderr.write(command === undefined ? CLI_USAGE : `mindcraft: unknown command "${command}"\n${CLI_USAGE}`);
  return 1;
}
