/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @frigat/shared ships TypeScript-adjacent ESM from a workspace package.
  transpilePackages: ['@frigat/shared'],
  // `next dev` and `next build` share .next by default, and a build replaces
  // the chunks a running dev server is serving — every route then 500s with
  // "Cannot find module './<n>.js'". Setting NEXT_DIST_DIR lets a production
  // build run alongside dev without touching it.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
