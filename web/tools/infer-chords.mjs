#!/usr/bin/env node
// Drafts a per-bar chord progression from real audio, for hand-pasting
// into data/audioTracks.ts's ChordTimeline — an analysis aid a human
// reviews and spot-checks by ear, not a guaranteed-correct oracle. Bass
// stem gives the chord root (autocorrelation pitch detection); an
// optional harmonic (keys/guitar) stem gives major/minor quality (Goertzel
// chroma energy at the third). Low-confidence bars are flagged, never
// silently folded in as if certain.
//
// Run with:
//   node tools/infer-chords.mjs --bass <path> [--harmonic <path>] --bpm <n> [--beats-per-bar 4] [--sample-rate 11025]
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

import { despikeChordSequence, detectMeasureQuality, detectMeasureRoot, formatChordSymbol } from "./lib/chordInference.mjs";

export function decodeMonoPcm(filePath, sampleRate) {
  const buffer = execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", filePath, "-f", "f32le", "-ac", "1", "-ar", String(sampleRate), "-"],
    { maxBuffer: 200 * 1024 * 1024 },
  );
  return new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 4));
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      bass: { type: "string" },
      harmonic: { type: "string" },
      bpm: { type: "string" },
      "beats-per-bar": { type: "string", default: "4" },
      "sample-rate": { type: "string", default: "11025" },
    },
  });
  if (!values.bass || !values.bpm) {
    console.error(
      "Usage: node tools/infer-chords.mjs --bass <path> [--harmonic <path>] --bpm <n> [--beats-per-bar 4] [--sample-rate 11025]",
    );
    process.exit(1);
  }
  return {
    bassPath: values.bass,
    harmonicPath: values.harmonic,
    bpm: Number(values.bpm),
    beatsPerBar: Number(values["beats-per-bar"]),
    sampleRate: Number(values["sample-rate"]),
  };
}

export function inferChords({ bassPcm, harmonicPcm, sampleRate, bpm, beatsPerBar, log = () => {} }) {
  const secondsPerMeasure = (60 / bpm) * beatsPerBar;
  const samplesPerMeasure = Math.round(secondsPerMeasure * sampleRate);
  const totalMeasures = Math.floor(bassPcm.length / samplesPerMeasure);

  const perBarChords = [];
  const chordCounts = new Map();

  for (let bar = 0; bar < totalMeasures; bar++) {
    const start = bar * samplesPerMeasure;
    const bassMeasure = bassPcm.subarray(start, start + samplesPerMeasure);
    const rootResult = detectMeasureRoot(bassMeasure, sampleRate);

    if (rootResult.pitchClass === null) {
      log(`bar ${bar}: (silence/no signal)`);
      perBarChords.push(null);
      continue;
    }

    let quality = "";
    let qualityConfidence = "low";
    let marginPercent = 0;
    if (harmonicPcm) {
      const harmonicMeasure = harmonicPcm.subarray(start, start + samplesPerMeasure);
      const qualityResult = detectMeasureQuality(harmonicMeasure, sampleRate, rootResult.pitchClass);
      quality = qualityResult.quality;
      qualityConfidence = qualityResult.confidence;
      marginPercent = qualityResult.marginPercent;
    }

    const chord = formatChordSymbol(rootResult.pitchClass, quality);
    const lowConfidenceReasons = [];
    if (rootResult.confidence === "low") lowConfidenceReasons.push("root sub-frames disagreed");
    if (harmonicPcm && qualityConfidence === "low") {
      lowConfidenceReasons.push(`quality margin only ${marginPercent.toFixed(0)}%`);
    }
    const isLowConfidence = lowConfidenceReasons.length > 0;
    const confidenceLabel = isLowConfidence
      ? `low confidence: ${lowConfidenceReasons.join(", ")}`
      : `high confidence${harmonicPcm ? ` (margin ${marginPercent.toFixed(0)}%)` : ""}`;

    log(`bar ${bar}: ${isLowConfidence ? `${chord}?` : chord}  (${confidenceLabel})`);
    perBarChords.push({ bar, chord });
    chordCounts.set(chord, (chordCounts.get(chord) ?? 0) + 1);
  }

  // Despiking only affects the collapsed output below, not the per-bar
  // log() lines above — the diagnostic printout stays an honest record of
  // exactly what was detected, spikes included.
  const despiked = despikeChordSequence(perBarChords);

  // Sparse ChordEvent[] — only entries where the chord actually changes,
  // matching activeChordAt's "last chord at or before this bar" lookup.
  const chordEvents = [];
  let lastChord;
  for (const entry of despiked) {
    if (!entry) continue;
    if (entry.chord !== lastChord) {
      chordEvents.push({ bar: entry.bar, chord: entry.chord });
      lastChord = entry.chord;
    }
  }

  let mostCommonChord = null;
  let mostCommonCount = 0;
  for (const [chord, count] of chordCounts) {
    if (count > mostCommonCount) {
      mostCommonCount = count;
      mostCommonChord = chord;
    }
  }

  return { totalMeasures, chordEvents, mostCommonChord, mostCommonCount };
}

async function main() {
  const { bassPath, harmonicPath, bpm, beatsPerBar, sampleRate } = parseCliArgs();

  console.log(`Decoding ${bassPath}...`);
  const bassPcm = decodeMonoPcm(bassPath, sampleRate);
  let harmonicPcm = null;
  if (harmonicPath) {
    console.log(`Decoding ${harmonicPath}...`);
    harmonicPcm = decodeMonoPcm(harmonicPath, sampleRate);
  }

  const secondsPerMeasure = (60 / bpm) * beatsPerBar;
  console.log(
    `\n${Math.floor(bassPcm.length / Math.round(secondsPerMeasure * sampleRate))} measures at ${bpm} BPM, ` +
      `${beatsPerBar}/4 time (${secondsPerMeasure.toFixed(3)}s/bar)\n`,
  );

  const { chordEvents, mostCommonChord, mostCommonCount, totalMeasures } = inferChords({
    bassPcm,
    harmonicPcm,
    sampleRate,
    bpm,
    beatsPerBar,
    log: console.log,
  });

  console.log(`\nInferred overall key: ${mostCommonChord} (${mostCommonCount}/${totalMeasures} bars)`);
  console.log("\nReady-to-paste chords array (review low-confidence bars above before trusting this):");
  console.log(JSON.stringify(chordEvents, null, 2));
}

// Only runs the CLI when invoked directly — importing inferChords() from a
// test doesn't shell out to ffmpeg or touch argv.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
