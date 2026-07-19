import type { MetadataRoute } from "next";
import { BASE_PATH } from "@/lib/basePath";

// Required by this Next version for a manifest route under output:"export"
// — without it, the static build fails ("dynamic = force-static ... not
// configured on route /manifest.webmanifest with output: export").
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chaos Snake",
    short_name: "Chaos Snake",
    description: "A multiplayer-style snake game with chaotic AI opponents.",
    start_url: `${BASE_PATH}/`,
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    icons: [
      { src: `${BASE_PATH}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${BASE_PATH}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
  };
}
