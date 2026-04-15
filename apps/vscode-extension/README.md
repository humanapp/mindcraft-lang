> **Web only:** This extension runs exclusively in [VS Code for the Web](https://vscode.dev) and is not compatible with VS Code desktop.

**Mindcraft** is a tile-based programming language for creative coding applications. Programs are built by arranging **tiles** -- typed, composable tokens -- into **rules**. A collection of rules forms a **brain**, which drives the behavior of in-game actors.

<div align="center">
  <img src="https://raw.githubusercontent.com/humanapp/mindcraft-lang/main/assets/rule.png" alt="Brain Rule" width="80%">
</div>

## What This Extension Does

This extension lets you **author custom brain tiles in TypeScript** and use them in a live Mindcraft app. A bridge connects VS Code to your running Mindcraft app session -- edit a tile source file and it becomes available in the brain editor immediately. No local toolchain required.

_Example: Authoring a "teleport" actuator in TypeScript:_
<div align="center">
  <img src="https://raw.githubusercontent.com/humanapp/mindcraft-lang/main/assets/vscode.png" alt="Coding in TypeScript" width="80%">
</div>

## Getting Started

1. Open [vscode.dev](https://vscode.dev) in your browser and install the **Mindcraft** extension.
2. Launch your Mindcraft app and enable the VS Code Bridge. Make note of the generated **join code**.
3. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **Mindcraft: Connect**, entering your join code.
4. Scaffold a new tile with **Mindcraft: Create New Sensor** or **Mindcraft: Create New Actuator**.
5. Edit the generated TypeScript file -- your tile is instantly available in the brain editor.

## Commands

| Command | Description |
|---|---|
| `Mindcraft: Connect` | Connect to a running Mindcraft app |
| `Mindcraft: Disconnect` | Disconnect from the current session |
| `Mindcraft: Create New Sensor` | Scaffold a new sensor tile |
| `Mindcraft: Create New Actuator` | Scaffold a new actuator tile |
| `Mindcraft: Sync Files` | Re-sync the filesystem with the connected app |
