import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@voice-agent/contracts", "@voice-agent/voice-openai"],
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return webpackConfig;
  },
};

export default config;
