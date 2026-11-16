// input.js — raw keyboard and mouse state, nothing more. The player module reads the held
// keys and accumulated mouse movement each step; discrete presses (buy keys, weapon slots,
// reload) go through the onKey callback so a press is never lost between frames.

export const input = {
  keys: new Set(),
  mouseDX: 0,
  mouseDY: 0,
  firing: false,
  aiming: false,
  locked: false,
};

export function initInput(element, onKey) {
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    if (!e.repeat) onKey(e.code, true);
    input.keys.add(e.code);
  });
  document.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
    onKey(e.code, false);
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX ?? 0;
    input.mouseDY += e.movementY ?? 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.aiming = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === element;
    if (!input.locked) { input.firing = false; input.aiming = false; }
  });
}

export function lockPointer(element) {
  element.requestPointerLock?.();
}

// Drain the accumulated mouse movement (called once per rendered frame).
export function consumeMouse() {
  const dx = input.mouseDX, dy = input.mouseDY;
  input.mouseDX = 0;
  input.mouseDY = 0;
  return { dx, dy };
}

export function keyDown(code) {
  return input.keys.has(code);
}
