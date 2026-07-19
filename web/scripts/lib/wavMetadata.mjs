// RIFF-chunk BPM detection for WAV files — checks the same conventions
// confirmed by hand-inspecting a real source file this session: an ACID
// chunk's fTempo field (common in loop-pack WAVs and REAPER's "ACIDized
// WAV" render option) or an embedded ID3v2 tag's TBPM frame. Returns null
// when neither is present — never guesses. Throws only on a genuinely
// malformed RIFF/WAVE structure, since that's a real error, not "no BPM".

const ACID_TEMPO_OFFSET = 20; // bytes into the acid chunk's data — fTempo (float32 LE)

function readAcidTempo(view, dataStart, chunkSize) {
  if (chunkSize < ACID_TEMPO_OFFSET + 4) return null;
  const tempo = view.getFloat32(dataStart + ACID_TEMPO_OFFSET, true);
  return Number.isFinite(tempo) && tempo > 0 ? tempo : null;
}

function readId3Bpm(view, buffer, dataStart, chunkSize) {
  if (chunkSize < 10) return null;
  const magic = String.fromCharCode(view.getUint8(dataStart), view.getUint8(dataStart + 1), view.getUint8(dataStart + 2));
  if (magic !== "ID3") return null;

  // ID3v2 header size is synchsafe: 4 bytes, 7 significant bits each.
  const tagSize =
    (view.getUint8(dataStart + 6) << 21) |
    (view.getUint8(dataStart + 7) << 14) |
    (view.getUint8(dataStart + 8) << 7) |
    view.getUint8(dataStart + 9);
  const tagEnd = Math.min(dataStart + 10 + tagSize, dataStart + chunkSize);

  let pos = dataStart + 10;
  while (pos + 10 <= tagEnd) {
    const frameId = String.fromCharCode(
      view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3),
    );
    if (frameId === "\0\0\0\0") break; // padding reached

    const frameSize =
      (view.getUint8(pos + 4) << 24) | (view.getUint8(pos + 5) << 16) | (view.getUint8(pos + 6) << 8) | view.getUint8(pos + 7);
    const frameStart = pos + 10;

    if (frameId === "TBPM" && frameSize >= 2) {
      const encoding = view.getUint8(frameStart);
      const textBytes = buffer.subarray(frameStart + 1, frameStart + frameSize);
      const text =
        encoding === 1 || encoding === 2
          ? Buffer.from(textBytes).toString("utf16le")
          : Buffer.from(textBytes).toString(encoding === 3 ? "utf8" : "latin1");
      // parseFloat stops at the first non-numeric character, so trailing
      // null padding/terminators in the ID3 text field are harmless here.
      const bpm = parseFloat(text.trim());
      if (Number.isFinite(bpm) && bpm > 0) return bpm;
    }

    pos = frameStart + frameSize;
  }
  return null;
}

export function findEmbeddedBpm(buffer) {
  if (buffer.length < 12) {
    throw new Error("Buffer too short to be a valid RIFF/WAVE file");
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const riffMagic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const waveMagic = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (riffMagic !== "RIFF" || waveMagic !== "WAVE") {
    throw new Error(`Not a valid RIFF/WAVE file (got "${riffMagic}"/"${waveMagic}")`);
  }

  let pos = 12;
  while (pos + 8 <= buffer.length) {
    const chunkId = String.fromCharCode(view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3));
    const chunkSize = view.getUint32(pos + 4, true);
    const dataStart = pos + 8;
    if (dataStart + chunkSize > buffer.length) break; // truncated tail — stop, not an error

    const id = chunkId.trim().toLowerCase();
    if (id === "acid") {
      const tempo = readAcidTempo(view, dataStart, chunkSize);
      if (tempo !== null) return tempo;
    } else if (id === "id3") {
      const tempo = readId3Bpm(view, buffer, dataStart, chunkSize);
      if (tempo !== null) return tempo;
    }

    pos = dataStart + chunkSize + (chunkSize % 2); // RIFF chunks are word-aligned
  }

  return null;
}
