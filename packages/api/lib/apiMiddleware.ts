/**
 * @file packages/api/lib/apiMiddleware.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Defines the API middleware for the application.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import nextConnect from 'next-connect';
import { serialize } from 'cookie';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import csurf from 'csurf';
import { checkAccess } from './authUtils';

// Parse allowed origins from environment
let allowedOrigins: string[] = [];
// console.log('API CORS_ORIGIN_LIST:', process.env.CORS_ORIGIN_LIST);
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
// console.log('API allowedOrigins:', allowedOrigins);

/**
 * @function corsOrigin
 * @description CORS origin function to check against allowed origins.
 * @param {string | undefined} origin - The origin of the request.
 * @param {(err: Error | null, allow?: boolean) => void} callback - The callback to invoke after checking the origin.
 */
const corsOrigin = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  // console.log('API CORS check:', { origin, allowedOrigins });
  if (!origin || allowedOrigins.includes(origin)) {
    // console.log('API CORS: ALLOWED');
    callback(null, true);
  } else {
    console.log('API CORS: DENIED');
    callback(new Error('Not allowed by CORS'));
  }
};

/**
 * @export
 * @const apiMiddleware
 * @description The main API middleware for the application.
 * @type {nextConnect.NextConnect<NextApiRequest, NextApiResponse>}
 */
export const apiMiddleware = nextConnect<NextApiRequest, NextApiResponse>()
  .use(cookieParser())
  .use(cors({ origin: corsOrigin, credentials: true }))
  .use(csurf({
    cookie: {
      httpOnly: true,  // Prevent XSS access to CSRF secret
      secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
      sameSite: 'strict',  // Strict since CSRF cookie only read by backend (same-site traffic)
      // Scope to API domain only (not parent domain) for least privilege
      domain: process.env.NODE_ENV === 'production' ? process.env.API_DOMAIN : undefined
    },
    ignoreMethods: [] // no methods are excluded
  }))
  .use(async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const operation = req.method + '/' + req.query.slug?.[0] + '/' + req.query.slug?.[1];
    console.log("API MIDDLEWARE: operation:", operation);
    try {
      // CORS middleware will automatically respond to OPTIONS preflight.
      if (req.method !== 'OPTIONS') {
        // Each operation is made up of an HTTP method, a susbsystem, and a resource/action
        // console.log("API MIDDLEWARE: COOKIES:", req.cookies);
        const checkResult = await checkAccess(req.headers['x-user-id'] as string, req.headers['x-verification-hash'] as string, req.headers['x-host'] as string, req.headers['x-device-fingerprint'] as string, operation, req.cookies['token']);
        console.log("checkResult:", checkResult.status);
        if ((checkResult.status === 'authenticated' || checkResult.status === 'needs-verification' || checkResult.status === 'expired-auth-flow') && checkResult.accessToken) {
          // We have a new access token to set in cookie
          // Browser cookie rules require secure if sameSite is none
          // So for local development we use strict
          // For production, because the backend is hosted on a different domain, we use none
          const cookieStr = serialize('token', checkResult.accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
            domain: process.env.NODE_ENV === 'production' ? process.env.MONOREPO_PARENT_DOMAIN : req.headers['x-host'] as string,
            path: '/',
            // Session cookie - no maxAge means it expires when browser closes
          });
          res.setHeader('Set-Cookie', cookieStr);
        }
        if (checkResult.status === 'already-authenticated') {
          res.status(204).json({});
          return;
        }
        if (checkResult.status !== 'authenticated') {
          res.status(401).json({
            error: 'Unauthorized',
            status: checkResult.status,
            accessToken: checkResult.accessToken
          });
          return;
        }
      }
    } catch (err: any) {
      console.error('Access check error:', err.message);
      res.status(500).json({ error: err.message || 'Internal Server Error' });
      return;
    }
    // console.log("API MIDDLEWARE: next():", operation);
    next();
  });