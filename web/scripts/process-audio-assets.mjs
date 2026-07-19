#!/usr/bin/env node
// Converts raw source audio (web/audio-src/, gitignored — see .gitignore
// and README-level context on the pending MIDI-to-audio-file migration)
// into deployable compressed files under public/audio/tracks/ (committed —
// only the processed output, never the raw multi-hundred-MB sources),
// detecting BPM from embedded metadata where possible and falling back to
// a manual override in the TRACKS manifest below when it can't be found.
// Tracks may declare additional `layers` — extra stems played in
// sample-accurate sync with the base track by audioFileEngine.ts, faded
// in/out based on game state (see data/tracks.ts's LayerCondition). Each
// layer's source must be the exact same duration as the base track's, or
// this script refuses to proceed rather than ship something that would
// audibly drift out of sync.
// Run with: node scripts/process-audio-assets.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertLayerDurationMatches } from "./lib/durationCheck.mjs";
import { findEmbeddedBpm } from "./lib/wavMetadata.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const audioSrcDir = join(__dirname, "..", "audio-src");
const outputDir = join(__dirname, "..", "public", "audio", "tracks");

// A mismatch this small couldn't happen from an honest same-session DAW
// render at a fixed sample rate — anything past this is flagging a wrong
// file being pointed at, not natural rendering variance.
const MAX_LAYER_DURATION_DRIFT_SECONDS = 0.05;

// `bpm` is a manual override, only consulted when findEmbeddedBpm() can't
// find tempo metadata in the source file itself.
const TRACKS = [
  {
    id: "sailing-to-hell",
    // No-guitar mix — the guitar is its own layer below, mixed in only
    // while the player is boosted ("speed mode").
    sourceFile: "sailing-to-hell-no-guitar.wav",
    // No ACID chunk or ID3 TBPM tag in this file (confirmed by hand
    // inspection this session) — REAPER's default WAV render doesn't
    // embed tempo. Re-export with "Add ACIDized WAV info" enabled to get
    // automatic detection working for future tracks.
    bpm: 120,
    layers: [{ id: "guitar", sourceFile: "sailing-to-hell-guitar.wav" }],
  },
];

mkdirSync(outputDir, { recursive: true });

function getDurationSeconds(filePath) {
  const output = execFileSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath]);
  return parseFloat(output.toString().trim());
}

function convertToMp3(sourcePath, outputPath) {
  execFileSync("ffmpeg", ["-y", "-i", sourcePath, "-codec:a", "libmp3lame", "-b:a", "192k", outputPath], {
    stdio: "inherit",
  });
}

function sizeMb(filePath) {
  return (statSync(filePath).size / 1024 / 1024).toFixed(1);
}

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
  convertToMp3(sourcePath, outputPath);
  const baseDurationSeconds = getDurationSeconds(sourcePath);

  const bpmNote = detectedBpm ? `detected ${detectedBpm} BPM` : `no embedded tempo found, using manifest override: ${bpm} BPM`;
  console.log(`"${track.id}": ${bpmNote} — ${sizeMb(sourcePath)}MB -> ${sizeMb(outputPath)}MB`);

  for (const layer of track.layers ?? []) {
    const layerSourcePath = join(audioSrcDir, layer.sourceFile);
    if (!existsSync(layerSourcePath)) {
      throw new Error(`"${track.id}" layer "${layer.id}": source file not found at ${layerSourcePath}`);
    }

    const layerDurationSeconds = getDurationSeconds(layerSourcePath);
    assertLayerDurationMatches(
      baseDurationSeconds,
      layerDurationSeconds,
      MAX_LAYER_DURATION_DRIFT_SECONDS,
      `"${track.id}" layer "${layer.id}"`,
    );

    const layerOutputPath = join(outputDir, `${track.id}-${layer.id}.mp3`);
    convertToMp3(layerSourcePath, layerOutputPath);
    console.log(
      `"${track.id}" layer "${layer.id}": duration matches base (${layerDurationSeconds.toFixed(3)}s) — ${sizeMb(layerSourcePath)}MB -> ${sizeMb(layerOutputPath)}MB`,
    );
  }
}
