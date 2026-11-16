// physics.js — the shared body simulation and ray tests. The player and every bot move through
// the same code path, so a corner that stops one stops all, and a shot is tested against the
// same boxes the renderer draws. Colliders are axis-aligned boxes standing on the ground:
// { minX, maxX, minZ, maxZ, top } with their base at y = 0.

import { BODY } from './config.js';

const STEP_UP = 0.32;      // a collider this far below the feet is floor, not a wall

// The floor height under a point: the highest collider top the body may stand on, or 0 for the
// yard itself. A top counts only when it is within step-up reach of the body's current feet,
// which is what lets a jump land on a crate but never on a container.
export function groundHeightAt(colliders, x, z, feetY) {
  let ground = 0;
  for (const c of colliders) {
    if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
    if (c.top <= feetY + STEP_UP && c.top > ground) ground = c.top;
  }
  return ground;
}

function hitsWall(colliders, x, z, feetY, height) {
  for (const c of colliders) {
    if (c.top <= feetY + STEP_UP) continue;          // standing on it, or stepping onto it
    if (c.base !== undefined && c.base >= feetY + height) continue; // overhead, never met
    if (x > c.minX - BODY.radius && x < c.maxX + BODY.radius &&
        z > c.minZ - BODY.radius && z < c.maxZ + BODY.radius) return true;
  }
  return false;
}

// Advance one body by dt. wishX/wishZ is a unit wish direction in world space, speed the
// current cap. Axis-separated resolution: slide along walls instead of sticking to them.
export function moveBody(colliders, body, wishX, wishZ, speed, dt, wantJump) {
  const onGround = body.onGround;
  const accel = onGround ? BODY.accel : BODY.airAccel;

  // Accelerate toward the wish velocity, with friction when no direction is wished.
  const wishVx = wishX * speed, wishVz = wishZ * speed;
  if (wishX === 0 && wishZ === 0) {
    if (onGround) {
      const drop = Math.max(0, 1 - BODY.friction * dt);
      body.vx *= drop; body.vz *= drop;
      if (Math.abs(body.vx) < 0.02) body.vx = 0;
      if (Math.abs(body.vz) < 0.02) body.vz = 0;
    }
  } else {
    body.vx += (wishVx - body.vx) * Math.min(1, accel * dt / Math.max(speed, 0.001) * 3.2);
    body.vz += (wishVz - body.vz) * Math.min(1, accel * dt / Math.max(speed, 0.001) * 3.2);
    const sp = Math.hypot(body.vx, body.vz);
    if (sp > speed) { body.vx = body.vx / sp * speed; body.vz = body.vz / sp * speed; }
  }

  if (wantJump && onGround) { body.vy = BODY.jumpVel; body.onGround = false; }
  body.vy -= BODY.gravity * dt;
  if (body.vy < -28) body.vy = -28;

  const height = body.crouch ? BODY.crouchHeight : BODY.standHeight;
  const nx = body.x + body.vx * dt;
  if (!hitsWall(colliders, nx, body.z, body.y, height)) body.x = nx; else body.vx = 0;
  const nz = body.z + body.vz * dt;
  if (!hitsWall(colliders, body.x, nz, body.y, height)) body.z = nz; else body.vz = 0;

  body.y += body.vy * dt;
  const ground = groundHeightAt(colliders, body.x, body.z, body.y);
  if (body.y <= ground) {
    body.y = ground;
    body.vy = 0;
    body.onGround = true;
  } else if (body.y > ground + 0.02) {
    body.onGround = false;
  }
  body.speed2d = Math.hypot(body.vx, body.vz);
}

// Segment vs the sight-blocking colliders, in the XZ plane with a height test at the crossing:
// a box blocks when its top rises above the line's height where they meet. Used for bot vision.
export function sightBlocked(colliders, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dz = bz - az;
  for (const c of colliders) {
    if (!c.blocksSight) continue;
    // Slab test in 2D.
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) { if (ax < c.minX || ax > c.maxX) continue; }
    else {
      let ta = (c.minX - ax) / dx, tb = (c.maxX - ax) / dx;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (az < c.minZ || az > c.maxZ) continue; }
    else {
      let ta = (c.minZ - az) / dz, tb = (c.maxZ - az) / dz;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    const yAt = ay + (by - ay) * Math.max(t0, 0.001);
    if (yAt < c.top) return true;
  }
  return false;
}

// Ray vs one box (slab method, full 3D). Returns entry distance or Infinity.
function rayBox(ox, oy, oz, dx, dy, dz, c) {
  const base = c.base ?? 0;
  let tmin = 0, tmax = Infinity;
  const axes = [
    [ox, dx, c.minX, c.maxX],
    [oy, dy, base, c.top],
    [oz, dz, c.minZ, c.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
    let ta = (lo - o) / d, tb = (hi - o) / d;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    tmin = Math.max(tmin, ta); tmax = Math.min(tmax, tb);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// Cast a shot: the nearest of the map boxes, the ground plane and every living body part.
// Bodies are three spheres — head, chest, hips — which reads honestly at FPS ranges and keeps
// the head clearly the most valuable target. Returns { dist, part, ent } or null.
export function castShot(colliders, bodies, ox, oy, oz, dx, dy, dz, maxDist, ignore) {
  let best = maxDist, hitEnt = null, hitPart = null;

  for (const c of colliders) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, c);
    if (t < best) { best = t; hitEnt = null; hitPart = 'world'; }
  }
  if (dy < -1e-6) {
    const t = -oy / dy;
    if (t > 0 && t < best) { best = t; hitEnt = null; hitPart = 'world'; }
  }
  for (const b of bodies) {
    if (!b.alive || b === ignore) continue;
    const crouch = b.crouch;
    const headY = b.y + (crouch ? 1.24 : 1.64);
    const chestY = b.y + (crouch ? 0.92 : 1.22);
    const hipY = b.y + (crouch ? 0.55 : 0.78);
    let t = raySphere(ox, oy, oz, dx, dy, dz, b.x, headY, b.z, 0.21);
    if (t < best) { best = t; hitEnt = b; hitPart = 'head'; continue; }
    t = raySphere(ox, oy, oz, dx, dy, dz, b.x, chestY, b.z, 0.35);
    if (t < best) { best = t; hitEnt = b; hitPart = 'chest'; continue; }
    t = raySphere(ox, oy, oz, dx, dy, dz, b.x, hipY, b.z, 0.31);
    if (t < best) { best = t; hitEnt = b; hitPart = 'hips'; }
  }
  if (hitPart === null) return null;
  return {
    dist: best, part: hitPart, ent: hitEnt,
    x: ox + dx * best, y: oy + dy * best, z: oz + dz * best,
  };
}
