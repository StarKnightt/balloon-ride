/**
 * Offline render of the cinematic's sound (scripts/record-audio.mjs), with the game's own graph:
 * FlightAudio built on an OfflineAudioContext and driven, at a fixed control rate, by exactly the
 * inputs ride.ts / main.ts feed it during the live cinematic, each a pure function of the cinematic
 * time s: the burner (Cinematic.burning), the balloon's place (Cinematic.balloonAt), its velocity
 * (the same 0.1 s difference ride.ts uses), height above ground, distance to the village centre, and
 * the time of day. Seeds are fixed and every voice bank is baked up front, so the render is
 * deterministic. Loaded on demand only (dynamic import from main.ts); the live game never runs it.
 */
import * as THREE from "three";
import { FlightAudio } from "./audio";
import { Cinematic, CINE_BURNS, CINE_DURATION } from "./cinematic";

export const AUDIO_SR = 48000;
/** Control period: 3 render quanta (384 frames = 8 ms, 125 Hz), so every tick lands on a quantum edge. */
const TICK = 384;

export interface AudioRenderResult {
  /** 32-bit float stereo WAV, base64. */
  wav: string;
  sampleRate: number;
  frames: number;
  ticks: number;
  ms: number;
  /** The cinematic's burner schedule [on, off] (s), clipped to the render. */
  bursts: [number, number][];
  /** Burner [on, off] edges as the control ticks saw them (s). */
  edges: [number, number][];
  peak: number;
}

export interface AudioRenderOpts {
  seconds?: number;
  seed?: number;
  /** Level trims (FlightAudio.bellTrim / burnerTrim); gains only, so the events stay identical. */
  bellTrim?: number;
  burnerTrim?: number;
}

export async function renderCinematicAudio(
  ground: (x: number, z: number) => number,
  tod: { night: number; evening: number },
  { seconds = CINE_DURATION, seed = 4242, bellTrim = 1, burnerTrim = 1 }: AudioRenderOpts = {},
): Promise<AudioRenderResult> {
  const t0 = performance.now();
  const frames = Math.round(seconds * AUDIO_SR);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: AUDIO_SR });
  const cine = new Cinematic(ground);
  const audio = new FlightAudio();
  audio.build(ctx, seed, true);
  audio.bellTrim = bellTrim;
  audio.burnerTrim = burnerTrim;
  const pos = new THREE.Vector3(), ahead = new THREE.Vector3();
  const edges: [number, number][] = [];
  let was = false;
  // One control tick: the same AudioIn main.ts builds from ride.flight while the cinematic runs.
  const tick = (s: number) => {
    const burner = cine.burning(s);
    if (burner && !was) edges.push([s, NaN]);
    else if (!burner && was) edges[edges.length - 1][1] = s;
    was = burner;
    cine.balloonAt(s, pos);
    cine.balloonAt(s + 0.1, ahead);
    const vel = ahead.sub(pos).multiplyScalar(10);
    audio.update({
      burner,
      vent: false,
      agl: pos.y - Math.max(ground(pos.x, pos.z), 0),
      speed: Math.hypot(vel.x, vel.z),
      climb: vel.y,
      village: Math.hypot(pos.x, pos.z),
      night: tod.night,
      evening: tod.evening,
    });
  };
  tick(0);
  let ticks = 1;
  const next = (n: number) => {
    if (n * TICK >= frames) return;
    void ctx.suspend((n * TICK) / AUDIO_SR).then(() => {
      tick(ctx.currentTime);
      ticks++;
      next(n + 1);
      void ctx.resume();
    });
  };
  next(1);
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  return { wav: wavBase64(L, R, AUDIO_SR), sampleRate: AUDIO_SR, frames: buf.length, ticks, ms: performance.now() - t0, bursts: CINE_BURNS.filter(([a]) => a < seconds).map(([a, b]) => [Math.max(0, a), Math.min(b, seconds)]), edges, peak };
}

/** 32-bit float stereo WAV, base64 (no quantisation before the loudness pass). */
function wavBase64(L: Float32Array, R: Float32Array, sr: number): string {
  const n = L.length, bytes = 44 + n * 8;
  const v = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, bytes - 8, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); // IEEE float
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 8, true);
  v.setUint16(32, 8, true);
  v.setUint16(34, 32, true);
  str(36, "data");
  v.setUint32(40, n * 8, true);
  for (let i = 0, o = 44; i < n; i++, o += 8) {
    v.setFloat32(o, L[i], true);
    v.setFloat32(o + 4, R[i], true);
  }
  const u8 = new Uint8Array(v.buffer);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
