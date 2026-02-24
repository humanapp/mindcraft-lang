# Mindcraft Language

A tile-based visual programming language for creating behaviors in interactive worlds.

Programs are built by arranging **tiles** -- typed, composable tokens -- into **rules**. Each rule has a WHEN side (conditions) and a DO side (actions). A collection of rules forms a **brain** that drives an autonomous actor. Host applications extend the language with custom types, sensors, and actuators.

The core library compiles to Roblox (Luau), Node.js, and browser (ESM) targets from a single TypeScript codebase.

Mindcraft draws inspiration from other tile-based programming systems past and present, including [Kodu Game Lab](https://www.kodugamelab.com/), [Project Spark](https://en.wikipedia.org/wiki/Project_Spark), and [MicroCode](https://microbit-apps.org/microcode-classic/docs/manual).

## Install

```bash
npm install @mindcraft-lang/core
```

## Documentation

Documentation is a work in progress. In the meantime, see the [core package README](packages/core/README.md) for architecture details and developer guidance. The [sim app](apps/sim/) provides a working example of integrating Mindcraft into a project.

## Contributing

This repository does not accept issues or pull requests directly. To report a bug, request a feature, or propose a collaboration, please open an issue in the [mindcraft-lang-issues](https://github.com/humanapp/mindcraft-lang-issues) repository. We'll discuss there before any code changes happen here.

## License

[MIT](LICENSE)
