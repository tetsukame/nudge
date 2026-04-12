/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg must not be bundled for server components (native binding)
  // In Next.js 15 this was moved out of `experimental`
  serverExternalPackages: ['pg'],
};

export default nextConfig;
