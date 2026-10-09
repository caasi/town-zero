// client/src/controller.ts
import type { InputHandler, TouchCode } from "./input.js";

const DEAD_ZONE_PX = 10;

/** The direction for a touch at (dx, dy) from the D-pad center; null near the center. */
export function padDirection(dx: number, dy: number): TouchCode | null {
  if (Math.hypot(dx, dy) < DEAD_ZONE_PX) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "TouchRight" : "TouchLeft";
  return dy > 0 ? "TouchDown" : "TouchUp";
}

export interface Controller {
  /** Lets go of the D-pad; call when the controller hides under a finger. */
  release(): void;
}

/**
 * Binds the touch controller once; input is recreated on each join, so it is
 * read through a getter.
 */
export function bindController(getInput: () => InputHandler | null): Controller {
  const pad = document.getElementById("dpad")!;
  const actionBtn = document.getElementById("action-btn")!;

  let padPointer: number | null = null;
  const steer = (e: PointerEvent) => {
    if (e.pointerId !== padPointer) return;
    const r = pad.getBoundingClientRect();
    const dir = padDirection(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    getInput()?.setTouchDirection(dir);
    for (const el of pad.children) el.classList.toggle("held", el.getAttribute("data-code") === dir);
  };
  const releasePad = () => {
    padPointer = null;
    getInput()?.setTouchDirection(null);
    for (const el of pad.children) el.classList.remove("held");
  };
  // A pad hidden under a finger may get no pointerup, and a pointer that is
  // never released would make the pad ignore every later touch.
  const release = (e: PointerEvent) => {
    if (e.pointerId === padPointer) releasePad();
  };
  pad.addEventListener("pointerdown", (e) => {
    if (padPointer !== null) return; // a second finger on the pad does not steer
    padPointer = e.pointerId;
    // Capture keeps the moves coming when the finger slides off the pad.
    pad.setPointerCapture(e.pointerId);
    steer(e);
  });
  pad.addEventListener("pointermove", steer);
  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);
  pad.addEventListener("lostpointercapture", release);

  // Full screen on a touch of the controller, again after the player leaves
  // it. On pointerup: for touch, only pointerup is a user activation, and
  // requestFullscreen needs one. iPhone Safari has no page full screen.
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  document.getElementById("controller")!.addEventListener("pointerup", () => {
    if (document.fullscreenElement) return;
    try {
      if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
      else root.webkitRequestFullscreen?.();
    } catch { /* not allowed here; the page works without it */ }
  });

  // On pointerup, not click: iOS Safari sends no click for a tap while another
  // finger holds the D-pad. A click with detail 0 comes from a keyboard or a
  // screen reader, which make no pointerup.
  const act = () => {
    getInput()?.interact();
    // A focused button would take the next Space or Enter from a keyboard.
    actionBtn.blur();
  };
  actionBtn.addEventListener("pointerup", act);
  actionBtn.addEventListener("click", (e) => { if (e.detail === 0) act(); });
  // Back: later it opens the system menu (issue #14).

  return { release: releasePad };
}
