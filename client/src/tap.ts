// client/src/tap.ts

const CLICK_AFTER_TAP_MS = 500;

/**
 * Runs fn when a press on el is released over el, as a desktop button does.
 * On pointerup, not click: iOS Safari sends no click for a tap while another
 * finger is down (on the D-pad, for example). A click with detail 0 comes
 * from a keyboard or a screen reader, which make no pointerup.
 */
export function onTap(el: HTMLElement, fn: () => void): void {
  // A mouse has no implicit capture: its pointerup goes to whatever is under
  // it, so a press that began elsewhere must not count.
  let down: number | null = null;
  let tappedAt = -Infinity;
  el.addEventListener("pointerdown", (e) => {
    down = e.button === 0 ? e.pointerId : null;
    // Capture, so the release comes back to el even off it and clears `down`;
    // a mouse keeps one pointerId, and a stale one would let a later press
    // from elsewhere act.
    if (down !== null) el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointercancel", () => { down = null; });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== down) return; // not pressed here, or not the primary button
    down = null;
    // A touch pointer stays with the element it went down on, so check where it
    // was released: sliding off before the release cancels.
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (over && el.contains(over)) { tappedAt = e.timeStamp; fn(); }
  });
  // The click after a tap must not act again, also on a browser that reports
  // detail 0 for a touch click.
  el.addEventListener("click", (e) => {
    if (e.detail === 0 && e.timeStamp - tappedAt > CLICK_AFTER_TAP_MS) fn();
  });
}
