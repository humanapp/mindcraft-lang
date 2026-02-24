// Re-export Roblox's builtin task API
// task is a global namespace in Roblox
declare const task: typeof import("./task").task;
export { task };
