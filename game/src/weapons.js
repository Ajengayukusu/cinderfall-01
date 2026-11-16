// weapons.js — gunfire, grenades and shopping. One firing path serves the player and the
// bots: a shot is a spread cone around the shooter's aim, tested by physics.castShot against
// the same bodies and boxes the renderer draws, with damage that falls off past the weapon's
// range and a head worth several bodies. Grenades are small simulated projectiles — thrown,
// bounced, fused — never scripted effects.

import { WEAPONS, GRENADES, ECONOMY } from './config.js';
import { castShot, sightBlocked } from './physics.js';
import { state, damageFighter, currentWeaponKey, isGrenadeSlot, reportNoise, emit, giveWeapon } from './state.js';
import { spawnTracer, spawnImpact, spawnMuzzle, spawnExplosion, spawnSmokeCloud, spawnCasing } from './effects.js';
import * as SFX from './audio.js';

export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function eyePos(f) {
  return { x: f.x, y: f.y + (f.crouch ? 1.18 : 1.62), z: f.z };
}

// Spread in degrees for the shooter's current stance: the heart of the gunplay. Standing
// still is several times tighter than running, and jumping is hopeless — stopping to aim pays.
export function spreadFor(f, def) {
  let base = def.spreadStand;
  if (!f.onGround) base = def.spreadAir;
  else if (f.speed2d > 1.2) base = def.spreadMove;
  else if (f.crouch) base = def.spreadStand * 0.72;
  return base + f.bloom;
}

function jitterDir(dir, spreadDeg, rng) {
  const s = spreadDeg * Math.PI / 180;
  const a1 = (rng() + rng() - 1) * s, a2 = (rng() + rng() - 1) * s;
  // Orthonormal basis around dir.
  let rx = -dir.z, rz = dir.x;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  const ux = rz * dir.y, uy = rz * dir.x - rx * dir.z, uz = -rx * dir.y;
  let x = dir.x + rx * a1 + ux * a2;
  let y = dir.y + a2 * 0.9;
  let z = dir.z + rz * a1 + uz * a2;
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

const NOISE_RADIUS = { pistol: 26, smg: 30, shotgun: 34, rifle: 36, sniper: 48 };

// Fire one trigger pull. Returns true when a shot actually left the barrel.
export function tryFire(f, colliders, rng = Math.random) {
  const key = currentWeaponKey(f);
  if (!key || isGrenadeSlot(f.current) || f.reloadT > 0 || f.fireT > 0 || f.channel) return false;
  const def = WEAPONS[key];
  const ammo = f.ammo[key];
  if (!ammo || ammo.mag <= 0) { startReload(f); return false; }
  ammo.mag--;
  f.fireT = 60 / def.rpm;
  f.bloom = Math.min(3.2, f.bloom + def.recoil * 0.34);
  f.kick = (f.kick ?? 0) + def.recoil;

  const eye = eyePos(f);
  const base = aimDir(f.yaw, f.pitch);
  const spread = spreadFor(f, def);
  const bodies = state.fighters;
  const muzzle = {
    x: eye.x + base.x * 0.55, y: eye.y - 0.14 + base.y * 0.55, z: eye.z + base.z * 0.55,
  };
  // The spent casing leaves the ejection port, to the shooter's right of the receiver.
  const rightX = Math.cos(f.yaw), rightZ = -Math.sin(f.yaw);
  if (f.isPlayer) {
    // The flash billboard sits at the viewmodel's muzzle — right, low and forward of the
    // eye — not on the view axis, where it would white the screen out.
    spawnMuzzle(muzzle.x, muzzle.y, muzzle.z, state.nowMs,
      eye.x + base.x * 0.85 + rightX * 0.3, eye.y - 0.24, eye.z + base.z * 0.85 + rightZ * 0.3);
  }
  spawnCasing(
    eye.x + rightX * 0.17 + base.x * 0.22, eye.y - 0.1, eye.z + rightZ * 0.17 + base.z * 0.22,
    rightX, rightZ, state.nowMs);
  for (let p = 0; p < def.pellets; p++) {
    const dir = jitterDir(base, spread, rng);
    const hit = castShot(colliders, bodies, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 220, f);
    const end = hit
      ? { x: hit.x, y: hit.y, z: hit.z }
      : { x: eye.x + dir.x * 220, y: eye.y + dir.y * 220, z: eye.z + dir.z * 220 };
    spawnTracer(muzzle.x, muzzle.y, muzzle.z, end.x, end.y, end.z, state.nowMs);
    if (!hit) continue;
    if (hit.ent) {
      let dmg = def.damage * (hit.part === 'head' ? def.headMult : hit.part === 'hips' ? 0.8 : 1);
      if (hit.dist > def.range) dmg *= Math.max(0.3, 1 - (hit.dist - def.range) * 0.012);
      spawnImpact(hit.x, hit.y, hit.z, 'hit', 6);
      if (hit.ent.team !== f.team) damageFighter(hit.ent, dmg, f, hit.part);
    } else {
      spawnImpact(hit.x, hit.y, hit.z, 'world', 5);
    }
  }
  const distToPlayer = state.player
    ? Math.hypot(f.x - state.player.x, f.z - state.player.z) : 0;
  SFX.sfxShot(f.isPlayer ? 0 : distToPlayer, def.kind);
  reportNoise(f.x, f.z, NOISE_RADIUS[def.kind] ?? 32, f.team);
  if (ammo.mag === 0) startReload(f);
  return true;
}

export function startReload(f) {
  const key = currentWeaponKey(f);
  if (!key || isGrenadeSlot(f.current) || f.reloadT > 0) return;
  const ammo = f.ammo[key];
  if (!ammo || ammo.reserve <= 0 || ammo.mag >= WEAPONS[key].mag) return;
  f.reloadT = WEAPONS[key].reloadMs / 1000;
  if (f.isPlayer) SFX.sfxReload();
}

export function switchTo(f, slot) {
  if (slot === 'primary' && !f.inv.primary) return false;
  if (isGrenadeSlot(slot) && f.inv.nades[slot] <= 0) return false;
  if (f.current !== slot) f.lastSwitch = f.current;
  f.current = slot;
  f.reloadT = 0;
  f.fireT = Math.max(f.fireT, 0.22);
  return true;
}

// Per-step weapon housekeeping: fire timers, reload completion, bloom recovery.
export function updateWeapons(f, dt) {
  if (f.fireT > 0) f.fireT -= dt;
  f.bloom = Math.max(0, f.bloom - dt * 2.6);
  if (f.kick) f.kick = Math.max(0, f.kick - dt * 7);
  if (f.reloadT > 0) {
    f.reloadT -= dt;
    if (f.reloadT <= 0) {
      const key = currentWeaponKey(f);
      const ammo = f.ammo[key];
      if (ammo) {
        const need = WEAPONS[key].mag - ammo.mag;
        const take = Math.min(need, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
      }
    }
  }
}

// --- grenades -------------------------------------------------------------------

const liveGrenades = [];

export function throwGrenade(f, kind) {
  if (f.inv.nades[kind] <= 0 || f.channel) return false;
  f.inv.nades[kind]--;
  const eye = eyePos(f);
  const dir = aimDir(f.yaw, f.pitch + 0.06);
  liveGrenades.push({
    kind, team: f.team, owner: f,
    x: eye.x + dir.x * 0.4, y: eye.y, z: eye.z + dir.z * 0.4,
    vx: dir.x * 15 + f.vx * 0.5, vy: dir.y * 15 + 2.2, vz: dir.z * 15 + f.vz * 0.5,
    fuseAt: state.nowMs + GRENADES[kind].fuseMs,
    mesh: null,
  });
  if (f.isPlayer) SFX.sfxThrow();
  switchTo(f, f.inv.primary ? 'primary' : 'sidearm');
  return true;
}

function detonate(g, colliders) {
  const def = GRENADES[g.kind];
  if (g.kind === 'veil') {
    spawnSmokeCloud(g.x, g.z, def.radius, def.durationMs, state.nowMs);
    return;
  }
  if (g.kind === 'lumen') {
    spawnExplosion(g.x, g.y + 0.3, g.z, 0.8, state.nowMs);
    SFX.sfxFlash();
    for (const f of state.fighters) {
      if (!f.alive) continue;
      const eye = eyePos(f);
      const d = Math.hypot(f.x - g.x, f.z - g.z);
      if (d > def.radius) continue;
      if (sightBlocked(colliders, g.x, g.y + 0.4, g.z, eye.x, eye.y, eye.z)) continue;
      // Looking at the pop is what blinds: full effect facing it, a blink from behind.
      const look = aimDir(f.yaw, f.pitch);
      const toG = { x: (g.x - eye.x), y: 0, z: (g.z - eye.z) };
      const tl = Math.hypot(toG.x, toG.z) || 1;
      const facing = (look.x * toG.x + look.z * toG.z) / tl;
      const closeness = 1 - d / def.radius;
      const strength = facing > 0.25
        ? 0.35 + 0.65 * closeness * Math.min(1, (facing + 0.4))
        : 0.18 * closeness;
      if (f.isPlayer) emit('flashPlayer', { strength });
      else f.flashedUntil = Math.max(f.flashedUntil, state.nowMs + strength * 2800);
    }
    return;
  }
  // shard frag: radial damage, checked against cover.
  spawnExplosion(g.x, g.y + 0.25, g.z, 1.6, state.nowMs);
  const distToPlayer = state.player ? Math.hypot(g.x - state.player.x, g.z - state.player.z) : 99;
  if (distToPlayer < 16) SFX.sfxExplosion(false);
  for (const f of state.fighters) {
    if (!f.alive) continue;
    const d = Math.hypot(f.x - g.x, f.y + 0.6 - g.y, f.z - g.z);
    if (d > def.radius) continue;
    if (sightBlocked(colliders, g.x, g.y + 0.4, g.z, f.x, f.y + 1, f.z)) continue;
    const dmg = def.damage * Math.max(0.12, 1 - d / (def.radius * 1.15));
    damageFighter(f, dmg, g.owner === f ? null : g.owner, 'chest');
  }
  reportNoise(g.x, g.z, 30, g.team);
}

export function updateGrenades(dt, colliders, meshSync) {
  for (let i = liveGrenades.length - 1; i >= 0; i--) {
    const g = liveGrenades[i];
    if (state.nowMs >= g.fuseAt) {
      detonate(g, colliders);
      if (g.mesh) meshSync.remove(g);
      liveGrenades.splice(i, 1);
      continue;
    }
    g.vy -= 11 * dt;
    let nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
    // Bounce off box sides by testing the new point against the colliders.
    for (const c of colliders) {
      if (nx > c.minX - 0.08 && nx < c.maxX + 0.08 && nz > c.minZ - 0.08 && nz < c.maxZ + 0.08 && ny < c.top && ny > (c.base ?? 0) - 0.1) {
        if (g.x <= c.minX - 0.08 || g.x >= c.maxX + 0.08) g.vx *= -0.42;
        else if (g.z <= c.minZ - 0.08 || g.z >= c.maxZ + 0.08) g.vz *= -0.42;
        else g.vy = Math.abs(g.vy) * 0.4;
        nx = g.x + g.vx * dt; ny = g.y + g.vy * dt; nz = g.z + g.vz * dt;
      }
    }
    if (ny < 0.09) {
      ny = 0.09;
      g.vy = Math.abs(g.vy) > 1.4 ? -g.vy * 0.38 : 0;
      g.vx *= 0.72; g.vz *= 0.72;
      if (Math.abs(g.vx) < 0.2 && Math.abs(g.vz) < 0.2) { g.vx = 0; g.vz = 0; }
    }
    g.x = nx; g.y = ny; g.z = nz;
    meshSync.update(g);
  }
}

export function clearGrenades(meshSync) {
  for (const g of liveGrenades) if (g.mesh) meshSync.remove(g);
  liveGrenades.length = 0;
}

// --- the buy menu -----------------------------------------------------------------

export function buyItem(f, item) {
  if (item === 'armor') {
    if (f.inv.armor || f.money < ECONOMY.armorPrice) return false;
    f.money -= ECONOMY.armorPrice;
    f.inv.armor = true;
    return true;
  }
  if (GRENADES[item]) {
    const cap = item === 'veil' ? 1 : 2;
    if (f.inv.nades[item] >= cap || f.money < GRENADES[item].price) return false;
    f.money -= GRENADES[item].price;
    f.inv.nades[item]++;
    return true;
  }
  const def = WEAPONS[item];
  if (!def) return false;
  if (f.inv.primary === item || f.money < def.price) return false;
  f.money -= def.price;
  // Buying a primary replaces the old one, as at a real buy menu.
  giveWeapon(f, item);
  return true;
}
