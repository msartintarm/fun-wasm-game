// Single point of control for where audio assets are actually served from.
// Defaults to this app's own public/audio/ (same-origin, zero config).
// Pointing NEXT_PUBLIC_AUDIO_BASE_URL at a CDN later — e.g.
// "https://cdn.example.com/audio" — needs no code changes anywhere else,
// since every asset reference resolves through this one function.
const AUDIO_BASE_URL = process.env.NEXT_PUBLIC_AUDIO_BASE_URL ?? "/audio";

export function audioAssetUrl(relativePath: string): string {
  return `${AUDIO_BASE_URL.replace(/\/$/, "")}/${relativePath.replace(/^\//, "")}`;
}
