// state.js — the match, in one object. Every module reads the same `state`: the phase machine
// (buy -> live -> planted -> end -> over), both teams' fighters with their money and kit, the
// breach charge, and a queue of events the HUD and sound layer drain each frame. Keeping it
// all here is what lets the bots, the player and the HUD never disagree about the score.

import { MATCH, WEAPONS } from './config.js';
import { SPAWNS, SITES } from './world.js';

let nextId = 1;

export function makeFighter(team, isPlayer) {
  return {
    id: nextId++, team, isPlayer: !!isPlayer,
    // body (physics.js fields)
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false, speed2d: 0,
    yaw: 0, pitch: 0,
    hp: 100, alive: true, kills: 0, deaths: 0,
    money: MATCH.startMoney,
    inv: { primary: null, sidearm: 'sparrow', armor: false, nades: { shard: 0, lumen: 0, veil: 0 } },
    ammo: {},                 // weapon key -> { mag, reserve }
    current: 'sidearm',       // 'primary' | 'sidearm' | 'shard' | 'lumen' | 'veil'
    lastSwitch: 'sidearm',
    fireT: 0,                 // seconds until the weapon may fire again
    reloadT: 0,               // seconds left of a reload, 0 = not reloading
    bloom: 0,                 // accumulated spread from firing, degrees
    channel: null,            // { kind: 'plant'|'defuse', t, need } while channelling
    hasCharge: false,
    flashedUntil: 0,          // sim-ms until which a flash has this fighter blinded
    bot: null,                // AI blackboard for bots, null for the player
    name: '',
  };
}

export function giveWeapon(f, key) {
  const def = WEAPONS[key];
  f.ammo[key] = { mag: def.mag, reserve: def.reserve };
  if (def.slot === 'primary') f.inv.primary = key; else f.inv.sidearm = key;
}

export function currentWeaponKey(f) {
  if (f.current === 'primary') return f.inv.primary;
  if (f.current === 'sidearm') return f.inv.sidearm;
  return f.current; // a grenade key
}

export function isGrenadeSlot(slot) {
  return slot === 'shard' || slot === 'lumen' || slot === 'veil';
}

export const state = {
  phase: 'buy',
  phaseT: MATCH.buySeconds,
  round: 1,
  score: { ember: 0, warden: 0 },
  fighters: [],
  player: null,
  nowMs: 0,
  events: [],
  noises: [],               // { x, z, radius, team } heard this step
  charge: null,             // { mode: 'carried'|'dropped'|'planted', carrier, x, z, site, fuseT }
  planSite: 'A',            // the Ember plan for the round, set at setup
  winner: null,
  over: false,
};

export function emit(type, data = {}) {
  state.events.push({ type, ...data });
}

export function reportNoise(x, z, radius, team) {
  state.noises.push({ x, z, radius, team });
}

export function teamFighters(team) {
  return state.fighters.filter((f) => f.team === team);
}

export function aliveCount(team) {
  return state.fighters.reduce((n, f) => n + (f.team === team && f.alive ? 1 : 0), 0);
}

export function siteAt(x, z) {
  for (const site of [SITES.A, SITES.B]) {
    if (x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ) return site;
  }
  return null;
}

// --- match flow ---------------------------------------------------------------

export function startMatch() {
  state.score.ember = 0;
  state.score.warden = 0;
  state.round = 1;
  state.over = false;
  state.winner = null;
  for (const f of state.fighters) {
    f.money = MATCH.startMoney;
    f.kills = 0; f.deaths = 0;
    resetLoadout(f);
  }
  setupRound();
}

function resetLoadout(f) {
  f.inv.primary = null;
  f.inv.sidearm = 'sparrow';
  f.inv.armor = false;
  f.inv.nades = { shard: 0, lumen: 0, veil: 0 };
  f.ammo = {};
  giveWeapon(f, 'sparrow');
  f.current = 'sidearm';
  f.lastSwitch = 'sidearm';
}

export function setupRound() {
  state.phase = 'buy';
  state.phaseT = MATCH.buySeconds;
  state.planSite = Math.random() < 0.5 ? 'A' : 'B';
  for (const team of ['ember', 'warden']) {
    const spawns = SPAWNS[team];
    teamFighters(team).forEach((f, i) => {
      const s = spawns[i % spawns.length];
      if (!f.alive) resetLoadout(f);       // the dead come back with a sidearm only
      f.x = s.x; f.z = s.z; f.y = 0;
      f.vx = f.vy = f.vz = 0;
      f.yaw = s.yaw; f.pitch = 0;
      f.hp = 100; f.alive = true; f.crouch = false;
      f.fireT = 0; f.reloadT = 0; f.bloom = 0; f.channel = null;
      f.hasCharge = false; f.flashedUntil = 0;
      if (f.bot) f.bot.resetForRound?.();
      // Survivors keep their kit but top the magazines back up between rounds.
      for (const key of Object.keys(f.ammo)) {
        f.ammo[key].mag = WEAPONS[key].mag;
        f.ammo[key].reserve = WEAPONS[key].reserve;
      }
    });
  }
  // The local player carries the charge: planting is the fun part, and a bot takes over
  // the job from the drop if the player falls.
  const carrier = state.player?.alive ? state.player : teamFighters('ember').find((f) => f.alive);
  if (carrier) carrier.hasCharge = true;
  state.charge = { mode: 'carried', carrier, x: 0, z: 0, site: null, fuseT: 0 };
  emit('roundStart', { round: state.round });
}

// --- damage and death -----------------------------------------------------------

export function damageFighter(target, rawDamage, attacker, part) {
  if (!target.alive || state.phase === 'end' || state.phase === 'over') return;
  let dmg = rawDamage;
  if (target.inv.armor) dmg *= part === 'head' ? 0.72 : 0.55;
  target.hp -= dmg;
  emit('damage', { target, attacker, part, dmg });
  if (target.hp > 0) return;
  target.hp = 0;
  target.alive = false;
  target.deaths++;
  target.channel = null;
  if (attacker && attacker !== target) {
    attacker.kills++;
    attacker.money = Math.min(MATCH.maxMoney, attacker.money + MATCH.killReward);
  }
  if (target.hasCharge) {
    target.hasCharge = false;
    state.charge = { mode: 'dropped', carrier: null, x: target.x, z: target.z, site: null, fuseT: 0 };
    emit('chargeDropped', { x: target.x, z: target.z });
  }
  emit('kill', { killer: attacker, victim: target, part });
  checkElimination();
}

function checkElimination() {
  if (state.phase !== 'live' && state.phase !== 'planted') return;
  const emberAlive = aliveCount('ember');
  const wardenAlive = aliveCount('warden');
  if (state.charge?.mode === 'planted') {
    if (wardenAlive === 0) endRound('ember', 'elimination');
    // Attackers all dead with the charge planted: the round plays on — the Wardens
    // must still defuse it, exactly as the real rules have it.
    return;
  }
  if (emberAlive === 0) endRound('warden', 'elimination');
  else if (wardenAlive === 0) endRound('ember', 'elimination');
}

// --- the charge -------------------------------------------------------------------

export function plantCharge(fighter, site) {
  fighter.hasCharge = false;
  state.charge = { mode: 'planted', carrier: null, x: fighter.x, z: fighter.z, site, fuseT: MATCH.chargeSeconds };
  state.phase = 'planted';
  fighter.money = Math.min(MATCH.maxMoney, fighter.money + MATCH.plantReward);
  emit('planted', { site, by: fighter });
}

export function defuseCharge(fighter) {
  state.charge.mode = 'defused';
  emit('defused', { by: fighter });
  endRound('warden', 'defused');
}

// --- round / match end ----------------------------------------------------------------

export function endRound(winner, reason) {
  if (state.phase === 'end' || state.phase === 'over') return;
  state.score[winner]++;
  const loser = winner === 'ember' ? 'warden' : 'ember';
  for (const f of state.fighters) {
    if (f.team === winner) f.money = Math.min(MATCH.maxMoney, f.money + MATCH.winReward);
    else {
      let pay = MATCH.lossReward;
      if (loser === 'ember' && state.charge?.mode === 'planted') pay += MATCH.plantedLossBonus;
      f.money = Math.min(MATCH.maxMoney, f.money + pay);
    }
    f.channel = null;
  }
  emit('roundEnd', { winner, reason, round: state.round });
  if (state.score[winner] >= MATCH.roundsToWin || state.round >= MATCH.maxRounds) {
    state.phase = 'over';
    state.winner = state.score.ember === state.score.warden
      ? (winner) : (state.score.ember > state.score.warden ? 'ember' : 'warden');
    emit('matchEnd', { winner: state.winner });
  } else {
    state.phase = 'end';
    state.phaseT = MATCH.endSeconds;
  }
}

// The per-step clock: phases count down, the fuse burns, and the round resolves itself.
export function updateMatch(dt) {
  state.nowMs += dt * 1000;
  if (state.phase === 'buy' || state.phase === 'live') {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      if (state.phase === 'buy') {
        state.phase = 'live';
        state.phaseT = MATCH.roundSeconds;
        emit('liveStart');
      } else {
        endRound('warden', 'time');
      }
    }
  } else if (state.phase === 'planted') {
    state.charge.fuseT -= dt;
    emit('fuseTick', { fuseT: state.charge.fuseT });
    if (state.charge.fuseT <= 0) {
      emit('detonate', { x: state.charge.x, z: state.charge.z });
      endRound('ember', 'detonation');
    }
  } else if (state.phase === 'end') {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      state.round++;
      setupRound();
    }
  }
}
