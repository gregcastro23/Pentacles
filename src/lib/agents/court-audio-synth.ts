/**
 * Procedural Web Audio synthesizer for Pentacle Court elemental combat clash transients.
 * Triggers distinct procedural audio profiles matched to the 4 ESMS attack choreographies:
 * - spirit: flame crackle (bandpass-filtered noise burst with rapid flutter)
 * - essence: harmonic wave (dual resonant sine/triangle sweep with lowpass resonance)
 * - matter: sub-bass slam (punchy pitch-dropped sub-bass thud 140Hz -> 42Hz)
 * - substance: high-pass slash (razor-sharp high-pass white noise transient)
 */

export type EsmsAudioElement = 'spirit' | 'essence' | 'matter' | 'substance';

export class CourtAudioSynth {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;
  private brushBuffer: AudioBuffer | null = null;
  private activeBrushSource: AudioBufferSourceNode | null = null;
  private lastBrushTime: number = -1;

  constructor() {
    // Lazily initialized on first user interaction or trigger
  }

  public getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        try {
          this.ctx = new AudioCtx();
        } catch {
          this.ctx = null;
        }
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled && !this.isGloballyMuted();
  }

  private isGloballyMuted(): boolean {
    if (!this.enabled) return true;
    if (typeof window !== 'undefined' && Boolean((window as any).synth?.muted)) {
      return true;
    }
    return false;
  }

  public triggerClash(element: EsmsAudioElement): void {
    if (this.isGloballyMuted()) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    switch (element) {
      case 'spirit':
        this.playSpiritFlameCrackle(ctx, now);
        break;
      case 'essence':
        this.playEssenceHarmonicWave(ctx, now);
        break;
      case 'matter':
        this.playMatterSubBassSlam(ctx, now);
        break;
      case 'substance':
        this.playSubstanceHighPassSlash(ctx, now);
        break;
    }
  }

  /**
   * Soft linen/parchment card brush (~45ms velvet bandpass noise transient)
   * triggered when sweeping across Tarot cards in the Observatory.
   * Uses a ~40ms real-time debounce and single-voice stealing so rapid cursor
   * sweeps across 6–7 cards never stack or clip.
   */
  public triggerCardBrush(): void {
    if (this.isGloballyMuted()) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (this.lastBrushTime >= 0 && now > this.lastBrushTime && now - this.lastBrushTime < 0.04) {
      return;
    }
    this.lastBrushTime = now;

    try {
      if (this.activeBrushSource) {
        try {
          this.activeBrushSource.stop();
          this.activeBrushSource.disconnect();
        } catch {
          // Ignored if already stopped
        }
        this.activeBrushSource = null;
      }

      const duration = 0.045;
      const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
      if (!this.brushBuffer || this.brushBuffer.length !== bufferSize) {
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          const env = Math.sin((i / bufferSize) * Math.PI);
          data[i] = (Math.random() * 2 - 1) * env * 0.52;
        }
        this.brushBuffer = buffer;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = this.brushBuffer;
      this.activeBrushSource = noise;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(950, now);
      filter.frequency.exponentialRampToValueAtTime(1350, now + duration);
      filter.Q.setValueAtTime(1.6, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.085, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
    } catch {
      // Graceful fallback if Web Audio is restricted
    }
  }

  /**
   * Muted brass/wood astrolabe armillary detent click (~95ms damped harmonic impulse)
   * triggered when locking a Siege card slot or focusing a natal planet glyph.
   */
  public triggerAstrolabeDetent(freqHz = 320): void {
    if (this.isGloballyMuted()) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    try {
      const base = Math.max(120, Math.min(960, Number(freqHz) || 320));
      const duration = 0.095;

      const bodyOsc = ctx.createOscillator();
      const brassOvertone = ctx.createOscillator();
      bodyOsc.type = 'triangle';
      brassOvertone.type = 'sine';

      bodyOsc.frequency.setValueAtTime(base, now);
      bodyOsc.frequency.exponentialRampToValueAtTime(base * 0.45, now + duration);
      brassOvertone.frequency.setValueAtTime(base * 1.5, now);
      brassOvertone.frequency.exponentialRampToValueAtTime(base * 0.75, now + duration * 0.8);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1450, now);
      filter.frequency.exponentialRampToValueAtTime(420, now + duration);
      filter.Q.setValueAtTime(2.2, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      bodyOsc.connect(filter);
      brassOvertone.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      bodyOsc.start(now);
      brassOvertone.start(now);
      bodyOsc.stop(now + duration);
      brassOvertone.stop(now + duration);
    } catch {
      // Graceful fallback
    }
  }

  /**
   * Warm Pythagorean fifth (3:2) singing-bowl swell (~520ms) tuned to a card's
   * planetary frequency (styling.audioFrequencyHz) upon Duplicate Card Fusion.
   */
  public triggerCrucibleHarmonic(baseHz = 432): void {
    if (this.isGloballyMuted()) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    try {
      const rootHz = Math.max(144, Math.min(880, Number(baseHz) || 432));
      const fifthHz = rootHz * 1.5; // Just Pythagorean 3:2 fifth
      const duration = 0.52;

      const rootOsc = ctx.createOscillator();
      const fifthOsc = ctx.createOscillator();
      rootOsc.type = 'sine';
      fifthOsc.type = 'triangle';

      rootOsc.frequency.setValueAtTime(rootHz, now);
      fifthOsc.frequency.setValueAtTime(fifthHz, now);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1600, now);
      filter.frequency.exponentialRampToValueAtTime(720, now + duration);
      filter.Q.setValueAtTime(2.8, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.002, now);
      gain.gain.linearRampToValueAtTime(0.22, now + 0.065);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      rootOsc.connect(filter);
      fifthOsc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      rootOsc.start(now);
      fifthOsc.start(now);
      rootOsc.stop(now + duration);
      fifthOsc.stop(now + duration);
    } catch {
      // Graceful fallback
    }
  }

  /**
   * spirit (Wands / Fire): Bandpass-filtered crackle with exponential noise burst
   */
  private playSpiritFlameCrackle(ctx: AudioContext, now: number): void {
    try {
      const duration = 0.35;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.08));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2400, now);
      filter.Q.setValueAtTime(3.2, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
    } catch {
      // Graceful fallback if Web Audio is restricted
    }
  }

  /**
   * essence (Cups / Water): Resonant harmonic wave with dual sine/triangle sweep
   */
  private playEssenceHarmonicWave(ctx: AudioContext, now: number): void {
    try {
      const duration = 0.45;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(440, now);
      osc1.frequency.exponentialRampToValueAtTime(220, now + duration);
      osc2.frequency.setValueAtTime(880, now);
      osc2.frequency.exponentialRampToValueAtTime(440, now + duration);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.frequency.exponentialRampToValueAtTime(320, now + duration);
      filter.Q.setValueAtTime(4.5, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + duration);
      osc2.stop(now + duration);
    } catch {
      // Graceful fallback
    }
  }

  /**
   * matter (Disks / Earth): Low-frequency sub-bass thud/slam dropping from 140Hz to 42Hz
   */
  private playMatterSubBassSlam(ctx: AudioContext, now: number): void {
    try {
      const duration = 0.38;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.22);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.7, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Graceful fallback
    }
  }

  /**
   * substance (Swords / Air): Razor-sharp high-pass filtered white noise slash
   */
  private playSubstanceHighPassSlash(ctx: AudioContext, now: number): void {
    try {
      const duration = 0.12;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(3600, now);
      filter.Q.setValueAtTime(1.8, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
    } catch {
      // Graceful fallback
    }
  }

  public dispose(): void {
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        void this.ctx.close();
      } catch {
        // Ignored
      }
      this.ctx = null;
    }
  }
}
