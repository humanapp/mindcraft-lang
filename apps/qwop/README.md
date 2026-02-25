# Mindcraft QWOP

A brain-controlled ragdoll runner inspired by Bennett Foddy's
[QWOP](https://www.foddy.net/legacy/Athletics.html).

The runner is built with Phaser 3 and Matter.js physics. Instead of (or in
addition to) pressing keys yourself, the goal is to wire up a Mindcraft brain
that learns to coordinate the runner's limbs and make it down the track.

## Controls

Just like the original, the runner is controlled with the four keys `Q`/`W`/`O`/`P`. A fifth key `T` adds a jump that is not in the original.

| Key | Action |
| --- | ------ |
| **Q** | Left thigh forward, right thigh back |
| **W** | Right thigh forward, left thigh back |
| **O** | Left knee flex, right knee extend |
| **P** | Right knee flex, left knee extend |
| **T** | Jump (when at least one foot is on the ground) |
| **Space** | Reset |

## Running locally

From the repository root:

```sh
npm install
npm run dev
```

Or run only the QWOP app:

```sh
cd apps/qwop
npm run dev
```

## Project structure

```
apps/qwop/
  src/
    App.tsx            -- React shell (HUD, sidebar, reset button)
    PhaserGame.tsx     -- Phaser canvas integration
    components/        -- UI components (sidebar, etc.)
    game/
      main.ts          -- Phaser game config
      scenes/
        QwopScene.ts   -- Physics scene (ragdoll, motors, camera)
```

## Brain integration

Brain integration is not yet wired up. Once it is, the brain will be able to
read the runner's joint angles, velocities, distance, tilt, then output motor
commands each tick -- replacing or augmenting keyboard input.
