// The deck's two everyday settings, the volume knob and the auto-changer, and the maths
// behind them. Remembered in this browser only, like the record looks.
const KEY = 'lp:deck';

export const KNOB_SWEEP = 270; // degrees from silent to full, centred on twelve o'clock

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

export function knobAngle(level) {
  return -KNOB_SWEEP / 2 + clamp01(level) * KNOB_SWEEP;
}

// The hand turns the knob evenly but the ear doesn't hear evenly: squaring makes the lower half usable.
export function gainFor(level) {
  const l = clamp01(level);
  return l * l;
}

// Dragging up turns it up; a full sweep takes `travel` pixels.
export function levelAfterDrag(start, dy, travel = 200) {
  return clamp01(start - dy / travel);
}

// The record after this one in the crate, round to the first after the last.
export function nextAlbum(albums, id) {
  if (!albums.length) return null;
  const i = albums.findIndex((a) => a.id === id);
  return albums[(i + 1) % albums.length];
}

export function createDeckSettings(...args) {
  let storage = args[0];
  let saved = {};
  try {
    if (args.length === 0) storage = globalThis.localStorage; // throws when site data is blocked
    const v = JSON.parse(storage.getItem(KEY) ?? '{}');
    if (v && typeof v === 'object') saved = v;
  } catch { storage = null; }

  const s = {
    volume: Number.isFinite(saved.volume) ? clamp01(saved.volume) : 1,
    autoChange: typeof saved.autoChange === 'boolean' ? saved.autoChange : true,
  };
  const save = () => {
    try { storage?.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ }
  };

  return {
    get volume() { return s.volume; },
    get autoChange() { return s.autoChange; },
    setVolume(v) { s.volume = clamp01(v); save(); return s.volume; },
    setAutoChange(on) { s.autoChange = !!on; save(); return s.autoChange; },
  };
}
