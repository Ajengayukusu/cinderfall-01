// config.js — every tuning number for Cinderfall in one place: match flow, economy and the
// weapon table. Nothing here touches three.js or the DOM, so the simulation modules can import
// it freely and a balance pass never has to hunt through the codebase.

export const MATCH = {
  roundsToWin: 9,          // first team to this many rounds takes the match
  maxRounds: 16,           // hard stop; the higher score wins if nobody reaches roundsToWin
  buySeconds: 12,          // freeze + buy window at the top of each round
  roundSeconds: 100,       // the clock the attackers play against
  plantSeconds: 3.2,       // channel time to plant the breach charge
  defuseSeconds: 5,        // channel time for a Warden to defuse it
  chargeSeconds: 40,       // fuse once planted
  endSeconds: 5.5,         // pause on the round banner before the next round
  startMoney: 800,
  maxMoney: 16000,
  killReward: 300,
  plantReward: 300,        // to the planter
  winReward: 3250,
  lossReward: 1900,
  plantedLossBonus: 800,   // attackers still earn this when a planted round is lost
  teamSize: 5,             // per side, the local player included on the Ember side
};

export const ECONOMY = {
  armorPrice: 650,
};

// Weapon table. damage is per bullet (per pellet for the scattergun) at point blank;
// headMult multiplies a head hit, range is where falloff starts, in metres.
// rpm drives the fixed-step fire timer; spread is in degrees of cone half-angle at rest.
export const WEAPONS = {
  sparrow: {
    name: 'P9 Sparrow', kind: 'pistol', price: 0, slot: 'sidearm',
    damage: 26, headMult: 3.6, pellets: 1, rpm: 340, auto: false,
    mag: 12, reserve: 96, reloadMs: 1400, range: 22,
    spreadStand: 0.55, spreadMove: 1.7, spreadAir: 3.4, recoil: 0.55, moveSpeed: 5.1,
  },
  raptor: {
    name: 'Raptor-9 SMG', kind: 'smg', price: 1250, slot: 'primary',
    damage: 21, headMult: 3.2, pellets: 1, rpm: 780, auto: true,
    mag: 32, reserve: 128, reloadMs: 2100, range: 16,
    spreadStand: 0.95, spreadMove: 2.1, spreadAir: 3.8, recoil: 0.38, moveSpeed: 5.15,
  },
  mule: {
    name: 'Mule 12 Scattergun', kind: 'shotgun', price: 1100, slot: 'primary',
    damage: 9, headMult: 2.2, pellets: 8, rpm: 68, auto: false,
    mag: 7, reserve: 32, reloadMs: 2900, range: 9,
    spreadStand: 3.4, spreadMove: 4.2, spreadAir: 5.5, recoil: 2.4, moveSpeed: 4.85,
  },
  kestrel: {
    name: 'VK-7 Kestrel', kind: 'rifle', price: 2700, slot: 'primary',
    damage: 34, headMult: 3.9, pellets: 1, rpm: 600, auto: true,
    mag: 30, reserve: 120, reloadMs: 2400, range: 30,
    spreadStand: 0.42, spreadMove: 2.3, spreadAir: 4.6, recoil: 0.72, moveSpeed: 4.9,
  },
  longbow: {
    name: 'Longbow .338', kind: 'sniper', price: 4750, slot: 'primary',
    damage: 112, headMult: 2.4, pellets: 1, rpm: 44, auto: false,
    mag: 5, reserve: 30, reloadMs: 3400, range: 60,
    spreadStand: 0.06, spreadMove: 3.4, spreadAir: 6.0, recoil: 3.4, moveSpeed: 4.7,
  },
};

export const GRENADES = {
  shard: { name: 'Shard Frag', price: 300, damage: 92, radius: 5.2, fuseMs: 1500 },
  lumen: { name: 'Lumen Flash', price: 200, radius: 17, fuseMs: 1300 },
  veil: { name: 'Veil Smoke', price: 300, radius: 4.6, durationMs: 15000, fuseMs: 900 },
};

export const BUY_ORDER = ['raptor', 'mule', 'kestrel', 'longbow', 'armor', 'shard', 'lumen', 'veil'];

// Player / bot body metrics, shared by movement, hit tests and rendering.
export const BODY = {
  radius: 0.36,
  standHeight: 1.78,
  crouchHeight: 1.32,
  eyeStand: 1.62,
  eyeCrouch: 1.18,
  headDrop: 0.14,          // head sphere centre sits this far below the crown
  runSpeed: 5.0,           // before the weapon's own moveSpeed cap
  walkSpeed: 2.6,          // shift held: quiet and slower
  crouchSpeed: 1.9,
  accel: 42,               // ground acceleration, m/s^2
  airAccel: 6,
  friction: 11,            // ground friction coefficient
  jumpVel: 4.9,
  gravity: 13.5,
};
