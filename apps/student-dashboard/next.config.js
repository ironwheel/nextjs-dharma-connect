/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true, // Or your existing value
  // Add the webpack configuration here:
  webpack: (config, { isServer, webpack }) => {
    // Fixes npm packages that depend on Node.js core modules
    // by telling webpack to use an empty module for these on the client side.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback, // Spread existing fallbacks if any
        fs: false, // Tells webpack to provide an empty module for 'fs'
        path: false, // Same for 'path'
        crypto: false, // Same for 'crypto'
        stream: false, // nodemailer might also use stream
        net: false, // Fallback for 'net'
        tls: false, // Often related to 'net' and 'crypto' in mailers
        dns: false, // Fallback for 'dns'
        child_process: false, // Added fallback for 'child_process'
      };
    }

    // Important: return the modified config
    return config;
  },
  // Add other Next.js configurations if you have them
  // For example:
  // images: {
  //   domains: ['example.com'],
  // },
};

module.exports = nextConfig;
