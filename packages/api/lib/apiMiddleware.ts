// packages/api/lib/apiMiddleware.ts
import { NextApiRequest, NextApiResponse } from 'next';
import nextConnect from 'next-connect';
import { serialize } from 'cookie';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import csurf from 'csurf';
import { checkAccess } from './authUtils';

// Configure CORS origin based on environment
const corsOrigin = process.env.CORS_ORIGIN ||
  process.env.NEXT_PUBLIC_FRONTEND_URL ||
  'http://localhost:3000';

export const apiMiddleware = nextConnect<NextApiRequest, NextApiResponse>()
  .use(cookieParser())
  .use(cors({ origin: corsOrigin, credentials: true }))
  .use(csurf({
    cookie: true,
    ignoreMethods: [] // no methods are excluded
  }))
  .use(async (req, res, next) => {
    const operation = req.method + '/' + req.query.slug?.[0] + '/' + req.query.slug?.[1];
    console.log("API MIDDLEWARE: operation:", operation);
    try {
      // CORS middleware will automatically respond to OPTIONS preflight.
      if (req.method !== 'OPTIONS') {
        // Each operation is made up of an HTTP method, a susbsystem, and a resource/action
        // console.log("API MIDDLEWARE: COOKIES:", req.cookies);
        const checkResult = await checkAccess(req.headers['x-user-id'] as string, req.headers['x-verification-hash'] as string, req.headers['x-host'] as string, req.headers['x-device-fingerprint'] as string, operation, req.cookies['token']);
        console.log("checkResult:", checkResult.status);
        if ((checkResult.status === 'authenticated' || checkResult.status === 'needs-verification') && checkResult.accessToken) {
          // We have a new access token to set in cookie
          const cookieStr = serialize('token', checkResult.accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            domain: req.headers['x-host'] as string,
            path: '/',
            maxAge: 15 * 60, // 15 minutes
          });
          // console.log("SETTING COOKIE:", cookieStr);
          res.setHeader('Set-Cookie', cookieStr);
        }
        if (checkResult.status !== 'authenticated') {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      }
    } catch (err: any) {
      console.error('Access check error:', err.message);
      res.status(500).json({ error: err.message || 'Internal Server Error' });
      return;
    }
    console.log("API MIDDLEWARE: next():", operation);
    next();
  });