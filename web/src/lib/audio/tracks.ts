import { audioAssetUrl } from "./assetUrl";
import { PRESET_TRACKS, TRACKS, type MusicTrack, type MusicTrackId } from "./data/tracks";

export { PRESET_TRACKS, TRACKS };
export type { MusicTrack, MusicTrackId };

// pickTrackForPreset() lives in audioEngine.ts now — it's generic (takes
// the registry as a parameter) so both midiEngine.ts and
// audioFileEngine.ts share the exact same function instead of each having
// their own copy.

export function trackAssetUrl(track: MusicTrack): string {
  return audioAssetUrl(track.assetPath);
}
