#!/usr/bin/env node

const { spawn } = require("child_process");
const { watch } = require("fs");
const path = require("path");
const chalk = require("chalk");

const distRbxDir = path.join(__dirname, "..", "dist", "rbx");
const postBuildScript = path.join(__dirname, "post-build-rbx.js");

let postBuildTimeout;
let isRunningPostBuild = false;

// Function to run the post-build script
function runPostBuild() {
  if (isRunningPostBuild) {
    return;
  }

  isRunningPostBuild = true;
  console.log(chalk.blue("\nRunning post-build script..."));

  const postBuild = spawn("node", [postBuildScript], {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });

  postBuild.on("close", (code) => {
    isRunningPostBuild = false;
    if (code === 0) {
      console.log(chalk.green("Post-build script completed successfully"));
    } else {
      console.log(chalk.red(`Post-build script failed with code ${code}`));
    }
  });
}

// Function to schedule post-build with debouncing
function schedulePostBuild() {
  // Clear any existing timeout
  if (postBuildTimeout) {
    clearTimeout(postBuildTimeout);
  }

  // Schedule post-build to run after a short delay to allow compilation to complete
  postBuildTimeout = setTimeout(() => {
    runPostBuild();
  }, 500);
}

console.log(chalk.cyan("Starting roblox-ts watch mode with post-build processing..."));

// Start rbxtsc in watch mode
const rbxtsc = spawn("npx", ["rbxtsc", "--type", "package", "--project", "tsconfig.rbx.json", "-w"], {
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
});

// Watch for changes in the dist/rbx directory
let watcher;

// Wait a bit for rbxtsc to create the dist directory
setTimeout(() => {
  try {
    watcher = watch(distRbxDir, { recursive: true }, (eventType, filename) => {
      if (filename && (filename.endsWith(".luau") || filename.endsWith(".d.ts"))) {
        console.log(chalk.yellow(`Detected change: ${filename}`));
        schedulePostBuild();
      }
    });
    console.log(chalk.cyan("Watching for changes in dist/rbx directory..."));
  } catch (error) {
    console.log(chalk.yellow("Could not set up file watcher, post-build script will not run automatically"));
    console.log(chalk.yellow("Make sure to run the build command manually after making changes"));
  }
}, 2000);

// Handle process termination
process.on("SIGINT", () => {
  console.log(chalk.red("\nStopping watch mode..."));
  if (watcher) {
    watcher.close();
  }
  rbxtsc.kill("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log(chalk.red("\nStopping watch mode..."));
  if (watcher) {
    watcher.close();
  }
  rbxtsc.kill("SIGTERM");
  process.exit(0);
});

rbxtsc.on("close", (code) => {
  console.log(chalk.gray(`\nrbxtsc process exited with code ${code}`));
  if (watcher) {
    watcher.close();
  }
  process.exit(code);
});
