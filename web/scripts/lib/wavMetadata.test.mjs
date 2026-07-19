import { describe, expect, it } from "vitest";
import { findEmbeddedBpm } from "./wavMetadata.mjs";

function chunk(id, data) {
  const header = Buffer.alloc(8);
  header.write(id, 0, "ascii");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data]);
}

function wavFile(...chunks) {
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + body.length, 4);
  header.write("WAVE", 8, "ascii");
  return Buffer.concat([header, body]);
}

function fmtChunk() {
  return chunk("fmt ", Buffer.alloc(16));
}

function acidChunk(tempo) {
  const data = Buffer.alloc(24);
  data.writeUInt32LE(0x01, 0); // dwFileType
  data.writeUInt16LE(60, 4); // wRootNote
  data.writeUInt16LE(0x8000, 6); // wUnknown1
  data.writeFloatLE(0, 8); // fUnknown2
  data.writeUInt32LE(16, 12); // dwNumBeats
  data.writeUInt16LE(4, 16); // wMeterDenominator
  data.writeUInt16LE(4, 18); // wMeterNumerator
  data.writeFloatLE(tempo, 20); // fTempo
  return chunk("acid", data);
}

function id3ChunkWithTbpm(bpmText) {
  const frameData = Buffer.concat([Buffer.from([0x00]), Buffer.from(bpmText, "latin1")]);
  const frameHeader = Buffer.alloc(10);
  frameHeader.write("TBPM", 0, "ascii");
  frameHeader.writeUInt32BE(frameData.length, 4);
  const frames = Buffer.concat([frameHeader, frameData]);

  const tagHeader = Buffer.alloc(10);
  tagHeader.write("ID3", 0, "ascii");
  tagHeader.writeUInt8(3, 3); // major version
  const size = frames.length;
  tagHeader.writeUInt8((size >> 21) & 0x7f, 6);
  tagHeader.writeUInt8((size >> 14) & 0x7f, 7);
  tagHeader.writeUInt8((size >> 7) & 0x7f, 8);
  tagHeader.writeUInt8(size & 0x7f, 9);

  return chunk("id3 ", Buffer.concat([tagHeader, frames]));
}

describe("findEmbeddedBpm", () => {
  it("reads fTempo from an ACID chunk", () => {
    const wav = wavFile(fmtChunk(), acidChunk(128));
    expect(findEmbeddedBpm(wav)).toBeCloseTo(128, 5);
  });

  it("reads BPM from an ID3v2 TBPM frame", () => {
    const wav = wavFile(id3ChunkWithTbpm("140"));
    expect(findEmbeddedBpm(wav)).toBe(140);
  });

  it("returns null when no acid/id3 chunk is present", () => {
    const wav = wavFile(fmtChunk());
    expect(findEmbeddedBpm(wav)).toBeNull();
  });

  it("prefers whichever chunk (acid or id3) is found first", () => {
    const wav = wavFile(acidChunk(100), id3ChunkWithTbpm("200"));
    expect(findEmbeddedBpm(wav)).toBeCloseTo(100, 5);
  });

  it("throws on a buffer that isn't a RIFF/WAVE file", () => {
    expect(() => findEmbeddedBpm(Buffer.from("definitely not a wav file"))).toThrow();
  });

  it("throws on a buffer too short to contain a RIFF header", () => {
    expect(() => findEmbeddedBpm(Buffer.from("hi"))).toThrow();
  });
});
