// hud.js — everything drawn over the 3D view: health and armour, ammunition and money, the
// round clock and score, a live minimap, the killfeed, round banners, the buy menu, and the
// full-screen flashes (a Lumen going off in your face, damage, the Longbow's scope). It only
// reads state and drains events; it never touches the simulation.

import { MATCH, WEAPONS, GRENADES, ECONOMY, BUY_ORDER } from './config.js';
import { state, currentWeaponKey, isGrenadeSlot } from './state.js';
import { buyItem, spreadFor } from './weapons.js';
import * as SFX from './audio.js';

const el = {};
let minimapCtx = null;
let wallRects = [];
let flashStrength = 0;
let dmgPulse = 0;
let dmgDirPulse = 0;   // the damage-direction arc fades on this, like dmgPulse
let bannerUntil = 0;
let nextBeepAt = 0;
export let buyOpen = false;

export function initHud(colliders) {
  for (const id of ['crosshair', 'hitmarker', 'timer', 'roundLabel', 'scoreEmber', 'scoreWarden',
    'hpBar', 'hpText', 'armorTag', 'ammoMag', 'ammoReserve', 'weaponName', 'money', 'killfeed',
    'banner', 'subbanner', 'objective', 'buymenu', 'buyGrid', 'buyMoney', 'flashOverlay',
    'dmgOverlay', 'dmgDir', 'scopeOverlay', 'channelWrap', 'channelFill', 'channelLabel', 'chargeTag',
    'pipsEmber', 'pipsWarden', 'nadeRow', 'menuOverlay', 'endOverlay', 'endTitle', 'endScore']) {
    el[id] = document.getElementById(id);
  }
  minimapCtx = document.getElementById('minimap').getContext('2d');
  wallRects = colliders.filter((c) => c.top >= 1.35);
  el.buymenu.addEventListener('click', (e) => {
    const key = e.target?.dataset?.buy;
    if (key) buy(item => item === key);
  });
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function buy(matchFn) {
  for (const item of BUY_ORDER) {
    if (!matchFn(item)) continue;
    if (buyItem(state.player, item)) SFX.sfxBuy();
    else SFX.sfxDenied();
    renderBuyMenu();
    return;
  }
}

// Number keys buy while the menu is open (they are also the weapon slots when it is not;
// player.js checks buyOpen first through hudBuyKey).
export function hudBuyKey(code) {
  const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].indexOf(code);
  if (idx >= 0 && BUY_ORDER[idx]) buy((item) => item === BUY_ORDER[idx]);
}

export function setBuyOpen(open) {
  buyOpen = open;
  el.buymenu.style.display = open ? 'block' : 'none';
  if (open) renderBuyMenu();
}

function priceOf(item) {
  if (item === 'armor') return ECONOMY.armorPrice;
  if (GRENADES[item]) return GRENADES[item].price;
  return WEAPONS[item].price;
}

function nameOf(item) {
  if (item === 'armor') return 'Kevlar Vest';
  if (GRENADES[item]) return GRENADES[item].name;
  return WEAPONS[item].name;
}

function ownedOf(p, item) {
  if (item === 'armor') return p.inv.armor;
  if (GRENADES[item]) return p.inv.nades[item] > 0;
  return p.inv.primary === item;
}

function renderBuyMenu() {
  const p = state.player;
  if (!p) return;
  el.buyMoney.textContent = `$${p.money}`;
  el.buyGrid.innerHTML = BUY_ORDER.map((item, i) => {
    const owned = ownedOf(p, item);
    const afford = p.money >= priceOf(item);
    const cls = owned ? 'owned' : afford ? '' : 'poor';
    return `<button class="buyItem ${cls}" data-buy="${item}">
      <span class="buyKey">${i + 1}</span>
      <span class="buyName">${nameOf(item)}</span>
      <span class="buyPrice">${owned ? 'OWNED' : '$' + priceOf(item)}</span>
    </button>`;
  }).join('');
}

// --- events -----------------------------------------------------------------------

export function hudEvent(ev) {
  const p = state.player;
  switch (ev.type) {
    case 'kill': {
      const kn = ev.killer ? (ev.killer.isPlayer ? 'YOU' : ev.killer.name) : '—';
      const vn = ev.victim.isPlayer ? 'YOU' : ev.victim.name;
      const head = ev.part === 'head' ? ' ⌖' : '';
      const row = document.createElement('div');
      row.className = 'feedRow' + (ev.victim.team === 'ember' ? ' foeDown' : ' friendDown');
      row.innerHTML = `<b class="${ev.killer?.team ?? ''}">${kn}</b> ▸ <b class="${ev.victim.team}">${vn}</b>${head}`;
      el.killfeed.prepend(row);
      while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
      setTimeout(() => row.remove(), 5200);
      if (ev.killer?.isPlayer) {
        SFX.sfxHit(true);
        // A kill confirms in red, where a plain hit only blips amber.
        el.hitmarker.classList.add('on', 'kill');
        setTimeout(() => el.hitmarker.classList.remove('on', 'kill'), 190);
      }
      break;
    }
    case 'damage':
      if (ev.attacker?.isPlayer) {
        el.hitmarker.classList.add('on');
        setTimeout(() => el.hitmarker.classList.remove('on'), 110);
        SFX.sfxHit(ev.part === 'head');
      }
      if (ev.target?.isPlayer) {
        dmgPulse = Math.min(1, dmgPulse + 0.45);
        if (ev.attacker) pointDamageArc(ev.attacker.x, ev.attacker.z);
        SFX.sfxHurt();
      }
      break;
    case 'roundStart':
      showBanner(`ROUND ${ev.round}`, state.round === 1 ? 'First to 9 takes the match' : '');
      setBuyOpen(true);
      break;
    case 'liveStart':
      setBuyOpen(false);
      showBanner('GO', 'Eliminate the Wardens — or plant the charge', 1200);
      break;
    case 'planted':
      showBanner('CHARGE PLANTED', `Site ${ev.site.id} — ${ev.site.name}. Hold the site.`, 2600);
      SFX.sfxPlantDone();
      nextBeepAt = 0;
      break;
    case 'defused':
      showBanner('CHARGE DEFUSED', '', 2200);
      break;
    case 'detonate':
      SFX.sfxExplosion(true);
      break;
    case 'roundEnd': {
      const won = ev.winner === 'ember';
      const reasons = {
        elimination: won ? 'Wardens eliminated' : 'Ember team eliminated',
        detonation: 'Charge detonated',
        defused: 'Charge defused',
        time: 'Time expired — site held',
      };
      showBanner(won ? 'ROUND WON' : 'ROUND LOST',
        `${reasons[ev.reason] ?? ''} · Ember ${state.score.ember} — ${state.score.warden} Warden`, 3400);
      SFX.sfxRoundWin(won);
      setBuyOpen(false);
      break;
    }
    case 'matchEnd':
      break;
    case 'flashPlayer':
      flashStrength = Math.max(flashStrength, ev.strength);
      break;
    case 'chargeDropped':
      if (p?.team === 'ember') showBanner('CHARGE DROPPED', 'Recover it — the round needs it planted', 2000);
      break;
    case 'chargePickup':
      if (ev.by?.isPlayer) showBanner('CHARGE RECOVERED', 'Get it to a site and hold E to plant', 1800);
      break;
  }
}

// The damage-direction arc: a ring segment around the crosshair, rotated so it sits on
// the side the shot came from. Bearings use the aim convention — the attacker's world
// bearing as a yaw, minus the player's own yaw, is where it lands relative to the view.
function pointDamageArc(ax, az) {
  const p = state.player;
  if (!p || !el.dmgDir) return;
  let rel = Math.atan2(-(ax - p.x), -(az - p.z)) - p.yaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  el.dmgDir.style.transform = `translate(-50%, -50%) rotate(${(-rel * 180 / Math.PI).toFixed(1)}deg)`;
  dmgDirPulse = 1;
}

// Staging hook for the screenshot scenes: light the arc as if a shot had just arrived
// from (ax, az), and hold the damage vignette with it.
export function showDamageFrom(ax, az) {
  pointDamageArc(ax, az);
  dmgPulse = Math.max(dmgPulse, 0.7);
}

function showBanner(text, sub = '', holdMs = 2400) {
  el.banner.textContent = text;
  el.subbanner.textContent = sub;
  el.banner.style.opacity = '1';
  el.subbanner.style.opacity = '1';
  bannerUntil = performance.now() + holdMs;
}

export function hideBanner() {
  bannerUntil = 0;
  if (el.banner) { el.banner.style.opacity = '0'; el.subbanner.style.opacity = '0'; }
}

// --- per-frame ----------------------------------------------------------------------

function drawMinimap() {
  const ctx = minimapCtx;
  if (!ctx) return;
  const S = 176, W2P = S / 76;
  ctx.fillStyle = 'rgba(16,19,24,0.82)';
  ctx.fillRect(0, 0, S, S);
  const px = (x) => (x + 38) * W2P, pz = (z) => (z + 38) * W2P;
  ctx.fillStyle = 'rgba(255,150,60,0.20)';
  ctx.fillRect(px(-30), pz(-30), 18 * W2P, 16 * W2P);
  ctx.fillStyle = 'rgba(90,220,205,0.16)';
  ctx.fillRect(px(16), pz(17), 15 * W2P, 15 * W2P);
  ctx.fillStyle = '#565e68';
  for (const c of wallRects) {
    ctx.fillRect(px(c.minX), pz(c.minZ), (c.maxX - c.minX) * W2P, (c.maxZ - c.minZ) * W2P);
  }
  ctx.font = 'bold 10px system-ui';
  ctx.fillStyle = '#ffb36b'; ctx.fillText('A', px(-22.5), pz(-19));
  ctx.fillStyle = '#7be0d4'; ctx.fillText('B', px(22.5), pz(27));
  const now = state.nowMs;
  if (state.charge?.mode === 'planted' && (now % 700) < 380) {
    ctx.fillStyle = '#ff5040';
    ctx.beginPath(); ctx.arc(px(state.charge.x), pz(state.charge.z), 4, 0, 7); ctx.fill();
  } else if (state.charge?.mode === 'dropped') {
    ctx.fillStyle = '#ffd24d';
    ctx.fillRect(px(state.charge.x) - 2.5, pz(state.charge.z) - 2.5, 5, 5);
  }
  for (const f of state.fighters) {
    if (!f.alive || f.team !== 'ember') continue;
    ctx.fillStyle = f.isPlayer ? '#ffffff' : '#ff9a3c';
    ctx.beginPath(); ctx.arc(px(f.x), pz(f.z), f.isPlayer ? 3.4 : 2.6, 0, 7); ctx.fill();
    if (f.isPlayer) {
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(px(f.x), pz(f.z));
      ctx.lineTo(px(f.x) - Math.sin(f.yaw) * 9, pz(f.z) - Math.cos(f.yaw) * 9);
      ctx.stroke();
    }
  }
}

export function updateHud(dt) {
  const p = state.player;
  if (!p) return;
  const now = state.nowMs;

  // Clock and score.
  el.scoreEmber.textContent = state.score.ember;
  el.scoreWarden.textContent = state.score.warden;
  el.roundLabel.textContent = `ROUND ${state.round}`;
  if (state.phase === 'buy') el.timer.textContent = 'BUY ' + fmtTime(state.phaseT);
  else if (state.phase === 'planted') el.timer.textContent = fmtTime(state.charge.fuseT);
  else if (state.phase === 'end' || state.phase === 'over') el.timer.textContent = '—';
  else el.timer.textContent = fmtTime(state.phaseT);
  el.timer.classList.toggle('urgent', state.phase === 'planted' || (state.phase === 'live' && state.phaseT < 11));

  const pips = (team) => state.fighters.filter((f) => f.team === team)
    .map((f) => `<i class="${f.alive ? 'on' : ''}"></i>`).join('');
  el.pipsEmber.innerHTML = pips('ember');
  el.pipsWarden.innerHTML = pips('warden');

  // Vitals.
  el.hpText.textContent = Math.max(0, Math.ceil(p.hp));
  el.hpBar.style.width = `${Math.max(0, p.hp)}%`;
  el.hpBar.style.background = p.hp > 50 ? '#e8e4da' : p.hp > 25 ? '#f0a830' : '#e5484d';
  el.armorTag.style.visibility = p.inv.armor ? 'visible' : 'hidden';

  // Weapon and money.
  const key = currentWeaponKey(p);
  const nade = isGrenadeSlot(p.current);
  el.weaponName.textContent = nade ? GRENADES[p.current].name : (WEAPONS[key]?.name ?? '—');
  if (nade) {
    el.ammoMag.textContent = p.inv.nades[p.current];
    el.ammoReserve.textContent = '';
  } else if (key) {
    el.ammoMag.textContent = p.ammo[key]?.mag ?? 0;
    el.ammoReserve.textContent = p.ammo[key]?.reserve ?? 0;
    if (p.reloadT > 0) el.ammoMag.textContent = '···';
  }
  el.money.textContent = `$${p.money}`;
  el.nadeRow.innerHTML = ['shard', 'lumen', 'veil'].map((g) =>
    `<span class="nade ${p.current === g ? 'sel' : ''}">${GRENADES[g].name.split(' ')[0]} ×${p.inv.nades[g]}</span>`).join('');

  // Crosshair gap follows the true spread, so the HUD teaches the gunplay.
  if (key && !nade) {
    const gap = 5 + spreadFor(p, WEAPONS[key]) * 5.2;
    el.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  }
  el.crosshair.style.display = (p.alive && !(p.aiming && key === 'longbow')) ? 'block' : 'none';
  el.scopeOverlay.style.display = (p.aiming && key === 'longbow' && p.alive) ? 'block' : 'none';

  // Charge tag and context objective line.
  el.chargeTag.style.display = p.hasCharge ? 'block' : 'none';
  let objective = '';
  if (state.phase === 'buy') objective = 'Buy phase — press B for the buy menu';
  else if (state.phase === 'live' && p.hasCharge) objective = 'Carry the charge to Site A or B — hold E to plant';
  else if (state.phase === 'live' && state.charge?.mode === 'dropped') objective = 'The charge is down — recover it';
  else if (state.phase === 'planted') objective = `Charge live at Site ${state.charge.site.id} — defend it`;
  else if (!p.alive) objective = 'You are down — your team fights on';
  el.objective.textContent = objective;

  // Channel progress (planting).
  if (p.channel) {
    el.channelWrap.style.display = 'block';
    el.channelLabel.textContent = p.channel.kind === 'plant' ? 'PLANTING THE CHARGE' : 'DEFUSING';
    el.channelFill.style.width = `${Math.min(100, p.channel.t / p.channel.need * 100)}%`;
  } else {
    el.channelWrap.style.display = 'none';
  }

  // Planted-charge beeps quicken as the fuse burns down.
  if (state.phase === 'planted') {
    const fuse = state.charge.fuseT;
    const interval = fuse > 20 ? 1000 : fuse > 10 ? 500 : 250;
    if (now >= nextBeepAt) {
      SFX.sfxBeep(fuse <= 1.2);
      nextBeepAt = now + interval;
    }
  }

  // Overlays decay.
  if (flashStrength > 0.003) {
    flashStrength = Math.max(0, flashStrength - dt * 0.55);
    el.flashOverlay.style.opacity = String(Math.min(1, flashStrength));
  } else el.flashOverlay.style.opacity = '0';
  if (dmgPulse > 0.003) {
    dmgPulse = Math.max(0, dmgPulse - dt * 1.6);
    el.dmgOverlay.style.opacity = String(dmgPulse * 0.55);
  } else el.dmgOverlay.style.opacity = '0';
  if (dmgDirPulse > 0.003) {
    dmgDirPulse = Math.max(0, dmgDirPulse - dt * 1.1);
    el.dmgDir.style.opacity = String(Math.min(1, dmgDirPulse * 1.4));
  } else el.dmgDir.style.opacity = '0';

  if (performance.now() > bannerUntil) {
    el.banner.style.opacity = '0';
    el.subbanner.style.opacity = '0';
  }

  drawMinimap();
}
