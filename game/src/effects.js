// effects.js — the visual feedback layer: tracers, muzzle flashes, impact bursts, grenade
// smoke and explosions. Everything is pooled and reused — the pools are built once at boot and
// the per-frame update only moves numbers, because a firefight is exactly when allocation
// spikes would stutter the render loop.

import * as THREE from 'three';
import { activeSmokes } from './world.js';

let scene = null;

// --- tracers: a short-lived bright line from muzzle to impact -------------------------------
const TRACERS = 40;
const tracerPool = [];
let tracerCursor = 0;

function buildTracers() {
  for (let i = 0; i < TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, until: 0 });
  }
}

export function spawnTracer(x1, y1, z1, x2, y2, z2, now) {
  const t = tracerPool[tracerCursor];
  tracerCursor = (tracerCursor + 1) % TRACERS;
  const pos = t.line.geometry.attributes.position.array;
  pos[0] = x1; pos[1] = y1; pos[2] = z1; pos[3] = x2; pos[4] = y2; pos[5] = z2;
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.material.opacity = 0.85;
  t.line.visible = true;
  t.until = now + 115;
}

// --- impact particles: one Points cloud, ring-buffered --------------------------------------
const PARTICLES = 700;
let pGeo = null, pPos = null, pCol = null;
const pVel = new Float32Array(PARTICLES * 3);
const pLife = new Float32Array(PARTICLES);       // ms remaining
const pSpan = new Float32Array(PARTICLES);       // ms total
let pCursor = 0;

function buildParticles() {
  pPos = new Float32Array(PARTICLES * 3);
  pCol = new Float32Array(PARTICLES * 3);
  pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  points.frustumCulled = false;
  scene.add(points);
  for (let i = 0; i < PARTICLES; i++) pPos[i * 3 + 1] = -50;
}

export function spawnImpact(x, y, z, kind, count = 7) {
  const palette = kind === 'hit'
    ? [[1, 0.62, 0.2], [1, 0.8, 0.35]]
    : [[0.75, 0.72, 0.66], [0.5, 0.48, 0.44]];
  for (let n = 0; n < count; n++) {
    const i = pCursor;
    pCursor = (pCursor + 1) % PARTICLES;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    const a = Math.random() * Math.PI * 2, up = Math.random() * 1.6 + 0.4, sp = Math.random() * 1.8 + 0.4;
    pVel[i * 3] = Math.cos(a) * sp; pVel[i * 3 + 1] = up; pVel[i * 3 + 2] = Math.sin(a) * sp;
    const c = palette[n % palette.length];
    pCol[i * 3] = c[0]; pCol[i * 3 + 1] = c[1]; pCol[i * 3 + 2] = c[2];
    pLife[i] = pSpan[i] = 260 + Math.random() * 240;
  }
  pGeo.attributes.color.needsUpdate = true;
}

// --- smoke clouds: a cluster of soft spheres that grows, hangs, and thins -------------------
// Each cloud clones the base material: the fade below writes opacity per cloud, and a
// shared material would fade every live cloud whenever any one of them thins out.
const smokeClouds = [];
const smokeBaseMat = new THREE.MeshStandardMaterial({
  color: 0x9aa0a6, transparent: true, opacity: 0.34, roughness: 1, depthWrite: false,
});

export function spawnSmokeCloud(x, z, r, durationMs, now) {
  const group = new THREE.Group();
  const puffs = 7;
  const mat = smokeBaseMat.clone();
  for (let i = 0; i < puffs; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r * (0.45 + Math.random() * 0.3), 10, 8), mat);
    const a = (i / puffs) * Math.PI * 2;
    s.position.set(Math.cos(a) * r * 0.42, 1 + Math.random() * 0.8, Math.sin(a) * r * 0.42);
    group.add(s);
  }
  group.position.set(x, 0, z);
  group.scale.setScalar(0.25);
  scene.add(group);
  smokeClouds.push({ group, mat, born: now, until: now + durationMs, growMs: 1100 });
  activeSmokes.push({ x, z, r, until: now + durationMs });
}

// --- explosions: a fast fireball and a light pulse -------------------------------------------
const booms = [];
const boomMat = new THREE.MeshBasicMaterial({
  color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
});

export function spawnExplosion(x, y, z, scale, now) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), boomMat.clone());
  m.position.set(x, y, z);
  scene.add(m);
  const light = new THREE.PointLight(0xff9040, 0, 18, 1.6);
  light.position.set(x, y + 0.5, z);
  scene.add(light);
  booms.push({ m, light, born: now, span: 380, scale });
  spawnImpact(x, y, z, 'hit', 22);
}

// --- muzzle flash: one shared light + sprite, repositioned per shot --------------------------
let flashLight = null, flashSprite = null;

// The light goes at the barrel point (x, y, z); the sprite — a camera-facing billboard —
// goes at the viewmodel's muzzle (sx, sy, sz) when the shooter supplies it, because a
// billboard half a metre from the eye on the view axis would fill the whole screen.
export function spawnMuzzle(x, y, z, now, sx, sy, sz) {
  flashLight.position.set(x, y, z);
  flashLight.intensity = 13;
  flashSprite.position.set(sx ?? x, sy ?? y, sz ?? z);
  flashSprite.material.opacity = 0.8;
  flashSprite.material.rotation = Math.random() * Math.PI;
  flashSprite.visible = true;
  flashUntil = now + 45;
}
let flashUntil = 0;

// --- shell casings: a small pool of brass boxes, ejected and spun on every shot -------------
const CASINGS = 26;
const casingPool = [];
let casingCursor = 0;

function buildCasings() {
  const geo = new THREE.BoxGeometry(0.016, 0.016, 0.042);
  const material = new THREE.MeshStandardMaterial({
    color: 0xc9962e, roughness: 0.35, metalness: 0.85,
  });
  for (let i = 0; i < CASINGS; i++) {
    const m = new THREE.Mesh(geo, material);
    m.visible = false;
    scene.add(m);
    casingPool.push({ m, vx: 0, vy: 0, vz: 0, spin: 0, until: 0 });
  }
}

// Eject one casing from (x, y, z): up and to the shooter's right, tumbling, one bounce,
// gone inside a second. Pure garnish — the simulation never reads it.
export function spawnCasing(x, y, z, rightX, rightZ, now) {
  const c = casingPool[casingCursor];
  casingCursor = (casingCursor + 1) % CASINGS;
  c.m.position.set(x, y, z);
  c.m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  c.vx = rightX * (1.1 + Math.random() * 0.5);
  c.vz = rightZ * (1.1 + Math.random() * 0.5);
  c.vy = 1.5 + Math.random() * 0.7;
  c.spin = 9 + Math.random() * 10;
  c.until = now + 850;
  c.m.visible = true;
}

// --- the breach charge prop -------------------------------------------------------------------
export function createChargeMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.16, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.4 }),
  );
  body.position.y = 0.08;
  g.add(body);
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.03, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.4 }),
  );
  pad.position.y = 0.175;
  g.add(pad);
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.03, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xff4030 }),
  );
  lamp.position.set(0.16, 0.19, 0);
  lamp.name = 'lamp';
  g.add(lamp);
  return g;
}

export function initEffects(s) {
  scene = s;
  buildTracers();
  buildParticles();
  buildCasings();
  flashLight = new THREE.PointLight(0xffc070, 0, 9, 1.8);
  scene.add(flashLight);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const cx = cv.getContext('2d');
  const grad = cx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.4, 'rgba(255,180,80,0.75)');
  grad.addColorStop(1, 'rgba(255,140,40,0)');
  cx.fillStyle = grad; cx.fillRect(0, 0, 64, 64);
  flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flashSprite.scale.setScalar(0.34);
  flashSprite.visible = false;
  scene.add(flashSprite);
}

export function updateEffects(dt, now) {
  for (const t of tracerPool) {
    if (!t.line.visible) continue;
    if (now > t.until) { t.line.visible = false; continue; }
    t.line.material.opacity = 0.85 * (t.until - now) / 115;
  }
  const dtMs = dt * 1000;
  let anyAlive = false;
  for (let i = 0; i < PARTICLES; i++) {
    if (pLife[i] <= 0) continue;
    anyAlive = true;
    pLife[i] -= dtMs;
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -50; continue; }
    pVel[i * 3 + 1] -= 5.5 * dt;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    if (pPos[i * 3 + 1] < 0.03) pPos[i * 3 + 1] = 0.03;
  }
  if (anyAlive) pGeo.attributes.position.needsUpdate = true;

  for (let i = smokeClouds.length - 1; i >= 0; i--) {
    const c = smokeClouds[i];
    const age = now - c.born;
    if (now > c.until) {
      scene.remove(c.group);
      c.mat.dispose();
      smokeClouds.splice(i, 1);
      continue;
    }
    const grow = Math.min(1, age / c.growMs);
    c.group.scale.setScalar(0.25 + 0.75 * grow);
    const fade = Math.min(1, (c.until - now) / 2500);
    c.mat.opacity = 0.34 * Math.min(1, fade + 0.2);
  }

  for (let i = booms.length - 1; i >= 0; i--) {
    const b = booms[i];
    const t = (now - b.born) / b.span;
    if (t >= 1) {
      scene.remove(b.m); scene.remove(b.light);
      b.m.material.dispose();
      booms.splice(i, 1);
      continue;
    }
    b.m.scale.setScalar(0.4 + b.scale * t * 2.4);
    b.m.material.opacity = 0.75 * (1 - t);
    b.light.intensity = 120 * (1 - t);
  }

  if (flashLight.intensity > 0 && now > flashUntil) {
    flashLight.intensity = 0;
    flashSprite.visible = false;
  }

  for (const c of casingPool) {
    if (!c.m.visible) continue;
    if (now > c.until) { c.m.visible = false; continue; }
    c.vy -= 6.5 * dt;
    c.m.position.x += c.vx * dt;
    c.m.position.y += c.vy * dt;
    c.m.position.z += c.vz * dt;
    if (c.m.position.y < 0.03) {
      c.m.position.y = 0.03;
      c.vy = Math.abs(c.vy) > 1 ? -c.vy * 0.35 : 0;
      c.vx *= 0.6; c.vz *= 0.6; c.spin *= 0.4;
    }
    c.m.rotation.x += c.spin * dt;
    c.m.rotation.z += c.spin * 0.7 * dt;
  }
}
