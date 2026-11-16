// models.js — the fighters and guns are built from boxes, in code: a team-coloured torso, a
// helmeted head, legs that swing as the body moves, and a gun that points where the fighter
// aims. The same builder makes the player's viewmodel weapons, so what a bot carries reads
// the same as what you hold. No model files, no textures to fetch — the yard stays offline.

import * as THREE from 'three';
import { PALETTE } from './world.js';

const matCache = new Map();
function mat(color, rough = 0.85, metal = 0.05) {
  const key = color + '|' + rough + '|' + metal;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  }
  return matCache.get(key);
}

function box(w, h, d, color, x = 0, y = 0, z = 0, rough, metal) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, rough, metal));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// A standing fighter, facing -Z (the aim convention physics and bots use). Parts are returned
// so the renderer can swing the legs and pitch the gun arm with the fighter's aim.
export function buildFighterMesh(team) {
  const teamColor = team === 'ember' ? PALETTE.ember : PALETTE.warden;
  const cloth = team === 'ember' ? 0x4a3a30 : 0x2e4048;
  const g = new THREE.Group();

  const legL = new THREE.Group(); legL.position.set(-0.13, 0.92, 0);
  legL.add(box(0.19, 0.92, 0.23, cloth, 0, -0.46, 0));
  const legR = new THREE.Group(); legR.position.set(0.13, 0.92, 0);
  legR.add(box(0.19, 0.92, 0.23, cloth, 0, -0.46, 0));
  g.add(legL, legR);

  const torso = box(0.52, 0.62, 0.3, teamColor, 0, 1.23, 0);
  const vest = box(0.56, 0.4, 0.36, 0x24262a, 0, 1.26, 0, 0.95);
  g.add(torso, vest);

  const head = new THREE.Group(); head.position.set(0, 1.66, 0);
  head.add(box(0.26, 0.28, 0.26, 0xc9a186, 0, 0, 0));                 // face
  head.add(box(0.31, 0.13, 0.31, teamColor, 0, 0.15, 0));            // helmet
  head.add(box(0.3, 0.07, 0.1, 0x1c1e20, 0, 0.02, -0.16));           // visor, on the -Z face
  g.add(head);

  const arm = new THREE.Group(); arm.position.set(0.18, 1.48, -0.05);
  arm.add(box(0.13, 0.13, 0.52, cloth, 0, -0.02, -0.2));             // forearm reaching forward
  g.add(arm);

  g.userData = { legL, legR, arm, head, phase: 0, deathT: 0 };
  return g;
}

// Pose a fighter mesh from its body state: position, facing, walk swing, crouch, death fall.
export function poseFighterMesh(mesh, f, dt) {
  const u = mesh.userData;
  mesh.position.set(f.x, f.y, f.z);
  mesh.rotation.y = f.yaw;
  if (!f.alive) {
    u.deathT = Math.min(1, u.deathT + dt * 3.2);
    mesh.rotation.x = -u.deathT * Math.PI / 2 * 0.92;
    mesh.position.y = f.y + u.deathT * 0.12;
    return;
  }
  u.deathT = 0;
  mesh.rotation.x = 0;
  u.phase += f.speed2d * dt * 2.4;
  const swing = Math.sin(u.phase) * Math.min(0.62, f.speed2d * 0.13);
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  const targetScaleY = f.crouch ? 0.76 : 1;
  mesh.scale.y += (targetScaleY - mesh.scale.y) * Math.min(1, dt * 12);
  u.arm.rotation.x = -f.pitch;
  u.head.rotation.x = -f.pitch * 0.7;
}

// Attach the carried gun to a fighter mesh's arm; rebuilt when the weapon changes.
export function setFighterGun(mesh, weaponKey) {
  const arm = mesh.userData.arm;
  if (mesh.userData.gunKey === weaponKey) return;
  mesh.userData.gunKey = weaponKey;
  while (arm.children.length > 1) arm.remove(arm.children[1]);
  if (!weaponKey) return;
  const gun = buildGunMesh(weaponKey, false);
  gun.position.set(0, -0.05, -0.28);
  arm.add(gun);
}

// One gun from boxes: barrel, body, magazine, stock — proportions vary by kind, so a Longbow
// reads long and a Mule reads fat from across the yard.
export function buildGunMesh(key, viewmodel) {
  const g = new THREE.Group();
  const dark = 0x232527, mid = 0x3a3d40, accent = 0x565a5e;
  const dims = {
    sparrow: { len: 0.24, h: 0.13, barrel: 0.1 },
    raptor: { len: 0.52, h: 0.17, barrel: 0.16 },
    mule: { len: 0.72, h: 0.15, barrel: 0.4 },
    kestrel: { len: 0.78, h: 0.18, barrel: 0.34 },
    longbow: { len: 1.05, h: 0.17, barrel: 0.55 },
  }[key] ?? { len: 0.6, h: 0.16, barrel: 0.3 };
  const s = viewmodel ? 1 : 1;
  g.add(box(0.07 * s, dims.h * s, dims.len * s, dark, 0, 0, -dims.len * s * 0.3, 0.5, 0.5));
  g.add(box(0.045 * s, 0.05 * s, dims.barrel * s, mid, 0, 0.02 * s, -(dims.len * s * 0.8 + dims.barrel * s * 0.4), 0.4, 0.6));
  if (key === 'kestrel' || key === 'raptor') {
    g.add(box(0.05 * s, 0.2 * s, 0.09 * s, mid, 0, -0.16 * s, -0.05 * s, 0.6, 0.3));   // magazine
    g.add(box(0.05 * s, 0.06 * s, 0.16 * s, accent, 0, dims.h * s * 0.65, -0.1 * s));    // carry handle / rail
  }
  if (key === 'longbow') {
    const scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028 * s, 0.028 * s, 0.2 * s, 8), mat(mid, 0.35, 0.7));
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.15 * s, -0.12 * s);
    scope.castShadow = true;
    g.add(scope);
    g.add(box(0.05 * s, 0.16 * s, 0.08 * s, mid, 0, -0.14 * s, -0.02 * s, 0.6, 0.3));
  }
  if (key === 'mule') g.add(box(0.06 * s, 0.07 * s, 0.3 * s, 0x6e5136, 0, -0.06 * s, -0.42 * s, 0.9, 0));
  if (key === 'sparrow') g.add(box(0.055 * s, 0.12 * s, 0.08 * s, mid, 0, -0.1 * s, 0.03 * s, 0.6, 0.3));
  g.userData.dims = dims;
  return g;
}

// The grenade prop in hand: a small canister, coloured by kind.
export function buildGrenadeMesh(kind) {
  const color = { shard: 0x51603c, lumen: 0xd8d8d2, veil: 0x707880 }[kind] ?? 0x555555;
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.13, 10), mat(color, 0.45, 0.5));
  m.castShadow = true;
  return m;
}
