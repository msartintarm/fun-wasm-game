// Server-only reads (no NEXT_PUBLIC_ prefix — never bundled to the client;
// consumers that need this client-side get it via a prop, not by reading
// process.env themselves, since only NEXT_PUBLIC_* vars are visible there).
//
// Gated on NODE_ENV as well as the explicit flag, on purpose: a production
// deploy can never expose test hooks regardless of which env vars happen to
// be set in that environment's config — the flag alone isn't sufficient.
export const isE2EDebug =
  process.env.NODE_ENV !== "production" && process.env.E2E_DEBUG === "1";
