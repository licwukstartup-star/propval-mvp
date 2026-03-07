import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const MAINTENANCE_MODE = true; // ← set to false to re-open the site

export async function middleware(request: NextRequest) {
  if (MAINTENANCE_MODE) {
    return new NextResponse(
      `<!DOCTYPE html>
<html><head><title>PropVal — Maintenance</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0A0E1A;color:#E2E8F0;font-family:system-ui,sans-serif;text-align:center}
h1{color:#00F0FF;font-size:2rem;margin-bottom:.5rem}p{color:#94A3B8;font-size:1rem}</style></head>
<body><div><h1>PropVal</h1><p>We're currently down for maintenance.<br/>We'll be back shortly.</p></div></body></html>`,
      { status: 503, headers: { 'Content-Type': 'text/html', 'Retry-After': '3600' } }
    );
  }
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
