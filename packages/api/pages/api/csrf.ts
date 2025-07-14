// packages/api/pages/api/csrf.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import nextConnect from 'next-connect';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import csurf from 'csurf';

// Parse allowed origins from environment
let allowedOrigins: string[] = [];
// console.log('CSRF CORS_ORIGIN_LIST:', process.env.CORS_ORIGIN_LIST);
try {
    if (process.env.CORS_ORIGIN_LIST) {
        allowedOrigins = JSON.parse(process.env.CORS_ORIGIN_LIST);
    } else {
        allowedOrigins = ['http://localhost:3000'];
    }
} catch (e) {
    console.warn('Failed to parse CORS_ORIGIN_LIST, falling back to localhost');
    allowedOrigins = ['http://localhost:3000'];
}
// console.log('CSRF allowedOrigins:', allowedOrigins);

// CORS origin function to check against allowed origins
const corsOrigin = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // console.log('CSRF CORS check:', { origin, allowedOrigins });
    if (!origin || allowedOrigins.includes(origin)) {
        // console.log('CSRF CORS: ALLOWED');
        callback(null, true);
    } else {
        console.log('CSRF CORS: DENIED');
        callback(new Error('Not allowed by CORS'));
    }
};

// TypeScript augmentation so req.csrfToken() is recognized
declare module 'next' {
    interface NextApiRequest {
        csrfToken(): string;
    }
}

// Build the handler: CORS → cookieParser → csurf → GET token
const handler = nextConnect<NextApiRequest, NextApiResponse>()
    .use(cors({ origin: corsOrigin, credentials: true }))
    .use(cookieParser())
    .use(csurf({ cookie: true }))
    .get((req, res) => {
        // Send back a fresh CSRF token; secret cookie is set by csurf
        console.log("CSRF: req.csrfToken()", req.csrfToken());
        res.status(200).json({ csrfToken: req.csrfToken() });
    });

export default handler;