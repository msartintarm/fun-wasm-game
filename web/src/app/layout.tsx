import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BASE_PATH } from "@/lib/basePath";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chaos Snake",
  description: "A multiplayer-style snake game with chaotic AI opponents.",
  icons: {
    apple: `${BASE_PATH}/icons/apple-touch-icon.png`,
  },
  // Safari's own "Add to Home Screen" standalone behavior still relies on
  // these Apple-specific fields (rendered as the legacy
  // apple-mobile-web-app-* meta tags) — the Web App Manifest spec (see
  // manifest.ts) alone isn't fully honored by iOS Safari even today.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Chaos Snake",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Locked (not the ambient page-zoom default) so an accidental mid-game
  // pinch can't zoom the page and throw off the touch D-pad's on-screen
  // button positions.
  maximumScale: 1,
  userScalable: false,
  // Lets the page draw edge-to-edge under an iOS notch/home-indicator —
  // paired with GameCanvas.module.css's safe-area padding so content stays
  // clear of it.
  viewportFit: "cover",
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
