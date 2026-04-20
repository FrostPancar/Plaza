# Social Plaza Prototype (Three.js)

Playable scaffold for a shared-world 3D social plaza.

## Implemented

- Third-person capsule player controller (WASD, Shift run, Space jump)
- Smooth follow camera that auto-adapts to player turns
- Minimal open plaza scene (ground + sparse placeholder blocks/steps)
- Startup mask picker (8 abstract mask options)
- `E` action menu with modular placeholder action registry
- Upload pins for MP3/PDF/PNG/JPEG (up to 5MB each) placed at player location
- File pins with visual radius and floating file-type icons
- Left-click pin while inside radius to open file overlay
- MP3 pins auto-play while player is inside radius
- Music uploads and file pins persist locally between sessions
- `Document Self` action captures webcam photo and drops an image pin
- `Graffiti` action creates a graffiti pin radius for painting floors/walls
- Graffiti overlay with 4 paint colors appears while player is in graffiti radius
- Brush size slider for graffiti painting (same world-size brush on floors and walls)
- Graffiti drawings persist locally and reload on startup
- `Build` action creates a build zone for object placement
- Entering a build zone unlocks pointer/camera and opens bottom build palette
- Build palette includes 10 draggable 3D primitive shapes
- Drop shapes onto flat surfaces inside build zone radius
- Clicking a placed shape opens color + horizontal rotate controls
- In build radius, placed shapes can be repositioned by dragging them in-world
- Mouse movement controls third-person camera yaw/pitch (look up/down enabled)
- Camera enters locked mode while in graffiti/build radius
- Image pins render as live thumbnails in-world
- Action menu includes `Change Mask`
- Versioned persistence (`SaveDataV1`) in `localStorage`
- Live multiplayer first pass (single shared world over WebSocket)
- Nearby remote players rendered as capsules with selected mask
- Shared uploads/decor/graffiti pins replicated across connected clients

## Run

1. Install deps:

```bash
npm install
```

2. Start shared world server:

```bash
npm run serve:world
```

3. Start client host:

```bash
npm run serve:client
```

Open:

- `http://127.0.0.1:5173/`

Optional custom world socket:

- `http://127.0.0.1:5173/?ws=ws://127.0.0.1:8787`

## Controls

- `W A S D`: move
- `Shift`: run
- `Space`: jump
- Move mouse: rotate camera and look up/down
- Gameplay auto-enters hidden-mouse mode when possible
- `Esc`: return mouse cursor
- `E`: toggle action menu
- Action menu -> `Drop File`: upload local MP3/PDF/PNG/JPEG up to 5MB
- Action menu -> `Document Self`: capture webcam selfie and drop as image pin
- Action menu -> `Graffiti`: create a graffiti paint radius pin
- Action menu -> `Build`: create a build zone
- Action menu -> `Change Mask`: reopen mask selection
- Left-click a nearby pin to view/open its file
- In graffiti radius, hold left-click to draw; use bottom-left color palette and brush size slider
- In build radius, drag a shape from bottom palette into world; click placed shape to recolor or rotate
- While in build radius, click-drag a placed shape on world surfaces to move it
- Image pins render as rounded thumbnails; audio pins use a mac-style folder icon

## Key Files

- `src/main.js` - app bootstrap + game loop wiring
- `src/game/*` - player, camera, plaza, input, mask texture generation
- `src/ui/*` - mask selection and action menu UIs
- `src/core/*` - persistence and network scaffolding
- `src/config/*` - mask definitions and action registry
