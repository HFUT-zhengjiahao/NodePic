import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stop `next dev` from writing AGENTS.md / CLAUDE.md into the repo root.
  agentRules: false,
  // Hide the built-in Next.js dev tools badge (bottom-left "N" button). Its menu (Route / Bundler /
  // Route Info / Preferences) is framework UI that is English-only and cannot be translated through
  // this app's i18n layer, and it overlaps the playground controls. Compile errors still surface in
  // the terminal and through the error overlay.
  devIndicators: false,
};

export default nextConfig;
