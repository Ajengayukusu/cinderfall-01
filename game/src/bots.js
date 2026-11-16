// bots.js — the nine fighters who are not you. Each bot runs the same loop: perceive (sight
// through the real colliders, hearing from the noise the guns report), decide (advance on a
// route, engage a seen enemy, work the objective), and act through the shared physics and
// weapon code — a bot's bullet is a player's bullet, with a human-ish reaction time and an
// aim error that settles the longer it tracks you.

import { MATCH } from './config.js';
import { moveBody, sightBlocked } from './physics.js';
import { state, plantCharge, defuseCharge, siteAt, emit } from './state.js';
import { tryFire, startReload, switchTo, buyItem, aimDir, eyePos } from './weapons.js';
import { pathFrom, nodePos } from './nav.js';
import { SITES, POSTS, smokeAt } from './world.js';

export function makeBot(f) {
  f.bot = {
    path: [], pathI: 0, goalNode: null, mode: 'advance',
    target: null, lastSeen: null, lastSeenAt: -1e9, visibleSince: 0,
    reactAt: 0, nextShotAt: 0, burst: 0, burstSize: 3,
    errYaw: 0, errPitch: 0, errAt: 0,
    strafeDir: 0, strafeUntil: 0, nextStrafeAt: 0,
    heardPos: null, heardAt: -1e9, postNode: null, scanPhase: Math.random() * 6,
    resetForRound() { resetBotRound(f); },
  };
  return f.bot;
}

// Round plans, made when state.setupRound resets each bot: the Wardens split across both
// sites and mid (they cannot know the plan), the Embers commit to the round's site.
function resetBotRound(f) {
  const b = f.bot;
  b.path = []; b.pathI = 0; b.target = null; b.lastSeen = null; b.heardPos = null;
  b.mode = 'advance'; b.burst = 0;
  botBuy(f);
  const mates = state.fighters.filter((x) => x.team === f.team && x.bot);
  const idx = mates.indexOf(f);
  if (f.team === 'warden') {
    const posts = [...POSTS.A, ...POSTS.B, ...POSTS.mid]; // siteA, link, main / siteB, approach, long / house
    const plan = ['siteA', 'siteB', 'house_e', 'a_link_door', 'b_long'];
    b.postNode = plan[idx % plan.length] ?? posts[idx % posts.length];
    b.goalNode = b.postNode;
  } else {
    b.postNode = state.planSite === 'A' ? 'siteA' : 'siteB';
    b.goalNode = b.postNode;
  }
  setGoal(f, b.goalNode);
}

function botBuy(f) {
  const m = f.money;
  if (!f.inv.primary) {
    if (m >= 5400 && (f.id + state.round) % 3 === 0) buyItem(f, 'longbow');
    else if (m >= 3350) { buyItem(f, 'kestrel'); }
    else if (m >= 1250) { buyItem(f, 'raptor'); }
    else if (m >= 1100) { buyItem(f, 'mule'); }
  }
  if (!f.inv.armor && f.inv.primary && f.money >= 650) buyItem(f, 'armor');
  if (f.money >= 1000) {
    if (f.team === 'ember') buyItem(f, 'shard');
    else buyItem(f, (f.id % 2 === 0) ? 'veil' : 'lumen');
  }
  if (f.inv.primary) switchTo(f, 'primary');
}

export function setGoal(f, nodeName) {
  const b = f.bot;
  b.goalNode = nodeName;
  const names = pathFrom(f.x, f.z, nodeName);
  b.path = names ? names.map((n) => nodePos(n)) : [];
  b.pathI = 0;
  // Skip a first node we are already closer to the second than to it.
  if (b.path.length > 1) {
    const [p0, p1] = b.path;
    const d0 = Math.hypot(p0.x - f.x, p0.z - f.z);
    const d1 = Math.hypot(p1.x - f.x, p1.z - f.z);
    if (d1 < d0) b.pathI = 1;
  }
}

// --- perception -------------------------------------------------------------------

function canSee(f, e, colliders) {
  if (!e.alive) return false;
  const fe = eyePos(f);
  const dx = e.x - f.x, dz = e.z - f.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 72) return false;
  if (dist > 4) {
    const look = aimDir(f.yaw, 0);
    if ((look.x * dx + look.z * dz) / (dist || 1) < 0.22) return false; // ~77 degree half-angle
  }
  const chestY = e.y + (e.crouch ? 0.95 : 1.25);
  if (sightBlocked(colliders, fe.x, fe.y, fe.z, e.x, chestY, e.z)) return false;
  const now = state.nowMs;
  if (smokeAt(fe.x, fe.z, now) || smokeAt(e.x, e.z, now)) return false;
  if (smokeAt((fe.x + e.x) / 2, (fe.z + e.z) / 2, now)) return false;
  return true;
}

function perceive(f, colliders) {
  const b = f.bot;
  const now = state.nowMs;
  let best = null, bestD = Infinity;
  if (now >= f.flashedUntil) {
    for (const e of state.fighters) {
      if (e.team === f.team || !e.alive) continue;
      if (canSee(f, e, colliders)) {
        const d = Math.hypot(e.x - f.x, e.z - f.z);
        if (d < bestD) { bestD = d; best = e; }
      }
    }
  }
  if (best) {
    if (b.target !== best) {
      b.target = best;
      b.visibleSince = now;
      const sniper = f.inv.primary === 'longbow';
      b.reactAt = now + 280 + Math.random() * 170 + (sniper ? 320 : 0);
      b.burst = 0;
    }
    b.lastSeen = { x: best.x, z: best.z };
    b.lastSeenAt = now;
  } else if (b.target && (!b.target.alive || now - b.lastSeenAt > 350)) {
    b.target = null;
  }
  // Hearing: fresh enemy noise inside its radius moves a bot that sees nothing.
  if (!b.target) {
    for (const n of state.noises) {
      if (n.team === f.team) continue;
      if (Math.hypot(n.x - f.x, n.z - f.z) < n.radius) {
        b.heardPos = { x: n.x, z: n.z };
        b.heardAt = now;
      }
    }
  }
}

// --- movement helpers ---------------------------------------------------------------

function steer(f, tx, tz, dt, colliders, speed) {
  const dx = tx - f.x, dz = tz - f.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) { moveBody(colliders, f, 0, 0, 0, dt, false); return 0; }
  moveBody(colliders, f, dx / dist, dz / dist, speed, dt, false);
  return dist;
}

function faceToward(f, tx, tz, dt, turnRate = 7) {
  const want = Math.atan2(-(tx - f.x), -(tz - f.z));
  turnTo(f, want, dt, turnRate);
}

function turnTo(f, wantYaw, dt, rate = 7) {
  let d = wantYaw - f.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, d));
  f.yaw += step;
}

// Follow the bot's node path; returns true when the path is finished.
function followPath(f, dt, colliders, speed) {
  const b = f.bot;
  if (b.pathI >= b.path.length) { moveBody(colliders, f, 0, 0, 0, dt, false); return true; }
  const p = b.path[b.pathI];
  faceToward(f, p.x, p.z, dt);
  const d = steer(f, p.x, p.z, dt, colliders, speed);
  if (d < 1.15) b.pathI++;
  return b.pathI >= b.path.length;
}

// --- combat ---------------------------------------------------------------------------

function engage(f, dt, colliders) {
  const b = f.bot;
  const t = b.target;
  const now = state.nowMs;
  const fe = eyePos(f);
  const dx = t.x - f.x, dz = t.z - f.z;
  const dist = Math.hypot(dx, dz);
  const wantYaw = Math.atan2(-dx, -dz);
  const wantPitch = Math.atan2((t.y + 1.12) - fe.y, dist);

  // Aim error decays while the target stays visible: the first snap is rough, a tracked
  // target gets shot properly. Offsets re-roll a few times a second.
  if (now > b.errAt) {
    const settled = Math.min(1, (now - b.visibleSince) / 900);
    const mag = 0.06 - 0.052 * settled;
    b.errYaw = (Math.random() * 2 - 1) * mag;
    b.errPitch = (Math.random() * 2 - 1) * mag * 0.7;
    b.errAt = now + 340;
  }
  turnTo(f, wantYaw + b.errYaw, dt, 8);
  f.pitch += ((wantPitch + b.errPitch) - f.pitch) * Math.min(1, dt * 9);

  // Movement: close the distance when far, plant and strafe when in range — a moving bot is
  // a hard target but a wild shot, and the spread model punishes it exactly as it does you.
  f.crouch = dist > 13 && f.speed2d < 0.4;
  if (dist > 17) {
    steer(f, t.x, t.z, dt, colliders, 3.6);
  } else {
    if (now > b.nextStrafeAt) {
      b.strafeDir = Math.random() < 0.5 ? -1 : 1;
      b.strafeUntil = now + 380 + Math.random() * 260;
      b.nextStrafeAt = now + 1300 + Math.random() * 1100;
    }
    if (now < b.strafeUntil) {
      const look = aimDir(f.yaw, 0);
      moveBody(colliders, f, -look.z * b.strafeDir, look.x * b.strafeDir, 2.4, dt, false);
    } else {
      moveBody(colliders, f, 0, 0, 0, dt, false);
    }
  }

  // Trigger discipline: reaction time first, then bursts with pauses between.
  const ammoKey = f.current === 'primary' ? f.inv.primary : f.inv.sidearm;
  if (ammoKey && f.ammo[ammoKey]?.mag === 0) startReload(f);
  if (now < b.reactAt || now < b.nextShotAt || f.reloadT > 0) return;
  let dy = (wantYaw - f.yaw);
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  if (Math.abs(dy) > 0.11) return;
  if (tryFire(f, colliders)) {
    b.burst++;
    const size = f.inv.primary === 'longbow' || !f.inv.primary ? 1 + (Math.random() * 2 | 0) : 3 + (Math.random() * 3 | 0);
    if (b.burst >= size) {
      b.burst = 0;
      b.nextShotAt = now + 230 + Math.random() * 330;
    }
  }
}

// --- the per-step bot -------------------------------------------------------------------

export function updateBot(f, dt, colliders) {
  const b = f.bot;
  if (!f.alive) return;
  if (state.phase === 'buy' || state.phase === 'end' || state.phase === 'over') {
    moveBody(colliders, f, 0, 0, 0, dt, false);
    return;
  }
  const now = state.nowMs;
  perceive(f, colliders);

  // Channelling (plant / defuse) owns the body until it lands or danger closes in.
  if (f.channel) {
    moveBody(colliders, f, 0, 0, 0, dt, false);
    f.crouch = true;
    if (b.target && Math.hypot(b.target.x - f.x, b.target.z - f.z) < 11) {
      f.channel = null; // fight first; the objective will wait
    } else {
      f.channel.t += dt;
      if (f.channel.t >= f.channel.need) {
        const kind = f.channel.kind;
        f.channel = null;
        if (kind === 'plant') {
          const site = siteAt(f.x, f.z);
          if (site) plantCharge(f, site);
        } else {
          defuseCharge(f);
        }
      }
      return;
    }
  }
  f.crouch = false;

  if (b.target) { engage(f, dt, colliders); return; }

  // Objective play.
  const charge = state.charge;
  if (state.phase === 'planted' && charge) {
    if (f.team === 'warden') {
      const d = Math.hypot(charge.x - f.x, charge.z - f.z);
      if (d < 1.7) {
        faceToward(f, charge.x, charge.z, dt);
        moveBody(colliders, f, 0, 0, 0, dt, false);
        f.channel = { kind: 'defuse', t: 0, need: MATCH.defuseSeconds };
        return;
      }
      const goal = charge.site.id === 'A' ? 'siteA' : 'siteB';
      if (b.goalNode !== goal) setGoal(f, goal);
      followPath(f, dt, colliders, 4.9);
      return;
    }
    // Embers defend the plant: fall back to a post near the site and hold.
    const goal = charge.site.id === 'A' ? 'a_link_door' : 'b_approach';
    if (b.goalNode !== goal && Math.hypot(f.x - charge.x, f.z - charge.z) > 7) setGoal(f, goal);
    if (!followPath(f, dt, colliders, 4.6)) return;
    holdPost(f, dt, colliders);
    return;
  }

  if (f.hasCharge && state.phase === 'live') {
    const site = SITES[state.planSite];
    if (siteAt(f.x, f.z) === site) {
      moveBody(colliders, f, 0, 0, 0, dt, false);
      f.channel = { kind: 'plant', t: 0, need: MATCH.plantSeconds };
      return;
    }
    if (b.goalNode !== b.postNode) setGoal(f, b.postNode);
    followPath(f, dt, colliders, 4.9);
    return;
  }

  if (charge?.mode === 'dropped' && f.team === 'ember') {
    const d = Math.hypot(charge.x - f.x, charge.z - f.z);
    // The nearest living Ember goes back for it; the rest press on.
    const nearer = state.fighters.some((x) => x.team === 'ember' && x.alive && !x.isPlayer && x !== f &&
      Math.hypot(charge.x - x.x, charge.z - x.z) < d);
    if (!nearer) {
      if (d < 1.25) {
        f.hasCharge = true;
        state.charge = { mode: 'carried', carrier: f, x: 0, z: 0, site: null, fuseT: 0 };
        emit('chargePickup', { by: f });
        setGoal(f, b.postNode);
        return;
      }
      faceToward(f, charge.x, charge.z, dt);
      steer(f, charge.x, charge.z, dt, colliders, 4.9);
      return;
    }
  }

  // Seek the last place an enemy was seen or heard, briefly, then fall back to the plan.
  const seekPos = (now - b.lastSeenAt < 3800 && b.lastSeen) ? b.lastSeen
    : (now - b.heardAt < 5000 && b.heardPos) ? b.heardPos : null;
  if (seekPos && Math.hypot(seekPos.x - f.x, seekPos.z - f.z) > 3.5) {
    faceToward(f, seekPos.x, seekPos.z, dt);
    steer(f, seekPos.x, seekPos.z, dt, colliders, 4.4);
    return;
  }

  // Default: travel the route to the assigned post, then hold it.
  if (!followPath(f, dt, colliders, 4.9)) return;
  holdPost(f, dt, colliders);
}

// Where a post watches: the lane the enemy must come down to reach it. A defender who
// stares at the wrong compass point is a free kill, so each post has its own threat point.
const POST_FACING = {
  siteA: [-21.5, -10.5],      // the Foundry's main door
  a_main_door: [-21.5, -4.2],
  a_link_door: [-2.5, -23],   // the link approach from mid
  siteB: [12, 22],            // between the Depot's two entries
  b_approach: [0, 11.5],
  b_long: [9, 16],
  house_e: [12, -18],
  top_mid: [2, -12],
  house_w: [-18, 24],
  mid_south: [0, -1],
};

// Attackers holding a taken site watch the other way: the retake comes from the Warden side.
const EMBER_WATCH = {
  siteA: [-8, -23], siteB: [30, 6], a_link_door: [-2.5, -23], b_approach: [30, 6],
};

// At a post: settle, scan the lane in slow sweeps, stay small.
function holdPost(f, dt, colliders) {
  const b = f.bot;
  moveBody(colliders, f, 0, 0, 0, dt, false);
  f.crouch = (f.id % 2 === 0);
  const watch = (f.team === 'ember' ? EMBER_WATCH[b.postNode] : POST_FACING[b.postNode])
    ?? (f.team === 'warden' ? [0, 10] : [26, -26]);
  const baseYaw = Math.atan2(-(watch[0] - f.x), -(watch[1] - f.z));
  turnTo(f, baseYaw + Math.sin(state.nowMs / 1600 + b.scanPhase) * 0.7, dt, 2.2);
  f.pitch *= 0.9;
}
