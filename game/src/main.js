// main.js — boot and the frame loop. The simulation runs on a fixed 60 Hz step, kept apart
// from rendering: however fast the display is, the game underneath ticks the same, and the
// renderer only poses meshes and the camera from the state the last step left behind.

import * as THREE from 'three';
import { buildWorld, PALETTE, pruneSmokes } from './world.js';
import { state, makeFighter, startMatch, updateMatch, reportNoise, currentWeaponKey, damageFighter } from './state.js';
import { updateBot, makeBot } from './bots.js';
import { updatePlayer, playerKey, initViewmodel, poseCamera, refreshViewmodel } from './player.js';
import { initInput, lockPointer, input } from './input.js';
import { updateWeapons, updateGrenades, clearGrenades, tryFire } from './weapons.js';
import { initEffects, updateEffects, spawnExplosion, createChargeMesh } from './effects.js';
import { buildFighterMesh, poseFighterMesh, setFighterGun, buildGrenadeMesh } from './models.js';
import { initHud, updateHud, hudEvent, setBuyOpen, buyOpen, hudBuyKey } from './hud.js';
import { initAudio } from './audio.js';
import { setupShot } from './shots.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const shotName = params.get('shot');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.24;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 400);
scene.add(camera);

const { colliders } = buildWorld(scene);
initEffects(scene);
initViewmodel(camera);

// --- the ten fighters ----------------------------------------------------------------------
const EMBER_BOTS = ['Vex', 'Onyx', 'Rook', 'Mira'];
const WARDEN_BOTS = ['Hale', 'Ivers', 'Juno', 'Kett', 'Bram'];
const player = makeFighter('ember', true);
player.name = 'YOU';
state.player = player;
state.fighters.push(player);
for (const name of EMBER_BOTS) {
  const f = makeFighter('ember', false);
  f.name = name;
  makeBot(f);
  state.fighters.push(f);
}
for (const name of WARDEN_BOTS) {
  const f = makeFighter('warden', false);
  f.name = name;
  makeBot(f);
  state.fighters.push(f);
}

const meshes = new Map();
for (const f of state.fighters) {
  if (f.isPlayer) continue;
  const mesh = buildFighterMesh(f.team);
  scene.add(mesh);
  meshes.set(f, mesh);
}

const chargeMesh = createChargeMesh();
chargeMesh.visible = false;
scene.add(chargeMesh);
const chargeLamp = chargeMesh.getObjectByName('lamp');

const grenadeSync = {
  update(g) {
    if (!g.mesh) {
      g.mesh = buildGrenadeMesh(g.kind);
      g.mesh.scale.setScalar(1.5);
      scene.add(g.mesh);
    }
    g.mesh.position.set(g.x, g.y, g.z);
  },
  remove(g) {
    if (g.mesh) { scene.remove(g.mesh); g.mesh = null; }
  },
};

initHud(colliders);

// A small handle for automated play-tests and debugging: the live match state and the two
// verbs a test needs. It changes nothing about how the game plays.
window.__cinderfall = { state, startMatch, damageFighter };

// --- input routing ----------------------------------------------------------------------------
let started = false;
initInput(renderer.domElement, (code, down) => {
  if (!down) return;
  if (code === 'KeyB' && state.phase === 'buy' && player.alive) {
    setBuyOpen(!buyOpen);
    return;
  }
  if (buyOpen && state.phase === 'buy' && /^Digit[1-8]$/.test(code)) {
    hudBuyKey(code);
    return;
  }
  playerKey(player, code, down);
});

const menuOverlay = document.getElementById('menuOverlay');
const endOverlay = document.getElementById('endOverlay');
const playBtn = document.getElementById('playBtn');

function beginPlay() {
  initAudio();
  if (!started) {
    started = true;
    startMatch();
  }
  lockPointer(renderer.domElement);
}
playBtn.addEventListener('click', beginPlay);
document.getElementById('againBtn').addEventListener('click', () => {
  endOverlay.classList.add('hidden');
  startMatch();
  lockPointer(renderer.domElement);
});
document.addEventListener('pointerlockchange', () => {
  if (input.locked) {
    menuOverlay.classList.add('hidden');
  } else if (started && state.phase !== 'over' && !shotName) {
    playBtn.textContent = 'CLICK TO RESUME';
    menuOverlay.classList.remove('hidden');
  }
});

// --- world-side event effects ------------------------------------------------------------------
let shake = 0;
function worldEvent(ev) {
  if (ev.type === 'roundStart') {
    clearGrenades(grenadeSync);
  } else if (ev.type === 'detonate') {
    spawnExplosion(ev.x, 1.1, ev.z, 3.4, state.nowMs);
    const d = Math.hypot(ev.x - player.x, ev.z - player.z);
    shake = Math.max(shake, Math.max(0, 1 - d / 16));
  } else if (ev.type === 'matchEnd') {
    document.exitPointerLock?.();
    document.getElementById('endTitle').textContent =
      ev.winner === 'ember' ? 'EMBER TAKES THE YARD' : 'WARDENS HOLD THE YARD';
    document.getElementById('endScore').textContent =
      `${state.score.ember} — ${state.score.warden}`;
    endOverlay.classList.remove('hidden');
  }
}

// --- one fixed simulation step -------------------------------------------------------------------
function simStep(skipPlayer = false) {
  const dt = STEP;
  updateMatch(dt);
  if (!skipPlayer && player.alive) updatePlayer(player, dt, colliders);
  for (const f of state.fighters) updateWeapons(f, dt);
  for (const f of state.fighters) if (f.bot) updateBot(f, dt, colliders);
  updateGrenades(dt, colliders, grenadeSync);
  // Footsteps are noise too: a running fighter is heard through the yard.
  for (const f of state.fighters) {
    if (f.alive && f.onGround && f.speed2d > 3.4 && state.nowMs >= (f.nextStepAt ?? 0)) {
      reportNoise(f.x, f.z, 8.5, f.team);
      f.nextStepAt = state.nowMs + 340;
    }
  }
  const evs = state.events.splice(0);
  for (const ev of evs) { hudEvent(ev); worldEvent(ev); }
  state.noises.length = 0;
  pruneSmokes(state.nowMs);
}

// --- charge prop sync ------------------------------------------------------------------------------
function syncCharge() {
  const c = state.charge;
  const planting = player.channel?.kind === 'plant' && player.alive;
  if (planting) {
    chargeMesh.visible = true;
    chargeMesh.position.set(
      player.x - Math.sin(player.yaw) * 0.55, 0, player.z - Math.cos(player.yaw) * 0.55);
    return;
  }
  if (!c || c.mode === 'carried') { chargeMesh.visible = false; return; }
  chargeMesh.visible = true;
  chargeMesh.position.set(c.x, 0, c.z);
  if (c.mode === 'planted' && chargeLamp) {
    const period = c.fuseT < 10 ? 280 : 650;
    chargeLamp.material.color.setHex((state.nowMs % period) < period * 0.45 ? 0xff4030 : 0x57150f);
  }
}

// --- the frame --------------------------------------------------------------------------------------
let last = performance.now();
let acc = 0;
let fov = 75;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const frameDt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;

  if (started && !shotName) {
    acc += frameDt;
    while (acc >= STEP) { simStep(false); acc -= STEP; }
  }

  // Pose every bot from the simulation state.
  for (const f of state.fighters) {
    if (f.isPlayer) continue;
    const mesh = meshes.get(f);
    poseFighterMesh(mesh, f, frameDt);
    setFighterGun(mesh, f.alive ? currentWeaponKey(f) : null);
  }
  syncCharge();

  if (player.alive) {
    poseCamera(player, camera, frameDt);
  } else {
    camera.position.set(player.x, player.y + 0.5, player.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(-0.12, player.yaw, 0.55);
    camera.children.forEach((c) => { c.visible = false; });
  }
  if (shake > 0.002) {
    camera.rotation.x += (Math.random() - 0.5) * shake * 0.05;
    camera.rotation.y += (Math.random() - 0.5) * shake * 0.05;
    shake = Math.max(0, shake - frameDt * 1.8);
  }
  const targetFov = !player.alive ? 75
    : player.aiming && currentWeaponKey(player) === 'longbow' ? 23
    : player.aiming ? 63 : 75;
  if (Math.abs(targetFov - fov) > 0.05) {
    fov += (targetFov - fov) * Math.min(1, frameDt * 13);
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  updateEffects(shotName ? 0 : frameDt, state.nowMs);
  if (!shotName) updateHud(frameDt);
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- screenshot mode: stage the scene, settle it, freeze it -----------------------------------------
if (shotName) {
  menuOverlay.classList.add('hidden');
  started = true;
  startMatch();
  // Drain the round-start events now, so the staging below (menu closed, banner hidden)
  // is what the capture sees, not the other way round.
  const bootEvents = state.events.splice(0);
  for (const ev of bootEvents) { hudEvent(ev); worldEvent(ev); }
  const plan = setupShot(shotName);
  for (let i = 0; i < plan.steps; i++) {
    if (plan.fireAt.includes(i)) tryFire(player, colliders);
    simStep(true);
  }
  if (shotName === 'combat') document.getElementById('hitmarker').classList.add('on');
  refreshViewmodel(player);
  poseCamera(player, camera, 0);
  for (const f of state.fighters) {
    if (f.isPlayer) continue;
    // A dead fighter is posed with its fall completed (deathT is time-driven, and a
    // staged frame has no time to spare): bodies read as down, not mid-animation.
    poseFighterMesh(meshes.get(f), f, f.alive ? 0 : 0.6);
    setFighterGun(meshes.get(f), currentWeaponKey(f));
  }
  syncCharge();
  updateHud(0);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  plan.late?.();
  window.__shotReady = true;
}

requestAnimationFrame(frame);
