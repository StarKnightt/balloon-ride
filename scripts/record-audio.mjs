#!/usr/bin/env node
/**
 * The cinematic's sound, rendered offline with the game's own audio graph, and muxed onto the
 * recorded video without touching the video stream:
 *
 *  1. headless Chrome loads the game (GPU flags, renderer asserted, shader errors fatal, as in
 *     record.mjs) and calls __game.cinematic.renderAudio(): FlightAudio on an OfflineAudioContext
 *     (48 kHz stereo, exactly 50.0 s), driven at 125 Hz by the cinematic's burner schedule and the
 *     balloon's path (src/flight/audioRender.ts). Fixed seeds: the render is deterministic.
 *     (The audio itself renders on the CPU; the page is parked on one seeked frame meanwhile.)
 *     A second render with only the burner muted isolates the burner by difference, and its onsets
 *     are checked against the cinematic's burst times (printed as [sync]).
 *  2. ffmpeg loudnorm, two-pass, on the WAV only: -20 LUFS integrated, true peak <= -3 dBTP
 *     -> recordings/balloon-ride-cinematic-audio.wav (24-bit).
 *  3. mux: the video stream copied as is, the WAV as AAC 192k 48 kHz
 *     -> recordings/balloon-ride-cinematic-audio.mp4. The input MP4 is only read.
 *
 *   node scripts/record-audio.mjs [--nobuild] [--nomux] [--bells=0.5] [--raw=<copy of the raw render>] [--time=golden] [--allow-software]
 *
 * Teardown on every exit path (scripts/lib/harness.mjs): browser, preview server and every ffmpeg
 * child (attached, below-normal priority); temp and partial files are deleted.
 */
import fs from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertGpu, bye, fatalShaderErrors, launchBrowser, own, serve } from "./lib/harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const TIME = arg("time", "golden");
const DIR = path.join(ROOT, "recordings");
const VIDEO = path.join(DIR, "balloon-ride-cinematic.mp4");
const RAW = path.join(DIR, "balloon-ride-cinematic-audio.raw.tmp");
const WAV = path.join(DIR, "balloon-ride-cinematic-audio.wav");
const OUT = path.join(DIR, "balloon-ride-cinematic-audio.mp4");
// LRA above the mix's own (~14 LU) so loudnorm stays linear: one gain, the game's balance untouched.
const LOUD = { I: -20, TP: -3, LRA: 18 };

/** Temp / partial files: deleted by teardown on any exit. */
const temps = new Set();
own({ close: async () => { for (const f of temps) try { if (existsSync(f)) unlinkSync(f); } catch {} } });

/** Run a child attached, below-normal priority, owned by teardown. Resolves with its stderr. */
function run(cmd, args, { shell = false, quiet = false } = {}) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", quiet ? "ignore" : "inherit", "pipe"], shell });
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
    const handle = own({ close: async () => { if (child.exitCode === null) child.kill(); } });
    let err = "";
    child.stderr.on("data", (d) => { err += d; if (!quiet) process.stderr.write(d); });
    child.on("error", rej);
    child.on("exit", (code) => {
      handle.close = async () => {};
      code === 0 ? res(err) : rej(new Error(`${cmd} exited with ${code}\n${err.slice(-2000)}`));
    });
  });
}
const ffmpeg = (args, opts) => run("ffmpeg", ["-hide_banner", "-nostdin", ...args], opts);

if (!existsSync(VIDEO)) await bye(1, `missing ${VIDEO} (run pnpm record first)`);
if (!argv.includes("--nobuild")) await run("pnpm", ["build"], { shell: process.platform === "win32" });
const URL = await serve(ROOT, "preview", 5440);
console.log(`[serve] preview ${URL}`);

// ---- 1. offline render in the game page
const browser = await launchBrowser(["--hide-scrollbars", "--mute-audio"]);
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
fatalShaderErrors(page, "record-audio");
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console error: ${m.text().slice(0, 400)}`);
});
await page.goto(`${URL}?cinematic=1&time=${TIME}&seed=1&t=12&capture=1&res=1`, { waitUntil: "load" });
await assertGpu(page);
await page.waitForFunction(() => !!window.__game, null, { timeout: 300_000, polling: 100 });
await page.evaluate(() => window.__game.ready);
console.log(`[record-audio] in-page renderer: ${await page.evaluate(() => window.__game.renderer())}`);
// Park the page on one frame (seek switches to on-demand drawing), so the GPU idles while the audio renders.
await page.evaluate(() => window.__game.cinematic.seek(0));
// The bells are trimmed 6 dB for the recording (the game plays them at 1): heard faint under the burner.
const BELLS = Number(arg("bells", "0.5"));
const render = (o) => page.evaluate((o) => window.__game.cinematic.renderAudio(o), o);
const r = await render({ bellTrim: BELLS });
if (errors.length) await bye(1, `page errors:\n  ${errors.join("\n  ")}`);
console.log(`[record-audio] rendered ${r.frames} frames (${(r.frames / r.sampleRate).toFixed(3)} s) at ${r.sampleRate} Hz in ${(r.ms / 1000).toFixed(1)} s, ${r.ticks} control ticks, peak ${(20 * Math.log10(r.peak)).toFixed(1)} dBFS`);
console.log(`[record-audio] burner schedule (s): ${r.bursts.map(([a, b]) => `${a}-${b}`).join(", ")}; seen by the control ticks: ${r.edges.map(([a, b]) => `${a.toFixed(4)}-${b.toFixed(4)}`).join(", ")}`);
if (r.frames !== 2_400_000) await bye(1, `expected 2,400,000 frames, got ${r.frames}`);
temps.add(RAW);
const raw = Buffer.from(r.wav, "base64");
console.log(`[record-audio] raw render md5 ${createHash("md5").update(raw).digest("hex")} (events are deterministic; runs differ only by float rounding, < -140 dB)`);
await fs.writeFile(RAW, raw);
if (arg("raw")) await fs.writeFile(arg("raw"), raw); // debug: keep a copy of the unnormalised render

// ---- sync check: the same render with only the burner muted (a gain trim: identical events), so
// the difference is the burner alone; its onsets and releases against the cinematic's schedule.
{
  const q = await render({ bellTrim: BELLS, burnerTrim: 0 });
  const a = new Float32Array(new Uint8Array(raw).buffer, 44), b = new Float32Array(new Uint8Array(Buffer.from(q.wav, "base64")).buffer, 44);
  const sr = r.sampleRate, n = r.frames, W = Math.round(sr / 1000);
  const burn = new Float64Array(n);
  for (let i = 0; i < n; i++) burn[i] = (a[2 * i] + a[2 * i + 1] - b[2 * i] - b[2 * i + 1]) / 2;
  const db = (i0, i1) => {
    let e = 0;
    for (let i = Math.max(0, i0); i < Math.min(n, i1); i++) e += burn[i] * burn[i];
    return 10 * Math.log10(e / Math.max(1, i1 - i0) + 1e-30);
  };
  const FRAME = 1000 / 60;
  for (const [on, off] of r.bursts) {
    const hold = db(Math.round((on + 1) * sr), Math.round((off - 0.2) * sr));
    // 1 ms windows for the onset (silence before it), 20 ms for the release (the roar's noise needs averaging).
    const find = (from, test, w = W) => { for (let i = Math.round(from * sr); i < n - w; i += W / 4) if (test(db(i, i + w))) return i / sr; return NaN; };
    const t40 = find(Math.max(0, on - 0.1), (v) => v > hold - 40);
    const t6 = find(Math.max(0, on - 0.1), (v) => v > hold - 6);
    const rel = find(off, (v) => v < hold - 10, 20 * W);
    const ms = (t, ref) => `${((t - ref) * 1000).toFixed(1)} ms`;
    console.log(`[sync] burst ${on}-${off} s: burner audible (-40 dB) at +${ms(t40, on)}, within 6 dB of full roar at +${ms(t6, on)}, down 10 dB (20 ms RMS) at off +${ms(rel, off)}; ${Math.abs(t40 - on) * 1000 <= FRAME ? "within" : "NOT within"} one video frame (${FRAME.toFixed(1)} ms)`);
  }
}
await browser.close();

// ---- 2. two-pass loudnorm (the WAV only)
const ln = `loudnorm=I=${LOUD.I}:TP=${LOUD.TP}:LRA=${LOUD.LRA}`;
const p1 = await ffmpeg(["-f", "wav", "-i", RAW, "-af", `${ln}:print_format=json`, "-f", "null", "-"], { quiet: true });
const m = JSON.parse(p1.slice(p1.lastIndexOf("{"), p1.lastIndexOf("}") + 1));
console.log(`[loudnorm] measured: I ${m.input_i} LUFS, TP ${m.input_tp} dBTP, LRA ${m.input_lra} LU, thresh ${m.input_thresh}`);
const PART = WAV + ".part.wav";
temps.add(PART);
const p2 = await ffmpeg([
  "-y", "-f", "wav", "-i", RAW, "-af",
  `${ln}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`,
  "-ar", "48000", "-c:a", "pcm_s24le", PART,
], { quiet: true });
const m2 = JSON.parse(p2.slice(p2.lastIndexOf("{"), p2.lastIndexOf("}") + 1));
console.log(`[loudnorm] output: I ${m2.output_i} LUFS, TP ${m2.output_tp} dBTP, LRA ${m2.output_lra} LU, type ${m2.normalization_type}`);
await fs.rename(PART, WAV);
temps.delete(PART);
console.log(`[record-audio] wrote ${path.relative(ROOT, WAV)}`);

// ---- 3. mux: video copied, audio AAC
if (!argv.includes("--nomux")) {
  const MP4 = OUT + ".part.mp4";
  temps.add(MP4);
  await ffmpeg([
    "-y", "-loglevel", "warning", "-i", VIDEO, "-i", WAV, "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", MP4,
  ]);
  await fs.rename(MP4, OUT);
  temps.delete(MP4);
  console.log(`[record-audio] wrote ${path.relative(ROOT, OUT)}`);
}
await bye(0);
