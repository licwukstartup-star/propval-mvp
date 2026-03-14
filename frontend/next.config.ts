import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// unsafe-eval only in dev (Turbopack HMR requires it)
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline'";

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

const csp = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https: blob:",
  `connect-src 'self' ${backendUrl} https://*.supabase.co https://nominatim.openstreetmap.org https://api.postcodes.io https://epc.opendatacommunities.org https://*.arcgis.com https://services-eu1.arcgis.com https://environment.data.gov.uk https://historicengland.org.uk https://www.planning.data.gov.uk https://find-energy-certificate.service.gov.uk https://landregistry.data.gov.uk https://overpass-api.de https://data.police.uk`,
  "frame-src 'self' https://www.google.com",
  "frame-ancestors 'none'",
].join("; ") + ";";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
