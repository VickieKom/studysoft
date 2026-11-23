import type { NextConfig } from "next";

/**
 * The platform's pages may frame only themselves and the embedded YouTube
 * player (#325, youtube-nocookie.com); nothing else of the policy is set.
 * Entry points under /api/ are left out: a game's file brings its own
 * `sandbox` policy (#115).
 */
export const PAGE_CONTENT_SECURITY_POLICY = "frame-src 'self' https://www.youtube-nocookie.com";

const config: NextConfig = {
  poweredByHeader: false,
  // Agent rules live in the root AGENTS.md only; do not generate a second file.
  agentRules: false,
  async headers() {
    return [{ source: "/((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: PAGE_CONTENT_SECURITY_POLICY }] }];
  },
};

export default config;
