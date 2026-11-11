import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // Agent rules live in the root AGENTS.md only; do not generate a second file.
  agentRules: false,
};

export default config;
