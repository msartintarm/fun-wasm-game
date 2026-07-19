#!/usr/bin/env node
// Rasterizes src/assets/icon-source.svg (the one hand-authored master icon)
// into the PNG sizes the web manifest and iOS both need, into
// public/icons/ (committed — same generated-output-is-checked-in pattern as
// scripts/process-audio-assets.mjs). Re-run this after editing the source
// SVG; nothing else regenerates these automatically.
// Run with: node scripts/generate-icons.mjs
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceSvg = join(__dirname, "..", "src", "assets", "icon-source.svg");
const outputDir = join(__dirname, "..", "public", "icons");

// [output filename, pixel size]. 192/512 are the manifest.ts icon sizes;
// 180 is the fixed size iOS actually looks for on an apple-touch-icon link
// regardless of what's declared, per Apple's HIG.
const TARGETS = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
];

mkdirSync(outputDir, { recursive: true });

for (const [filename, size] of TARGETS) {
  const outputPath = join(outputDir, filename);
  await sharp(sourceSvg).resize(size, size).png().toFile(outputPath);
  console.log(`${filename}: ${size}x${size}`);
}
