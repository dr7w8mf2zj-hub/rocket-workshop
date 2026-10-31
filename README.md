# 🚀 Rocket Workshop

Browser-based 3D rocket building and launch simulator (Three.js + custom rigid-body physics). Works on desktop (mouse + keyboard) and phones (touch).

Run locally (any static server; ES modules need http, not file://):

    python3 -m http.server 8000      # then open http://localhost:8000/

## Structure
- `index.html`, `css/style.css` – UI shell (responsive; touch HUD on coarse pointers)
- `js/registry.js` – component registry: model, texture, material defaults, attachment nodes, mass, thrust, fuel, ...
- `js/textures.js` – loads the real PNG files in `assets/rocket parts textures/` (+ `assets/environment/`)
- `js/models.js` – independent procedural 3D model per part, cloned materials per part, decals/markings
- `js/design.js` – assembly model (links, stages, validation, stability, JSON), undo/redo `History`
- `js/construction.js` – workshop viewport: drag & drop, snapping, selection, editing operations
- `js/physics.js` – fixed-timestep rigid-body physics (gravity vs altitude, thrust/Isp, fuel flow, mass/inertia, drag, aero stability, torque, contacts, staging, parachutes, heating)
- `js/flight.js`, `js/effects.js`, `js/world.js`, `js/terrain.js` – flight scene, particles/flames/shake, sky/terrain/clouds/pad
- `js/controls.js`, `js/ui.js`, `js/storage.js`, `js/main.js`
- `tools/gen_textures.py` – regenerates every PNG procedurally (`python3 tools/gen_textures.py`, needs numpy + Pillow)
- `tests/` – node/Playwright test scripts (physics headless, browser smoke tests)

## Controls
Workshop: drag parts from the list; Del delete; Ctrl+Z / Ctrl+Y undo/redo; Ctrl+D duplicate; F frame; N toggle nodes; right/shift-drag pan; wheel zoom.
Flight: W/S pitch, A/D yaw, Q/E roll, Shift/Ctrl throttle (also ↑/↓), Z full, X cut, Space countdown/stage, P parachutes, T SAS, R RCS, M engines on/off, G legs, C camera, Esc pause.
Touch: joystick (pitch/yaw), ⟲ ⟳ roll, throttle slider, STAGE, SAS/RCS/ENG/LEG/chute/camera buttons.
