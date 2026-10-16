import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the shared platform client ships as TypeScript source (a public git dependency); Next compiles it
  transpilePackages: ["@ntlp/geodata-web"],
  output: "standalone", // self-contained server for the production Docker image
  async redirects() {
    return [
      {
        source: "/video",
        destination: "https://youtube.com/watch?v=otbM64CJdzE&feature=youtu.be",
        permanent: false,
      },
      // The About tab became the Research hub; keep old links and bookmarks alive.
      { source: "/about", destination: "/research", permanent: true },
      // the Findings and By-region pages are gone; their old links land on the home page
      { source: "/findings", destination: "/", permanent: true },
      { source: "/regions", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
