import type { NextConfig } from 'next';

/**
 * Static export, deliberately.
 *
 * The whole product runs on the player's device: simulation, bots and physics are all
 * local, so the origin's only job is to hand over files once. `output: 'export'` makes
 * that structural — there is no server runtime to deploy, the build is a directory of
 * files any static host will serve, and a route that needs request-time rendering fails
 * the build rather than quietly adding a per-request cost.
 */
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  // A static host cannot run the image optimiser, and our art is SVG anyway.
  images: { unoptimized: true },
  // Trailing slashes keep directory-style hosts (GitHub Pages, plain S3) working.
  trailingSlash: true,
  poweredByHeader: false,
};

export default nextConfig;
