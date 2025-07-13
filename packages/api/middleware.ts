// packages/api/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  // example: health check
  if (req.nextUrl.pathname === '/health') {
    return NextResponse.json({ status: 'ok' });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/health']
};