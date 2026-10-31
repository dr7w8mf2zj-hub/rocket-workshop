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
- `tools/gen_textures_v2.py` – regenerates every texture at higher detail into `assets/rocket parts textures/` (+ half-res `assets/rocket parts textures mobile/` used on phones / low quality); `tools/gen_textures_v1.py` made the originals, which are kept untouched in `assets/old rocket parts textures/` (numpy + Pillow)
- `admin.html`, `js/admin.js`, `js/adminbridge.js` – passcode-gated admin/debug console on its own page (not linked from the game). It talks to the game open in another tab of the *same browser* via BroadcastChannel; client-side only (not real security) and no cross-device control
- `tests/` – node/Playwright test scripts (physics headless, browser smoke tests)

## Controls
Workshop: drag parts from the list; Del delete; Ctrl+Z / Ctrl+Y undo/redo; Ctrl+D duplicate; F frame; N toggle nodes; right/shift-drag pan; wheel zoom.
Flight: W/S pitch, A/D yaw, Q/E roll, Shift/Ctrl throttle (also ↑/↓), Z full, X cut, Space countdown/stage, P parachutes, T SAS, R RCS, M engines on/off, G legs, C camera, Esc pause.
Touch: joystick (pitch/yaw), ⟲ ⟳ roll, throttle slider, STAGE, SAS/RCS/ENG/LEG/chute/camera buttons.

## Examples & new in v2
Examples (workshop → Examples…): Falcon 9 (Dragon, landing booster), Falcon 9 (fairing), Starship (Super Heavy + Ship) at reduced scale, plus the earlier Lark/Atlas/Titan/Pocket Hopper. Booster stages auto-land (suicide burn) on legs; press Tab to switch vehicle.
New parts: engine clusters (Merlin / Raptor / Raptor-Vac), steel tank/body/nose, grid fins (deployable, steerable), control flaps, landing legs, interstage, avionics ring, capsule, fairing. Advanced parts unlock at 3 km altitude.
Extra flight keys: F fins stow/deploy, L booster auto-land, V SAS mode, Tab switch vehicle. Touch: MODE / FIN / LAND / ⇄ buttons; drag a part from the grip in the inventory or long-press it.
Symmetric copies are linked (edit/paint/delete one → all); toggle the link in the toolbar.
