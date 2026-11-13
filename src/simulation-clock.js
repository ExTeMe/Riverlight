export const SIMULATION_STEP = 1 / 30;
const MAX_FRAME_TIME = .25;
const STEP_TOLERANCE = 1e-9;

export class SimulationClock {
  constructor() {
    this.paused = false;
    this.reset();
  }

  reset() {
    this.ticks = 0;
    this.remainder = 0;
  }

  get time() { return this.ticks * SIMULATION_STEP; }

  advance(seconds, step) {
    if (this.paused || !Number.isFinite(seconds) || seconds <= 0) return;
    // Bound catch-up after a stall. Only the fractional step carries to the next frame.
    this.remainder += Math.min(seconds, MAX_FRAME_TIME);
    while (this.remainder + STEP_TOLERANCE >= SIMULATION_STEP) {
      this.remainder = Math.max(0, this.remainder - SIMULATION_STEP);
      this.ticks++;
      step(SIMULATION_STEP, this.time);
    }
  }
}
