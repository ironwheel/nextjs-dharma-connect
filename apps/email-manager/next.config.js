/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    // Ensure that shared package is processed by Next.js
    transpilePackages: ['sharedFrontend']
};

module.exports = nextConfig; 