/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @frigat/shared ships TypeScript-adjacent ESM from a workspace package.
  transpilePackages: ['@frigat/shared'],
};

export default nextConfig;
