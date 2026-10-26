import type { NextConfig } from "next";

// The site's old address. The same container still answers it (the tunnel routes both hosts here), so every
// request on it is sent to the same path and query on coreflagging.nlp-tlp.org, the one address search engines
// should know. Matched on Host and, behind a proxy that rewrites Host, on X-Forwarded-Host.
const OLD_HOST = "coretrace.nlp-tlp.org";
const CANONICAL = "https://coreflagging.nlp-tlp.org";

const nextConfig: NextConfig = {
  // the shared platform client ships as TypeScript source (a public git dependency); Next compiles it
  transpilePackages: ["@ntlp/geodata-web"],
  output: "standalone", // self-contained server for the production Docker image
  async redirects() {
    return [
      ...(["host", "x-forwarded-host"] as const).map((type) => ({
        source: "/:path*",
        has: [type === "host" ? { type, value: OLD_HOST } : { type: "header" as const, key: type, value: OLD_HOST }],
        destination: `${CANONICAL}/:path*`,
        statusCode: 301 as const,
      })),
      {
        source: "/video",
        destination: "https://youtube.com/watch?v=otbM64CJdzE&feature=youtu.be",
        permanent: false,
      },
      // /about was carried over from the platform's frontend, where it went to a Research hub this site never had;
      // here the landing page's "What it does" section is the about page.
      { source: "/about", destination: "/#what", permanent: true },
      // the Findings and By-region pages are gone; their old links land on the home page
      { source: "/findings", destination: "/", permanent: true },
      { source: "/regions", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
