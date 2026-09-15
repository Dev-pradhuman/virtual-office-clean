// Shared timing configuration for the presence pulse-then-settle animation.
// Single source of truth used by both React components and CSS keyframes.

export const PRESENCE_TIMING = {
  /** Expanding halo that fires once on status change */
  haloMs: 900,
  /** Core dot scale-settle after status change */
  settleMs: 520,
  /** Continuous soft breathing for "online" dots */
  breatheMs: 2600,
  /** Shared easing curve for every presence transition */
  easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
} as const;

/** Inject shared presence timing values as CSS custom properties on :root. */
export function initPresenceTiming() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--presence-halo-duration", `${PRESENCE_TIMING.haloMs}ms`);
  root.style.setProperty("--presence-settle-duration", `${PRESENCE_TIMING.settleMs}ms`);
  root.style.setProperty("--presence-breathe-duration", `${PRESENCE_TIMING.breatheMs}ms`);
  root.style.setProperty("--presence-easing", PRESENCE_TIMING.easing);
}

/**
 * Compute a negative animation-delay that phase-locks a newly mounted
 * "online" dot to the shared breathing cycle, so every dot in the app —
 * sidebar, roster, call tiles — pulses in perfect unison.
 */
export function breathePhaseDelayMs(): number {
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  const { breatheMs, settleMs } = PRESENCE_TIMING;
  // Start of breathe is delayed by settleMs; then negatively offset by current phase.
  return settleMs - (now % breatheMs);
}
