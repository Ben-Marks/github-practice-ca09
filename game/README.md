# Flame Out

A cartoon pull-the-pin puzzle game. Swipe the gold pins so the water reaches the fire.
Lava makes the fire bigger, water turns lava into stone, and rocks sink, fill holes and push liquids around.

- Levels 1–5: water and lava
- Levels 6–10: rocks as well

## Play it

Open `dist/flame-out.html` in any browser (phone or computer). It is one file, nothing to install.

## Files

- `game/engine.js` – the particle simulation (water, lava, stone, rocks, pins, fire)
- `game/levels.js` – the 10 levels
- `game/game.js` – drawing, touch controls, sounds and menus
- `game/index.html` – page layout and styles
- `tools/sim.js` – plays every level automatically to prove it can be won and its traps lose (`node tools/sim.js`)
- `tools/build.js` – bundles everything into `dist/` (`node tools/build.js`)
