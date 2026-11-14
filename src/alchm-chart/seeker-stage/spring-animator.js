/**
 * ============================================================================
 * Pentacles — Lightweight Multi-Channel Spring Animator (Zero Dependencies)
 * ============================================================================
 * Semi-implicit Euler damped harmonic oscillator for smooth ~180ms settling
 * of the 4-Point ESMS Alchemical Diamond and brass vernier hairline projections.
 *
 * Resource-First Profile:
 *   - Pre-allocated channel records (no per-frame object allocation)
 *   - Automatically halts requestAnimationFrame loop once all channels settle
 *   - Respects prefers-reduced-motion and headless test environments
 */

const DEFAULT_STIFFNESS = 320;
const DEFAULT_DAMPING = 30;
const REST_EPSILON = 0.08;

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export class SpringAnimator {
  /**
   * @param {object} opts
   * @param {number} [opts.stiffness=320]
   * @param {number} [opts.damping=30]
   * @param {(values: Record<string, number>) => void} [opts.onFrame]
   */
  constructor(opts = {}) {
    this.stiffness = opts.stiffness ?? DEFAULT_STIFFNESS;
    this.damping = opts.damping ?? DEFAULT_DAMPING;
    this.onFrame = typeof opts.onFrame === 'function' ? opts.onFrame : null;
    /** @type {Map<string, { current: number, target: number, velocity: number }>} */
    this.channels = new Map();
    /** @type {Record<string, number>} */
    this.snapshot = {};
    this._rafId = null;
    this._lastTs = 0;
    this._disposed = false;
    this._tickBound = (ts) => this._tick(ts);
  }

  /**
   * Set targets for one or more named channels.
   * @param {Record<string, number>} nextTargets
   * @param {{ immediate?: boolean }} [options]
   */
  setTargets(nextTargets, options = {}) {
    if (this._disposed || !nextTargets) return;
    const immediate = Boolean(
      options.immediate ||
      prefersReducedMotion() ||
      typeof requestAnimationFrame !== 'function'
    );

    let needsTick = false;
    for (const key of Object.keys(nextTargets)) {
      const val = Number(nextTargets[key]);
      if (!Number.isFinite(val)) continue;
      let ch = this.channels.get(key);
      if (!ch) {
        ch = { current: val, target: val, velocity: 0 };
        this.channels.set(key, ch);
        this.snapshot[key] = val;
      } else if (immediate) {
        ch.current = val;
        ch.target = val;
        ch.velocity = 0;
        this.snapshot[key] = val;
      } else {
        ch.target = val;
        if (Math.abs(ch.target - ch.current) > REST_EPSILON || Math.abs(ch.velocity) > REST_EPSILON) {
          needsTick = true;
        }
      }
    }

    if (immediate) {
      this._cancelRaf();
      if (this.onFrame) this.onFrame(this.snapshot);
      return;
    }

    if (needsTick && this._rafId === null) {
      this._lastTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this._rafId = requestAnimationFrame(this._tickBound);
    } else if (!needsTick && this.onFrame) {
      this.onFrame(this.snapshot);
    }
  }

  /**
   * Step the physics simulation manually by dtSeconds (useful in deterministic unit tests).
   * @param {number} dtSeconds
   * @returns {boolean} true if still in motion, false if settled
   */
  step(dtSeconds) {
    if (this._disposed) return false;
    // Clamp timestep to avoid numerical blowup after background tab suspension
    const dt = Math.min(0.032, Math.max(0.001, dtSeconds));
    let moving = false;

    for (const [key, ch] of this.channels.entries()) {
      const displacement = ch.current - ch.target;
      const springForce = -this.stiffness * displacement;
      const dampingForce = -this.damping * ch.velocity;
      const accel = springForce + dampingForce;

      ch.velocity += accel * dt;
      ch.current += ch.velocity * dt;

      if (Math.abs(ch.target - ch.current) <= REST_EPSILON && Math.abs(ch.velocity) <= REST_EPSILON) {
        ch.current = ch.target;
        ch.velocity = 0;
      } else {
        moving = true;
      }
      this.snapshot[key] = ch.current;
    }

    if (this.onFrame) {
      this.onFrame(this.snapshot);
    }
    return moving;
  }

  _tick(ts) {
    this._rafId = null;
    if (this._disposed) return;
    const dt = this._lastTs > 0 ? (ts - this._lastTs) / 1000 : 1 / 60;
    this._lastTs = ts;

    const moving = this.step(dt);
    if (moving && !this._disposed && typeof requestAnimationFrame === 'function') {
      this._rafId = requestAnimationFrame(this._tickBound);
    }
  }

  _cancelRaf() {
    if (this._rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._rafId);
    }
    this._rafId = null;
  }

  getValues() {
    return this.snapshot;
  }

  dispose() {
    this._disposed = true;
    this._cancelRaf();
    this.channels.clear();
    this.onFrame = null;
  }
}
