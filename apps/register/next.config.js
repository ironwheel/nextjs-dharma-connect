/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    transpilePackages: ["sharedFrontend"],
    env: {
        EMAIL_RECEIPT_DECLINED_EMAIL: process.env.EMAIL_RECEIPT_DECLINED_EMAIL,
    },
}

module.exports = nextConfig
