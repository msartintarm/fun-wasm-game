// Prefix for every root-relative asset path once basePath (see
// next.config.ts) is set for a subpath deployment (e.g. GitHub Pages'
// "/snake") — empty locally. Next's own file-convention links (the
// manifest route, stylesheets, fonts) get this automatically; anything
// referenced as a raw string does not and needs it applied explicitly —
// confirmed by inspecting a real `next build` output for manifest.ts's
// icons/start_url and layout.tsx's apple-touch-icon link, neither of which
// were prefixed. Same class of gap already hit for GameCanvas.tsx's WASM
// loader.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
