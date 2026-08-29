/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg must not be bundled for server components (native binding)
  // In Next.js 15 this was moved out of `experimental`
  // NDG-100: OpenTelemetry SDK も同様に bundle 除外 (require フック方式)
  serverExternalPackages: [
    'pg',
    '@opentelemetry/sdk-node',
    '@opentelemetry/auto-instrumentations-node',
  ],
};

export default nextConfig;
