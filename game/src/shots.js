// shots.js — the staged frames the screenshots are taken from. Each scene arranges a real
// moment of the game (the same state the simulation plays in, posed) so a headless browser
// can capture it deterministically: ?shot=cover|buy|combat|roundwin&seed=N. Nothing here is
// a mock-up screen — it is the live game, frozen mid-breath.

import { state, giveWeapon } from './state.js';
import { switchTo } from './weapons.js';
import { setBuyOpen, hideBanner, hudEvent, showDamageFrom } from './hud.js';
import { SITES } from './world.js';

function stage(f, x, z, yaw) {
  f.x = x; f.z = z; f.y = 0; f.yaw = yaw; f.pitch = 0;
  f.vx = f.vy = f.vz = 0;
  if (f.bot) { f.bot.path = []; f.bot.pathI = 0; }
}

function botsOf(team) {
  return state.fighters.filter((f) => f.team === team && !f.isPlayer);
}

function kitPlayer(weapon, money) {
  const p = state.player;
  if (weapon) { giveWeapon(p, weapon); switchTo(p, 'primary'); }
  p.inv.armor = true;
  if (money !== undefined) p.money = money;
  return p;
}

// Returns how the capture should run: sim steps to settle, and steps on which the player fires.
export function setupShot(name) {
  const p = state.player;
  hideBanner();
  if (name === 'buy') {
    p.money = 5400;
    state.phaseT = 9.4;
    stage(p, -27, 27, -0.85);
    setBuyOpen(true); // re-render the menu at the staged balance
    return { steps: 2, fireAt: [] };
  }
  setBuyOpen(false);
  state.phase = 'live';

  if (name === 'cover') {
    // The wide read of the yard: mid house and the long container below, the Depot's
    // sodium lamp ahead, two Embers already pushing up the lane in front of the player.
    state.phaseT = 84;
    kitPlayer('kestrel');
    stage(p, -18, 27, -0.72);
    const embers = botsOf('ember');
    stage(embers[0], -8.5, 20.5, -0.85);
    stage(embers[1], -3.5, 24.5, -0.6);
    giveWeapon(embers[0], 'kestrel'); switchTo(embers[0], 'primary');
    return { steps: 8, fireAt: [] };
  }

  if (name === 'combat') {
    state.phaseT = 63;
    kitPlayer('kestrel');
    p.hp = 74;
    p.ammo.kestrel.mag = 17;
    stage(p, 7.4, -0.6, -1.28);
    const wardens = botsOf('warden');
    stage(wardens[0], 17, -3.5, 2.2);
    stage(wardens[1], 21.5, 2.5, 2.6);
    giveWeapon(wardens[0], 'kestrel'); switchTo(wardens[0], 'primary');
    const embers = botsOf('ember');
    stage(embers[0], 6.0, 2.2, -1.1);
    // Incoming fire has a source: light the damage-direction arc from the near Warden,
    // and let the last staged step be a shot, so its tracer and muzzle flash are still
    // alive in the frozen frame.
    showDamageFrom(wardens[0].x, wardens[0].z);
    return { steps: 30, fireAt: [16, 27] };
  }

  if (name === 'roundwin') {
    // The round just ended at the Depot: the charge sits planted and blinking, the last
    // Wardens are down around it, and the banner carries the result and the match score.
    // Every element is real state — the phase machine in 'end', the score, the killfeed
    // rows and the banner all arrive through the same events a played round produces.
    state.phase = 'end';
    state.phaseT = 4.6;
    state.round = 12;
    state.score.ember = 7;
    state.score.warden = 5;
    state.planSite = 'B';
    kitPlayer('kestrel');
    p.ammo.kestrel.mag = 21;
    p.money = 4350;
    p.hasCharge = false; // the charge is the planted one in the site, not on the player's back
    stage(p, 19.3, 19.6, -2.44);
    state.charge = {
      mode: 'planted', carrier: null, x: 22.9, z: 23.9, site: SITES.B, fuseT: 14,
    };
    const wardens = botsOf('warden');
    stage(wardens[0], 23.4, 25.2, 0.8);
    stage(wardens[1], 20.6, 25.8, 2.4);
    for (const w of wardens) { w.alive = false; w.hp = 0; }
    const embers = botsOf('ember');
    stage(embers[0], 17.4, 22.6, -2.2);
    giveWeapon(embers[0], 'kestrel'); switchTo(embers[0], 'primary');
    stage(embers[1], 26.2, 18.9, 2.9);
    // The killfeed rows and the banner are real-time DOM (they fade on wall-clock
    // timers), so they are raised in late() — after the staged renders, just before the
    // capture — rather than here, where a slow first render could outlive them.
    return {
      steps: 2, fireAt: [],
      late() {
        hudEvent({ type: 'kill', killer: embers[0], victim: wardens[1], part: 'chest' });
        hudEvent({ type: 'kill', killer: p, victim: wardens[0], part: 'head' });
        hudEvent({ type: 'roundEnd', winner: 'ember', reason: 'elimination' });
      },
    };
  }

  return { steps: 2, fireAt: [] };
}
