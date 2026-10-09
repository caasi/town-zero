// client/src/tap.ts

/**
 * Runs fn when a press on el is released over el, as a desktop button does.
 * On pointerup, not click: iOS Safari sends no click for a tap while another
 * finger is down (on the D-pad, for example). A click with detail 0 comes
 * from a keyboard or a screen reader, which make no pointerup.
 */
export function onTap(el: HTMLElement, fn: () => void): void {
  el.addEventListener("pointerup", (e) => {
    if (e.button !== 0) return; // a right click is not a press
    // A touch pointer stays with the element it went down on, so check where it
    // was released: sliding off before the release cancels.
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (over && el.contains(over)) fn();
  });
  el.addEventListener("click", (e) => { if (e.detail === 0) fn(); });
}
