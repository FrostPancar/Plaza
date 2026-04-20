# Recommended Dependencies (Next Steps)

These are not required for the current prototype, but they are strong next choices for scaling into a real game.

## Core 3D + Utilities

- `three`
  - Reason: Keep using the same rendering stack when moving from CDN to a bundled app.
- `vite`
  - Reason: Fast dev server, HMR, and easy production builds.

## Physics and Collision

- `@dimforge/rapier3d-compat`
  - Reason: Fast WASM physics, good for player capsule collisions and rigid bodies.
- `three-mesh-bvh`
  - Reason: Efficient raycasts and static world collision acceleration.

## Assets / World Building

- `gl-matrix` (optional if math complexity increases)
  - Reason: High-performance vector/matrix math helpers.
- `@gltf-transform/core` + `@gltf-transform/functions`
  - Reason: Optimize and process GLTF assets before shipping.

## UI / Game State

- `lil-gui`
  - Reason: In-game debug controls for tuning movement and lighting quickly.
- `zustand`
  - Reason: Lightweight game/app state (settings, player data, scene states).

## Audio

- `howler`
  - Reason: Simple positional/non-positional audio management for browser games.

## Multiplayer / Backend (when needed)

- `socket.io-client` + `socket.io`
  - Reason: Real-time events for movement sync, rooms, and match state.
- `colyseus.js` + `colyseus` (alternative to socket.io)
  - Reason: Opinionated multiplayer framework with authoritative rooms.

## Quality / Tooling

- `typescript`
  - Reason: Safer refactors as game logic grows.
- `eslint` + `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin`
  - Reason: Keep code quality stable as files scale.
- `vitest`
  - Reason: Fast unit testing for game logic modules.
- `playwright`
  - Reason: End-to-end browser checks for input and rendering flow.

## Suggested install set for the next milestone

If you want to start the next step with a modern setup, install:

```bash
npm i three @dimforge/rapier3d-compat three-mesh-bvh lil-gui zustand howler
npm i -D vite typescript eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin vitest playwright
```
