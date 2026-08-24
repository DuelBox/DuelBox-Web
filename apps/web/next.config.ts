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
/**
 * Where the site is served from, if it is not the root.
 *
 * A GitHub Pages *project* page serves at `/<repo>/`, not at `/`, so every asset URL and
 * every route needs that prefix or the page loads and none of its JavaScript does. Driven
 * by an environment variable and defaulting to empty, so `pnpm dev`, the e2e suite, and any
 * root-served host (Cloudflare Pages, Netlify, Vercel, a plain bucket) are all unchanged.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  // Next only wants this set when there is one; an empty string breaks asset resolution.
  assetPrefix: basePath === '' ? undefined : basePath,
  /**
   * `next build` and `next dev` share `.next` by default, so a build run while the dev
   * server is up deletes the manifests it is serving from and every route starts
   * answering 500. Giving dev its own directory means a build never disturbs a running
   * dev server — which matters when the two happen side by side all day.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  // A static host cannot run the image optimiser, and our art is SVG anyway.
  images: { unoptimized: true },
  // Trailing slashes keep directory-style hosts (GitHub Pages, plain S3) working.
  trailingSlash: true,
  poweredByHeader: false,
};

export default nextConfig;
