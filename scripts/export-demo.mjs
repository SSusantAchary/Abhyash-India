import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "artifacts/demo");
const recording = JSON.parse(
  readFileSync(path.join(dir, "recording.json"), "utf8"),
);
if (!recording.passed)
  throw new Error(
    "The live recording did not pass verification. Review its report before exporting.",
  );
const video = path.join(dir, "demo-screen.webm");
const audio = path.join(dir, "conversation-audio.webm");
if (!existsSync(video) || !existsSync(audio))
  throw new Error("Screen or conversation audio is missing.");
const output = path.join(dir, "Abhyash-India-Demo.mp4");
const result = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-y",
    "-i",
    video,
    "-i",
    audio,
    "-filter_complex",
    `[1:a]adelay=${Math.round(recording.audioOffset * 1000)}:all=1,apad[a]`,
    "-map",
    "0:v:0",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-shortest",
    output,
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status) process.exit(result.status);
console.log(output);
