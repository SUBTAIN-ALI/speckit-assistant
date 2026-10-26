/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // node-pty is a native addon and must not be bundled by webpack; load it from
  // node_modules at runtime on the server instead.
  serverExternalPackages: ['node-pty'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // The middleware (Host/Origin checks) runs on every route, and Next.js
    // truncates request bodies above this size when it does — meeting
    // recordings uploaded for transcription are often larger than the 10 MB default.
    middlewareClientMaxBodySize: '500mb',
  },
};

export default nextConfig;
