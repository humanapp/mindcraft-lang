# Mindcraft Language

A tile-based visual programming language for creating behaviors in interactive worlds.

Programs are built by arranging **tiles** -- typed, composable tokens -- into **rules**. Each rule has a WHEN side (conditions) and a DO side (actions). A collection of rules forms a **brain** that drives an autonomous actor. Host applications extend the language with custom types, sensors, and actuators.

The core library compiles to Roblox (Luau), Node.js, and browser (ESM) targets from a single TypeScript codebase.

Mindcraft draws inspiration from other tile-based programming systems past and present, including [Kodu Game Lab](https://www.kodugamelab.com/), [Project Spark](https://en.wikipedia.org/wiki/Project_Spark), and [MicroCode](https://microbit-apps.org/microcode-classic/docs/manual).

## Demos

- [Ecology Sim](https://mindcraft-sim.humanappliance.io) -- carnivores, herbivores, and plants driven by user-editable Mindcraft brains

## Repository Structure

```
packages/
  core/       @mindcraft-lang/core -- language runtime (multi-target)
  ui/         @mindcraft-lang/ui -- shared React UI components
apps/
  sim/        Ecology simulation demo
```

## Packages

| Package | Description |
|---------|-------------|
| [@mindcraft-lang/core](packages/core/) | Language runtime -- tiles, parser, compiler, VM (multi-target: Roblox, Node.js, ESM) |
| [@mindcraft-lang/ui](packages/ui/) | Shared React UI -- shadcn/ui primitives + brain editor components |

## Apps

| App | Description |
|-----|-------------|
| [Ecology Sim](apps/sim/) | Demo: carnivores, herbivores, and plants driven by user-editable Mindcraft brains |

## Install

```bash
npm install @mindcraft-lang/core
```

## Documentation

Documentation is a work in progress. See the [core package README](packages/core/README.md) for language architecture and the [ui package README](packages/ui/README.md) for the shared React components. The [sim app](apps/sim/) provides a working example of integrating Mindcraft into a project.

## Contributing

To report a bug or request a feature, please [open an issue](https://github.com/humanapp/mindcraft-lang/issues).

## License

[MIT](LICENSE)
