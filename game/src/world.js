// world.js — Cinder Yard: an original dusk freight-yard map. One data table of boxes drives
// three things at once — the meshes the player sees, the colliders physics tests, and the
// sight blockers bot vision tests — so the world can never disagree with itself. The waypoint
// graph, site zones and spawn points live here too, as data the AI reads.

import * as THREE from 'three';

export const PALETTE = {
  sky: 0x232c3a, fog: 0x2b2c3a,
  sun: 0xffb066, hemiSky: 0x8fa3bf, hemiGround: 0x3d3630,
  concrete: 0x83868a, concreteDark: 0x5d6066, asphalt: 0x3f4247,
  rust: 0x9a4a2e, teal: 0x2e6f6a, slate: 0x54606e, ochre: 0xb07a2e,
  wood: 0x8a6b48, metal: 0x6b7280, tank: 0x7d8894,
  ember: 0xff7a29, warden: 0x2fd4c4,
};

const texCache = new Map();
function canvasTexture(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

// Deterministic speckle so textures look worn without any image assets.
function speckle(ctx, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    const v = 120 + ((i * 7919) % 120);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect((i * 104729) % w, (i * 13007) % h, 2 + (i % 3), 2 + (i % 2));
  }
}

function groundTexture() {
  return canvasTexture('ground', 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#5a5d63'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 2600, 0.08);
    ctx.strokeStyle = 'rgba(20,20,22,0.25)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 128, 0); ctx.lineTo(i * 128, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(w, i * 128); ctx.stroke();
    }
  });
}

function corrugatedTexture() {
  return canvasTexture('corrugated', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#c9c9c9'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const grad = ctx.createLinearGradient(x, 0, x + 16, 0);
      grad.addColorStop(0, '#9a9a9a'); grad.addColorStop(0.5, '#d8d8d8'); grad.addColorStop(1, '#8f8f8f');
      ctx.fillStyle = grad; ctx.fillRect(x, 0, 16, h);
    }
    speckle(ctx, w, h, 500, 0.10);
  });
}

function woodTexture() {
  return canvasTexture('wood', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#a07d52'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 36) {
      ctx.fillStyle = (y / 36) % 2 ? '#98764c' : '#a9855a';
      ctx.fillRect(0, y, w, 34);
      ctx.fillStyle = 'rgba(60,40,20,0.5)'; ctx.fillRect(0, y + 34, w, 2);
    }
    speckle(ctx, w, h, 300, 0.06);
  });
}

function concreteTexture() {
  return canvasTexture('concrete', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b4b6b8'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1500, 0.07);
    ctx.fillStyle = 'rgba(40,40,44,0.18)';
    ctx.fillRect(0, h - 40, w, 40); // grime at the foot of the wall
  });
}

function sitePaintTexture(letter, color) {
  return canvasTexture('site' + letter, 256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = color; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 104, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 150px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, w / 2, h / 2 + 8);
  });
}

// Box authoring table: cx, cz = centre, w/d = footprint, h = height, mat = palette key or
// texture name, base = underside height (default 0). Walls and containers block sight;
// a lone crate (h ~1.1) does not block a standing eye line.
const BOXES = [];
function B(cx, cz, w, d, h, mat, opts = {}) {
  BOXES.push({ cx, cz, w, d, h, mat, ...opts });
}

// Perimeter (inner faces at ±35.4)
B(0, -36, 73, 1.2, 4.4, 'concrete'); B(0, 36, 73, 1.2, 4.4, 'concrete');
B(-36, 0, 1.2, 73, 4.4, 'concrete'); B(36, 0, 1.2, 73, 4.4, 'concrete');

// Foundry warehouse (Site A): x -32..-6, z -32..-8. South wall has two doors, east wall one.
B(-19, -32.3, 26.6, 0.6, 4.2, 'concrete');                    // north wall
B(-32.3, -20, 0.6, 24.6, 4.2, 'concrete');                    // west wall
B(-28.5, -7.7, 7.6, 0.6, 4.2, 'concrete');                    // south wall, west of main door
B(-16, -7.7, 6, 0.6, 4.2, 'concrete');                        // south wall, between doors
B(-7.5, -7.7, 3.6, 0.6, 4.2, 'concrete');                     // south wall, east of second door
B(-5.7, -29, 0.6, 6.6, 4.2, 'concrete');                      // east wall, north of link door
B(-5.7, -14, 0.6, 12.6, 4.2, 'concrete');                     // east wall, south of link door
B(-19, -19, 26.6, 24.6, 0.25, 'concreteDark', { slab: true, roofY: 4.32 }); // foundry roof (visual only)
// Interior: furnace blocks, crate stacks, a low divider
B(-26, -26, 4.4, 3.2, 2.2, 'metal');
B(-13, -27, 3.4, 3, 1.8, 'rust', { tex: 'corrugated' });
B(-20, -18.5, 5.4, 0.7, 1.15, 'concreteDark');
B(-28.5, -14, 1.15, 1.15, 1.15, 'wood', { tex: 'wood' });
B(-28.5, -14, 1.15, 1.15, 2.3, 'wood', { tex: 'wood', stacked: true });
B(-10.5, -20, 1.15, 1.15, 1.15, 'wood', { tex: 'wood' });

// Mid house: x -6..6, z -6..4, doors west, east and south.
B(0, -6.3, 12.6, 0.6, 3.6, 'concrete');
B(-6.3, -4.2, 0.6, 4.8, 3.6, 'concrete');
B(-6.3, 1.6, 0.6, 5.4, 3.6, 'concrete');
B(6.3, -4.2, 0.6, 4.8, 3.6, 'concrete');
B(6.3, 1.6, 0.6, 5.4, 3.6, 'concrete');
B(-4.4, 4.3, 4.4, 0.6, 3.6, 'concrete');
B(4.4, 4.3, 4.4, 0.6, 3.6, 'concrete');
B(0, -1, 1.15, 1.15, 1.15, 'wood', { tex: 'wood' });
B(0, -1, 13.2, 11.8, 0.25, 'concreteDark', { slab: true, roofY: 3.72 });

// Mid yard: a long container splits the southern approach; crates dot the fields.
B(-6, 8, 16, 2.6, 2.6, 'teal', { tex: 'corrugated' });
B(12, -14, 6.4, 2.6, 2.6, 'rust', { tex: 'corrugated' });
B(16, -20, 1.15, 1.15, 1.15, 'wood', { tex: 'wood' });
B(3, 16, 1.15, 1.15, 1.15, 'wood', { tex: 'wood' });
B(-14, 14, 2.4, 1.15, 1.15, 'wood', { tex: 'wood' });
B(-20, 22, 6.4, 2.6, 2.6, 'slate', { tex: 'corrugated' });
B(24, -6, 1.15, 1.15, 1.15, 'wood', { tex: 'wood' });
B(28, -18, 2.6, 6.4, 2.6, 'ochre', { tex: 'corrugated' });

// Depot (Site B): container walls and crate cover around an open apron.
B(13.5, 21, 2.6, 12, 2.6, 'teal', { tex: 'corrugated' });
B(24, 13.5, 12, 2.6, 2.6, 'rust', { tex: 'corrugated' });
B(33, 26, 2.6, 8, 2.6, 'slate', { tex: 'corrugated' });
B(20, 27, 1.15, 1.15, 1.15, 'wood', { tex: 'wood' });
B(20, 27, 1.15, 1.15, 2.3, 'wood', { tex: 'wood', stacked: true });
B(27.5, 20.5, 1.15, 1.15, 1.15, 'wood', { tex: 'wood' });
B(23.5, 31.5, 3.2, 2.2, 1.5, 'tank');
B(8, 26, 1.15, 1.15, 1.15, 'wood', { tex: 'wood' });

// South lane and west lane dressing.
B(-16, 31, 6.4, 2.6, 2.6, 'ochre', { tex: 'corrugated' });
B(-33.5, 6, 1.15, 1.15, 1.15, 'wood', { tex: 'wood' });
B(-12, -16, 1.15, 1.15, 1.15, 'wood', { tex: 'wood' });

export const SITES = {
  A: { id: 'A', name: 'Foundry', minX: -30, maxX: -12, minZ: -30, maxZ: -14, cx: -21, cz: -22 },
  B: { id: 'B', name: 'Depot', minX: 16, maxX: 31, minZ: 17, maxZ: 32, cx: 23.5, cz: 24.5 },
};

// Spawn yaw uses the aim convention (weapons.aimDir): yaw -0.8 from the south-west corner
// faces north-east, into the yard; the Wardens mirror it from the north-east.
export const SPAWNS = {
  ember: [
    { x: -28, z: 28, yaw: -0.85 }, { x: -25.5, z: 30, yaw: -0.7 }, { x: -30, z: 25.5, yaw: -1.0 },
    { x: -26, z: 25, yaw: -0.85 }, { x: -29, z: 30.5, yaw: -0.75 },
  ],
  warden: [
    { x: 27, z: -27, yaw: 2.3 }, { x: 24.5, z: -29.5, yaw: 2.45 }, { x: 29.5, z: -24.5, yaw: 2.15 },
    { x: 25, z: -24.5, yaw: 2.3 }, { x: 29, z: -29.5, yaw: 2.4 },
  ],
};

// Waypoint graph: lanes, doors and site entries. Edges are walked both ways.
export const NODES = {
  espawn: [-27, 27], sw_yard: [-18, 24], west_s: [-33.6, 14], west_n: [-33.6, -4],
  a_main_out: [-21.5, -4.2], a_main_door: [-21.5, -10.5], siteA: [-21, -22],
  a_link_door: [-8, -23], a_link_out: [-2.5, -23], north_w: [-20, -33.9], north_e: [8, -33.9],
  wspawn: [27, -27], top_mid: [12, -18], mid_north: [2, -12], house_e: [8.6, -1],
  house_w: [-8.6, -1], house_in: [0, -1], mid_south: [0, 11.5], south_mid: [-8, 18],
  b_approach: [9, 16], siteB: [23.5, 24.5], south_lane: [16, 31], south_w: [-6, 30],
  b_long: [30, 6], a_top: [-14, -33.9],
};
export const EDGES = [
  ['espawn', 'sw_yard'], ['espawn', 'west_s'], ['sw_yard', 'south_mid'], ['sw_yard', 'south_w'],
  ['south_w', 'south_lane'], ['south_lane', 'siteB'], ['south_lane', 'b_approach'],
  ['b_approach', 'siteB'], ['b_approach', 'b_long'], ['b_approach', 'mid_south'],
  ['b_long', 'wspawn'], ['wspawn', 'north_e'], ['wspawn', 'a_link_out'],
  ['north_e', 'a_top'], ['a_top', 'north_w'], ['north_w', 'west_n'],
  ['west_n', 'west_s'], ['west_n', 'a_main_out'], ['a_main_out', 'a_main_door'],
  ['a_main_door', 'siteA'], ['siteA', 'a_link_door'], ['a_link_door', 'a_link_out'],
  ['a_link_out', 'top_mid'], ['top_mid', 'mid_north'], ['top_mid', 'b_approach'],
  ['mid_north', 'house_e'], ['house_e', 'house_in'], ['house_in', 'house_w'],
  ['house_w', 'south_mid'], ['house_in', 'mid_south'], ['mid_south', 'south_mid'],
  ['north_e', 'top_mid'],
];

// Where defenders settle at round start, per site plan.
export const POSTS = {
  A: ['siteA', 'a_link_door', 'a_main_door'],
  B: ['siteB', 'b_approach', 'b_long'],
  mid: ['house_e', 'top_mid'],
};

// Live smoke volumes: { x, z, r, until } — vision tests consult this list.
export const activeSmokes = [];
export function smokeAt(x, z, now) {
  for (const s of activeSmokes) {
    if (now > s.until) continue;
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz < s.r * s.r) return true;
  }
  return false;
}
export function pruneSmokes(now) {
  for (let i = activeSmokes.length - 1; i >= 0; i--) {
    if (now > activeSmokes[i].until) activeSmokes.splice(i, 1);
  }
}

const matCache = new Map();
function materialFor(box) {
  const key = box.mat + '|' + (box.tex ?? '');
  if (matCache.has(key)) return matCache.get(key);
  let map = null;
  if (box.tex === 'corrugated') map = corrugatedTexture();
  else if (box.tex === 'wood') map = woodTexture();
  else if (box.mat === 'concrete' || box.mat === 'concreteDark') map = concreteTexture();
  const mat = new THREE.MeshStandardMaterial({
    color: PALETTE[box.mat] ?? 0x888888, map, roughness: 0.92, metalness: 0.04,
  });
  matCache.set(key, mat);
  return mat;
}

// The dusk sky: a canvas gradient on a far dome — deep blue up top, a bruised purple
// middle, and the last ember-orange band of sunset sitting on the horizon the yard is
// named for. Basic material with fog off, so the grade never washes out with distance.
function buildSky(scene) {
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 256;
  const cx = cv.getContext('2d');
  const grad = cx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#0e1727');
  grad.addColorStop(0.30, '#243350');
  grad.addColorStop(0.43, '#4c4470');
  grad.addColorStop(0.485, '#c06a48');
  grad.addColorStop(0.515, '#eda050');
  grad.addColorStop(0.55, '#7c4636');
  grad.addColorStop(0.66, '#38303a');
  grad.addColorStop(1.0, '#2c2529');
  cx.fillStyle = grad; cx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(320, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }),
  );
  scene.add(dome);
}

// A soft radial glow sprite, the same trick the muzzle flash uses: lamps read as lit
// sources at dusk instead of bare poles, for the price of one shared texture.
function glowTexture() {
  return canvasTexture('glow', 128, 128, (ctx, w, h) => {
    const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,190,110,0.9)');
    grad.addColorStop(0.35, 'rgba(255,150,60,0.38)');
    grad.addColorStop(1, 'rgba(255,130,40,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  });
}

export function buildWorld(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  buildSky(scene);
  scene.fog = new THREE.Fog(PALETTE.fog, 46, 122);

  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.32);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.2);
  sun.position.set(-38, 42, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -46; sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 46; sun.shadow.camera.bottom = -46;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x46536e, 0.65));

  // Sodium yard lamps at the two sites and mid: warm pools of light for the dusk palette.
  // Each stands on its pole with an emissive head and a glow sprite, so the source of the
  // light is something the eye can find in the scene.
  const glowTex = glowTexture();
  for (const [x, z] of [[-21, -22], [23.5, 24.5], [0, -1]]) {
    const hx = x + 1.6, hz = z + 1.6;
    const lamp = new THREE.PointLight(0xffa050, 60, 26, 1.8);
    lamp.position.set(hx, 5.2, hz);
    scene.add(lamp);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 5.2, 6),
      new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.6, metalness: 0.6 }),
    );
    pole.position.set(hx, 2.6, hz);
    scene.add(pole);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.12, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0x2c2f33, emissive: 0xffa050, emissiveIntensity: 2.4, roughness: 0.5, metalness: 0.4,
      }),
    );
    head.position.set(hx, 5.24, hz);
    scene.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(4.2);
    glow.position.set(hx, 5.2, hz);
    scene.add(glow);
  }

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(76, 76),
    new THREE.MeshStandardMaterial({ map: groundTexture(), color: 0xffffff, roughness: 1 }),
  );
  ground.material.map.repeat.set(6, 6);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Painted site markings.
  for (const site of [SITES.A, SITES.B]) {
    const paint = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 13),
      new THREE.MeshBasicMaterial({
        map: sitePaintTexture(site.id, site.id === 'A' ? '#ffb36b' : '#7be0d4'),
        transparent: true, opacity: 0.38, depthWrite: false,
      }),
    );
    paint.rotation.x = -Math.PI / 2;
    paint.position.set(site.cx, 0.02, site.cz);
    scene.add(paint);
  }

  // Distant skyline silhouettes beyond the fence, for depth at the horizon.
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x1a212d });
  const skyline = [[-52, -20, 14, 26], [40, -48, 22, 18], [54, 14, 12, 30], [-20, 52, 26, 15], [8, -54, 16, 22]];
  for (const [x, z, w, h] of skyline) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 8), skyMat);
    m.position.set(x, h / 2, z);
    scene.add(m);
  }

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const colliders = [];
  for (const b of BOXES) {
    if (b.slab) {
      const m = new THREE.Mesh(unitBox, materialFor(b));
      m.scale.set(b.w, 0.25, b.d);
      m.position.set(b.cx, b.roofY, b.cz);
      m.castShadow = false; m.receiveShadow = true;
      scene.add(m);
      continue;
    }
    const base = b.stacked ? 1.15 : 0;
    const m = new THREE.Mesh(unitBox, materialFor(b));
    m.scale.set(b.w, b.h - base, b.d);
    m.position.set(b.cx, base + (b.h - base) / 2, b.cz);
    m.castShadow = b.h >= 0.9;
    m.receiveShadow = true;
    scene.add(m);
    colliders.push({
      minX: b.cx - b.w / 2, maxX: b.cx + b.w / 2,
      minZ: b.cz - b.d / 2, maxZ: b.cz + b.d / 2,
      top: b.h, base, blocksSight: b.h >= 1.35,
    });
  }
  return { colliders };
}
