/** @type {import('next').NextConfig} */
const nextConfig = {
    // Vercel supplies VERCEL_GIT_COMMIT_SHA at build time, but only NEXT_PUBLIC_
    // variables reach the browser, and Vercel does not expose that alias unless the
    // project is set to. Mapping it here means no per-project setting is needed for
    // the version badge. "localhost" is what the badge shows when there is no commit
    // (a local build), and it then makes no request.
    env: {
        NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA:
            process.env.VERCEL_GIT_COMMIT_SHA ||
            process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
            "localhost",
    },
    reactStrictMode: true,
    transpilePackages: ['sharedFrontend'],
}

module.exports = nextConfig; 