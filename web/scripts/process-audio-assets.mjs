#!/usr/bin/env node
// Converts raw source audio (web/audio-src/, gitignored — see .gitignore
// and README-level context on the pending MIDI-to-audio-file migration)
// into deployable compressed files under public/audio/tracks/, detecting
// BPM from embedded metadata where possible and falling back to a manual
// override in the TRACKS manifest below when it can't be found.
// Run with: node scripts/process-audio-assets.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findEmbeddedBpm } from "./lib/wavMetadata.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const audioSrcDir = join(__dirname, "..", "audio-src");
const outputDir = join(__dirname, "..", "public", "audio", "tracks");

// `bpm` is a manual override, only consulted when findEmbeddedBpm() can't
// find tempo metadata in the source file itself.
const TRACKS = [
  {
    id: "sailing-to-hell",
    // Instrumental mix (no vocals) — same duration (347.796625s) and
    // tempo as the original vocal render, just a different mixdown.
    sourceFile: "sailing-to-hell-instr.wav",
    // No ACID chunk or ID3 TBPM tag in this file (confirmed by hand
    // inspection this session) — REAPER's default WAV render doesn't
    // embed tempo. Re-export with "Add ACIDized WAV info" enabled to get
    // automatic detection working for future tracks.
    bpm: 120,
  },
];

mkdirSync(outputDir, { recursive: true });

for (const track of TRACKS) {
  const sourcePath = join(audioSrcDir, track.sourceFile);
  if (!existsSync(sourcePath)) {
    console.warn(`Skipping "${track.id}": source file not found at ${sourcePath}`);
    continue;
  }

  const buffer = readFileSync(sourcePath);
  const detectedBpm = findEmbeddedBpm(buffer);
  const bpm = detectedBpm ?? track.bpm;
  if (bpm === undefined) {
    throw new Error(
      `"${track.id}": no embedded tempo found in ${track.sourceFile}, and no manual "bpm" override is set in this script's TRACKS manifest. Add one before running again.`,
    );
  }

  const outputPath = join(outputDir, `${track.id}.mp3`);
  execFileSync("ffmpeg", ["-y", "-i", sourcePath, "-codec:a", "libmp3lame", "-b:a", "192k", outputPath], {
    stdio: "inherit",
  });

  const sourceSizeMb = (statSync(sourcePath).size / 1024 / 1024).toFixed(1);
  const outputSizeMb = (statSync(outputPath).size / 1024 / 1024).toFixed(1);
  const bpmNote = detectedBpm ? `detected ${detectedBpm} BPM` : `no embedded tempo found, using manifest override: ${bpm} BPM`;
  console.log(`"${track.id}": ${bpmNote} — ${sourceSizeMb}MB -> ${outputSizeMb}MB`);
}
