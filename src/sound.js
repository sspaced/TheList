/**
 * Interface sounds — delegated to Cuelume (MIT, vendored under
 * `vendor/cuelume/`).
 *
 * My two hand-rolled clicks sounded cheap, and not because the code was bad: a
 * good interface sound is a DESIGNED object, tuned by ear. I cannot hear what I
 * write. Cuelume brings seventeen recipes tuned by someone who could.
 *
 * Why this one and not Howler or use-sound: those only PLAY a file, so we would
 * have to ship `.wav` assets (weight, licence, decode latency). Cuelume
 * synthesises through Web Audio — no asset bytes, no latency, and no transitive
 * dependency to audit. Checked before vendoring: no `fetch`, no `localStorage`,
 * no `eval` anywhere in it.
 *
 * Picking the recipes is a question of MEANING, not taste:
 *   - `tick`    menu selection — dry, instant, a detent;
 *   - `press`   removing an item — a dull knock, no sparkle; the action is
 *               destructive, it must not sound cheerful;
 *   - `toggle`  the sound switch — the click-clack of a mechanical flip.
 *
 * All seventeen can be auditioned on `src/sounds-preview.html`: that is where
 * the choice is made, by ear, not here.
 */
import { play, setEnabled, setVolume } from './vendor/cuelume/index.js';

let muted = false;

setVolume(0.9);

/** The state is persisted: a sound that was silenced must stay silenced. */
export async function loadMute() {
  try {
    const r = await chrome.storage.local.get({ muted: false });
    muted = !!r.muted;
  } catch {
    muted = false;
  }
  setEnabled(!muted);
  return muted;
}

export function isMuted() {
  return muted;
}

export async function setMuted(v) {
  muted = !!v;
  setEnabled(!muted);
  try {
    await chrome.storage.local.set({ muted });
  } catch {}
}

// An unavailable sound is never a reason to break a click.
const safe = (name) => () => {
  try {
    play(name);
  } catch {}
};

/** Selection, detent, opening a menu. */
export const tick = safe('tick');
/** Destructive action — removing an item. */
export const tock = safe('press');
/** Flipping the sound switch. */
export const flip = safe('toggle');
