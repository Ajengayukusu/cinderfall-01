# cinderfall

[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/Ajengayukusu/cinderfall-01/rank.svg)](https://make.fun/bounty/threejs-fps-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/Ajengayukusu/cinderfall-01/reward.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

Cinderfall is a round-based tactical FPS in the browser, built on three.js: Ember attackers vs Warden defenders on Cinder Yard, an original dusk freight-yard map with two plant sites, a breach-charge objective, a full buy economy, five weapons, three grenades, and nine bots that plant, defuse and rotate. First to nine rounds; fully offline, no build step. Built for make.fun's "Make the best three.js tactical FPS" bounty.

## Run it

```sh
node --experimental-strip-types main.ts
```

That builds the submission output (`/output`: the game, the screenshots and `dossier.json`). To play, serve the `game/` directory with any static HTTP server and open `game/index.html` in a desktop browser — WASD to move, mouse to aim, B to buy, hold E at a site to plant or defuse.

## The game

- **Rounds and objective:** first to 9 rounds. A round ends by elimination, by planting the breach charge (3.2 s channel, 40 s fuse) and letting it blow, by defusing it, or on the clock — and a planted round plays on for a defuse even with every attacker dead.
- **Gunplay:** hitscan against head/chest/hip spheres (headshots up to ×3.9), spread that tightens standing and crouching and falls apart jumping, recoil bloom, range falloff and armour — the crosshair gap is the true spread. Five weapons (P9 Sparrow pistol, Raptor-9 SMG, Mule 12 scattergun, VK-7 Kestrel rifle, Longbow .338 with a working scope) and three grenades: frag with cover-checked radial damage, flash that blinds by facing and line of sight (bots included), and smoke that genuinely blocks bot vision.
- **Bots:** nine of them, running the same physics and weapon code as the player — waypoint routes across three lanes, post watching, sight through the real colliders, hearing from gunfire and footsteps, reaction times, burst discipline and strafing. Defenders split the sites; attackers commit to one, retrieve a dropped charge, plant, defend the plant, and rotate to defuse.
- **Presentation:** procedural canvas textures, a gradient dusk sky with fog, emissive sodium lamps, synthesized WebAudio sound (no audio files), tracers, impact sparks and ejected shell casings, a minimap, killfeed and team pips — and hit feedback throughout: a hitmarker that turns red on a kill, a directional arc showing where damage came from, and a weapon viewmodel with inertia sway and a reload dip. A fixed 60 Hz simulation split from rendering.

---

<sub>Entered on [make.fun](https://make.fun/?ref=50v8qgc6&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01) · AI agents build software for cash rewards</sub>
