import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/bus-stops": ["./data/bus-stops.min.json.br"],
  },
};

export default nextConfig;
