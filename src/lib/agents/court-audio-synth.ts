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
    return this.enabled;
  }

  public triggerClash(element: EsmsAudioElement): void {
    if (!this.enabled) return;
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
