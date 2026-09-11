/**
 * Keyboard input for two local players. Physical key codes, so the layout
 * works on any keyboard. Bindings live in config.js.
 *
 * P1: WASD move · Space jump · Left Shift run · J light · I heavy
 *     K kick · L block · U dash
 * P2: Arrows move · Slash jump · Comma run · Period light · H heavy
 *     M kick · N block · B dash
 */

import { INPUT_MAPS } from './config.js';

const held = new Set();
const pressedThisFrame = new Set();

export function initInput(target = window) {
  target.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    // Stop Space/arrows from scrolling the window.
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    held.add(e.code);
    pressedThisFrame.add(e.code);
  });
  target.addEventListener('keyup', (e) => held.delete(e.code));
  // Losing focus mid-key would otherwise leave a button stuck down.
  target.addEventListener('blur', () => { held.clear(); pressedThisFrame.clear(); });
}

/** Call once at the end of every frame. */
export function endInputFrame() {
  pressedThisFrame.clear();
}

/** A controller object a Fighter can read, matching the AI intent shape. */
export function keyboardController(prefix) {
  const map = INPUT_MAPS[prefix] ?? INPUT_MAPS.p1;
  return {
    move() {
      const x = (held.has(map.right) ? 1 : 0) - (held.has(map.left) ? 1 : 0);
      const y = (held.has(map.down) ? 1 : 0) - (held.has(map.up) ? 1 : 0);
      const len = Math.hypot(x, y);
      return len > 1 ? { x: x / len, y: y / len } : { x, y };
    },
    pressed: (action) => pressedThisFrame.has(map[action]),
    held: (action) => held.has(map[action]),
  };
}
