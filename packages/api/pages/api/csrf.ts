// packages/api/pages/api/csrf.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import nextConnect from 'next-connect';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import csurf from 'csurf';

// Define allowed origin for CORS
const corsOrigin = process.env.CORS_ORIGIN || process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

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