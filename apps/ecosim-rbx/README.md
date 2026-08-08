# ecosim-rbx

A Roblox projection of the ecosim app. The ecosim webapp is the reference
implementation; this app mirrors its brain ABI (tile ids, abi ids, call specs,
type system) so brains authored in the ecosim webapp run here unmodified.

Built with roblox-ts (TypeScript compiled to Luau) and Rojo (filesystem to
Roblox Studio sync). The arena world is built entirely from code -- there is no
Studio-authored content and no place file in the repo.

## The game

You spawn on the west edge of a walled arena roughly 107 by 80 studs, with four
crates scattered through it. Sharing the arena are twelve creatures: two red
carnivores, five orange herbivores, and five small green plants. Each one runs a
real Mindcraft brain -- the same `.brain` assets the ecosim webapp ships, loaded
unmodified -- so what you watch is the brain program executing, not a scripted
routine.

Herbivores wander, look for plants, and graze on them; carnivores hunt
herbivores; plants photosynthesise, stay rooted to a springy anchor, and shoot
glowing blips at carnivores that get close. Every creature carries an energy bar
that shifts green to red as it drains, and pops a speech bubble when its brain
runs the `say` actuator. Energy that reaches zero kills the creature, and the
engine respawns a replacement after the archetype's delay, so the population
holds steady while individuals come and go.

The crates block line of sight, so a creature loses track of prey that ducks
behind one, and steers around them.

Your only way to affect the simulation is physical: creatures are unanchored
parts, so you can walk into them and shove them. There is no player sensor in
ecosim, so no creature can perceive you directly -- but a shoved creature's new
position and velocity feed straight back into the simulation, and pushing a
plant off its anchor makes it visibly spring back.

## Prerequisites

- Node.js 18 or newer.
- Aftman, to get the pinned Rojo version. From the repository root:

  ```sh
  aftman install
  ```

  The root `aftman.toml` pins `rojo-rbx/rojo@7.4.1` and
  `lune-org/lune@0.10.5`.
- App dependencies:

  ```sh
  npm --prefix apps/ecosim-rbx install
  ```

  `@mindcraft-lang/core` is a `file:` dependency, so npm links it from
  `packages/core`.

## Build

```sh
npm run build
```

`prebuild` runs `build:rbx` in `packages/core` first, so the Luau target of the
core package is always current. The compiler writes Luau into `out/` and copies
the roblox-ts runtime into `include/`. Neither directory is tracked.

For an incremental compile that watches for source changes:

```sh
npm run watch
```

`npm run clean` removes `out/` and `include/`.

`rbxtsc` type-checks as it compiles, so `npm run build` is also the typecheck for
this app. Plain `tsc` is not usable here: roblox-ts supplies its own lib and
transformations, and a bare `tsc --noEmit` reports errors against the `@rbxts`
ambient declarations that `rbxtsc` resolves correctly.

Lint and format with `npm run check` (Biome, autofix) or `npm run check:only`.

## Testing

```sh
npm test
```

`test/abi-parity.spec.ts` is the automated ABI parity check between this app and
`apps/ecosim`. It runs on Node (`tsx --test`, outside the roblox-ts program),
builds one Mindcraft environment from each app's `createEcosimModule`, and
compares what the two register: tile catalogs, host actions and their resolved
call-definition slots, the type registry, host functions, operators,
conversions, the brain-JSON migration, and the three shipped brain assets loaded
through both. It also asserts that `abi-ids.ts`, `tileids.ts`, and the brain
assets are byte-identical to their ecosim originals. Display metadata -- labels,
sentence language forms, icon urls -- is deliberately excluded. Run it after
touching any mirrored file or ecosim's brain module.

```sh
npm run test:luau
```

The Luau harness executes the compiled output on [Lune][lune], a standalone
Luau runtime pinned in the root `aftman.toml`. `pretest:luau` runs the normal
build first, so it always measures current Luau.

`test-luau/lib/roblox-env.luau` mounts `packages/core/dist/rbx`, `out/server`,
`out/shared`, and `include/` into a virtual instance tree with the same shape
Rojo produces, then loads every module through the real
`include/RuntimeLib.lua`. Emitted `TS.import` calls, the `_G[script]` handshake,
and roblox-ts's module-init ordering all run exactly as they do in Studio.
`test-luau/stubs/host.luau` stands in for `src/server/world` -- the only part of
the app that touches Roblox instances -- while the real `Actor`, `Mover`, and
`vision` modules are loaded from `out/` and run unchanged.

The run deserializes the three shipped brains, spawns one actor per archetype,
and ticks 660 frames through four stimulus windows: a free run, a sight window
with the actors held in each other's vision cones, a grazing window, and a
predation window. Assertions are behavioural -- energy transferred by a bite,
steering queued by a movement rule, a blip spawned by the plant, a speech
bubble raised by a child rule -- plus zero fiber faults and zero logged errors.
`test-luau/suites/core-sentinels.luau` adds direct checks for each Luau-only
core defect found so far.

Run it after any change to `packages/core` and before trusting a Studio
session. Neither Node suite can see this class of defect: JavaScript tolerates
module-init cycles, has no colon/dot call distinction, and wraps shift counts
instead of flushing them to zero.

[lune]: https://github.com/lune-org/lune

## Rojo workflow

Serve the project and connect Studio to it:

```sh
rojo serve
```

Then in Studio, connect with the Rojo plugin. Installing the `vscode-rojo`
VS Code extension installs the Studio plugin and can start the server for you;
the extension reads the root `aftman.toml` to pick the Rojo version.

The extension only discovers `*.project.json` files sitting at the top level
of a workspace folder, so open `mindcraft-lang.code-workspace` at the repo
root -- it adds `apps/ecosim-rbx` as a workspace folder, which makes this
app's `default.project.json` appear in the extension's project list.

Keep `npm run watch` running alongside `rojo serve`: roblox-ts writes Luau into
`out/` and Rojo syncs those files into Studio.

After rebuilding `packages/core`, restart `rojo serve` and reconnect the
Studio plugin. Rojo reaches core through the `node_modules` symlink; it
follows the symlink when taking its startup snapshot but cannot watch files
through it, so a running server keeps serving core's old build until
restarted. Files under this app's own `out/` are not affected.

To produce a standalone place file for inspection (write it outside the repo --
place files are not tracked):

```sh
rojo build default.project.json -o /tmp/ecosim-rbx.rbxlx
```

Once connected, press Play in Studio. The server script builds the arena, loads
the three brains, spawns the population, and drives the simulation from
`RunService.Heartbeat`; the output window carries a startup line and any brain
faults. Walk your character into a creature to shove it.

## Layout

- `src/server` -- server scripts, mounted at `ServerScriptService.TS`.
  - `src/server/brain` -- the mirror of `apps/ecosim/src/brain`. Keep it free of
    Roblox instance code.
  - `src/server/world` -- everything that touches Roblox: the arena, the sprite
    facade over each creature part, the billboard visuals, and the single
    pixel-to-stud conversion module.
- `src/client` -- client scripts, mounted at `StarterPlayer.StarterPlayerScripts.TS`.
- `src/shared` -- code used by both, mounted at `ReplicatedStorage.TS`. Includes
  `src/shared/brains/*.json`, byte-identical copies of the ecosim brain assets.

- `test` -- the Node-side ABI parity test and its tsconfig. It sits outside
  `src/`, which is the only directory `tsconfig.json` includes, so `rbxtsc`
  never sees it.
- `test-luau` -- the Lune harness: `run.luau` (entry point), `lib/` (the
  virtual instance tree, the module loader, the assertion recorder), `stubs/`
  (the headless host), and `suites/`. Also outside `src/`.

`default.project.json` also mounts `node_modules/@rbxts` and
`node_modules/@mindcraft-lang` under `ReplicatedStorage.rbxts_include.node_modules`
so compiled `require` calls resolve at runtime.
