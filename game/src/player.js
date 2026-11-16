// player.js — you. Pointer-lock mouse look, WASD movement through the shared physics,
// trigger discipline (semi weapons need a fresh click), planting the charge by holding E on
// a site, and the first-person viewmodel that bobs, sways and kicks with the gun.

import * as THREE from 'three';
import { BODY, MATCH, WEAPONS } from './config.js';
import { moveBody } from './physics.js';
import { state, currentWeaponKey, isGrenadeSlot, plantCharge, siteAt, emit } from './state.js';
import { tryFire, startReload, switchTo, throwGrenade } from './weapons.js';
import { buildGunMesh, buildGrenadeMesh } from './models.js';
import { input, keyDown, consumeMouse } from './input.js';

const SENS = 0.00205;
let viewmodel = null;
let vmKey = null;          // what the viewmodel currently shows
let bobPhase = 0;
let wasFiring = false;
let prevYaw = 0, prevPitch = 0, swayX = 0, swayY = 0;   // viewmodel lag behind the look

export function initViewmodel(camera) {
  viewmodel = new THREE.Group();
  viewmodel.position.set(0.34, -0.32, -0.55);
  // Angled a touch inward, so the gun reads as a gun — receiver, rail and barrel in
  // perspective — instead of the flat rear face of a box stared at from directly behind.
  viewmodel.rotation.y = -0.07;
  camera.add(viewmodel);
}

export function refreshViewmodel(f) {
  const key = currentWeaponKey(f);
  const show = isGrenadeSlot(f.current) ? 'nade:' + f.current : key;
  if (show === vmKey || !viewmodel) return;
  vmKey = show;
  while (viewmodel.children.length) viewmodel.remove(viewmodel.children[0]);
  if (!key) return;
  const mesh = isGrenadeSlot(f.current) ? buildGrenadeMesh(f.current) : buildGunMesh(key, true);
  if (isGrenadeSlot(f.current)) mesh.position.set(0, -0.02, -0.1);
  viewmodel.add(mesh);
}

// Discrete key presses from the input layer: slots, reload, interaction is polled instead.
export function playerKey(f, code, down) {
  if (!down || !f.alive) return;
  if (code === 'Digit1') switchTo(f, 'primary');
  else if (code === 'Digit2') switchTo(f, 'sidearm');
  else if (code === 'Digit4') switchTo(f, 'shard');
  else if (code === 'Digit5') switchTo(f, 'lumen');
  else if (code === 'Digit6') switchTo(f, 'veil');
  else if (code === 'KeyR') startReload(f);
  else if (code === 'KeyQ') switchTo(f, f.lastSwitch);
}

export function updatePlayer(f, dt, colliders) {
  const { dx, dy } = consumeMouse();
  f.yaw -= dx * SENS;
  f.pitch -= dy * SENS;
  f.pitch = Math.max(-1.45, Math.min(1.45, f.pitch));

  const frozen = state.phase === 'buy' || state.phase === 'end' || state.phase === 'over';
  if (!f.alive || frozen) {
    moveBody(colliders, f, 0, 0, 0, dt, false);
    wasFiring = false;
    return;
  }

  // Movement wish direction, relative to where the camera faces.
  let wx = 0, wz = 0;
  const sin = Math.sin(f.yaw), cos = Math.cos(f.yaw);
  if (keyDown('KeyW')) { wx += -sin; wz += -cos; }
  if (keyDown('KeyS')) { wx += sin; wz += cos; }
  if (keyDown('KeyA')) { wx += -cos; wz += sin; }
  if (keyDown('KeyD')) { wx += cos; wz += -sin; }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  f.crouch = keyDown('ControlLeft') || keyDown('KeyC');
  const walking = keyDown('ShiftLeft') || keyDown('ShiftRight');
  const def = WEAPONS[currentWeaponKey(f)] ?? WEAPONS.sparrow;
  // Read the aim state before the speed cap: aiming slows the walk this same step,
  // not one step later (the old order used last step's value for the cap).
  f.aiming = input.aiming && !isGrenadeSlot(f.current);
  let speed = Math.min(BODY.runSpeed, def.moveSpeed ?? BODY.runSpeed);
  if (f.crouch) speed = BODY.crouchSpeed;
  else if (walking) speed = BODY.walkSpeed;
  if (f.aiming) speed *= 0.55;
  moveBody(colliders, f, wx, wz, speed, dt, keyDown('Space'));

  // The charge: walk over a dropped one to take it back.
  const charge = state.charge;
  if (charge?.mode === 'dropped' && Math.hypot(charge.x - f.x, charge.z - f.z) < 1.3) {
    f.hasCharge = true;
    state.charge = { mode: 'carried', carrier: f, x: 0, z: 0, site: null, fuseT: 0 };
    emit('chargePickup', { by: f });
  }

  // Planting: hold E inside a site with the charge. Moving or releasing cancels.
  const site = f.hasCharge && state.phase === 'live' ? siteAt(f.x, f.z) : null;
  if (site && keyDown('KeyE') && wl === 0) {
    if (!f.channel) f.channel = { kind: 'plant', t: 0, need: MATCH.plantSeconds };
    f.channel.t += dt;
    f.crouch = true;
    if (f.channel.t >= f.channel.need) {
      f.channel = null;
      plantCharge(f, site);
    }
  } else if (f.channel?.kind === 'plant') {
    f.channel = null;
  }

  // Trigger. Grenades throw on the click; guns respect auto vs semi.
  const slot = f.current;
  if (input.firing && !wasFiring && isGrenadeSlot(slot)) {
    throwGrenade(f, slot);
  } else if (input.firing && !f.channel) {
    if (!wasFiring || def.auto) tryFire(f, colliders);
  }
  wasFiring = input.firing;

  refreshViewmodel(f);
}

// Pose the camera and viewmodel for the render: eye height eases with crouch, the gun bobs
// as you move and rears as it fires (f.kick is accumulated by weapons.js, decayed there too).
export function poseCamera(f, camera, dt) {
  const eyeY = f.y + (f.crouch ? BODY.eyeCrouch : BODY.eyeStand);
  camera.position.set(f.x, eyeY, f.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = f.yaw;
  camera.rotation.x = f.pitch + (f.kick ?? 0) * 0.012;
  camera.rotation.z = 0;

  if (!viewmodel) return;
  bobPhase += f.speed2d * dt * 1.9;
  const bob = Math.min(1, f.speed2d / 4);
  const scoped = f.aiming && currentWeaponKey(f) === 'longbow';
  const ads = f.aiming && !scoped;

  // Sway: the gun trails a fast look by a few centimetres and settles back, so turning
  // feels like carrying weight instead of wearing a camera on rails.
  if (dt > 0) {
    let dyaw = f.yaw - prevYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    swayX += ((-dyaw / dt) * 0.006 - swayX) * Math.min(1, dt * 18);
    swayY += (((f.pitch - prevPitch) / dt) * 0.004 - swayY) * Math.min(1, dt * 18);
  }
  prevYaw = f.yaw; prevPitch = f.pitch;
  const sx = Math.max(-0.035, Math.min(0.035, swayX));
  const sy = Math.max(-0.025, Math.min(0.025, swayY));

  // Reload: the gun dips and rolls while the magazine is out, and comes back up as the
  // reload lands — the animation is the timer, no separate clock.
  let dip = 0;
  if (f.reloadT > 0) {
    const def = WEAPONS[currentWeaponKey(f)];
    if (def) dip = Math.sin(Math.min(1, 1 - f.reloadT / (def.reloadMs / 1000)) * Math.PI);
  }

  const tx = ads ? 0 : 0.34;
  const ty = ads ? -0.148 : -0.32 + Math.sin(bobPhase * 2) * 0.008 * bob;
  const tz = ads ? -0.35 : -0.55;
  viewmodel.rotation.y = ads ? 0 : -0.07;
  viewmodel.position.x += ((tx + sx) - viewmodel.position.x) * Math.min(1, dt * 14);
  viewmodel.position.y += ((ty + sy - dip * 0.13) - viewmodel.position.y) * Math.min(1, dt * 14);
  viewmodel.position.z += (tz - viewmodel.position.z) * Math.min(1, dt * 14);
  viewmodel.rotation.x = (f.kick ?? 0) * 0.05 - dip * 0.55;
  viewmodel.rotation.z = dip * 0.18;
  viewmodel.visible = !!f.alive && !scoped;
}
