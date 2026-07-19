#!/usr/bin/env node
// Rerunnable generator for this repo's placeholder MIDI assets.
// Run with: node scripts/generate-midi-assets.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @tonejs/midi is CommonJS; named-export interop isn't reliable under
// native ESM, so pull Midi off the default export instead.
import pkg from "@tonejs/midi";
const { Midi } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public", "audio");

const BPM = 100;
const BEATS_PER_BAR = 4;
const SECONDS_PER_BEAT = 60 / BPM;
const BAR_SECONDS = SECONDS_PER_BEAT * BEATS_PER_BAR;

// General MIDI drum map (channel 10 / zero-indexed channel 9).
const KICK = 36;
const SNARE = 38;
const HIHAT = 42;

function buildRockDrumsAndBass() {
  const midi = new Midi();
  midi.header.setTempo(BPM);

  const drums = midi.addTrack();
  drums.channel = 9;
  const bass = midi.addTrack();
  bass.instrument.number = 33; // Electric Bass (finger)

  const bassNotes = [48, 50, 52, 53]; // C3, D3, E3, F3 — one whole note per bar

  for (let bar = 0; bar < 4; bar++) {
    const barStart = bar * BAR_SECONDS;

    // Simple rock beat: kick on 1 & 3, snare on 2 & 4, closed hi-hat on every 8th note.
    drums.addNote({ midi: KICK, time: barStart + 0 * SECONDS_PER_BEAT, duration: 0.1, velocity: 0.9 });
    drums.addNote({ midi: KICK, time: barStart + 2 * SECONDS_PER_BEAT, duration: 0.1, velocity: 0.9 });
    drums.addNote({ midi: SNARE, time: barStart + 1 * SECONDS_PER_BEAT, duration: 0.1, velocity: 0.8 });
    drums.addNote({ midi: SNARE, time: barStart + 3 * SECONDS_PER_BEAT, duration: 0.1, velocity: 0.8 });
    for (let eighth = 0; eighth < 8; eighth++) {
      drums.addNote({
        midi: HIHAT,
        time: barStart + eighth * (SECONDS_PER_BEAT / 2),
        duration: 0.08,
        velocity: 0.5,
      });
    }

    bass.addNote({ midi: bassNotes[bar], time: barStart, duration: BAR_SECONDS * 0.95, velocity: 0.85 });
  }

  return midi;
}

const MAJOR_TRIAD = [0, 4, 7];
const KEYS = [
  ["c", 60],
  ["c-sharp", 61],
  ["d", 62],
  ["d-sharp", 63],
  ["e", 64],
  ["f", 65],
  ["f-sharp", 66],
  ["g", 67],
  ["g-sharp", 68],
  ["a", 69],
  ["a-sharp", 70],
  ["b", 71],
];

function buildPianoChord(rootMidi) {
  const midi = new Midi();
  midi.header.setTempo(BPM);
  const track = midi.addTrack();
  track.instrument.number = 0; // Acoustic Grand Piano
  for (const interval of MAJOR_TRIAD) {
    track.addNote({ midi: rootMidi + interval, time: 0, duration: BAR_SECONDS, velocity: 0.85 });
  }
  return midi;
}

mkdirSync(join(publicDir, "tracks"), { recursive: true });
mkdirSync(join(publicDir, "chords"), { recursive: true });

writeFileSync(
  join(publicDir, "tracks", "rock-drums-bass.mid"),
  Buffer.from(buildRockDrumsAndBass().toArray()),
);
console.log("wrote tracks/rock-drums-bass.mid");

for (const [name, rootMidi] of KEYS) {
  writeFileSync(join(publicDir, "chords", `${name}.mid`), Buffer.from(buildPianoChord(rootMidi).toArray()));
  console.log(`wrote chords/${name}.mid`);
}
