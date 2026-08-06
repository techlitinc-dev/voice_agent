import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const OSS_TOKEN_COOKIE = 'dograh_auth_token';
const OSS_USER_COOKIE = 'dograh_auth_user';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();

  // Match the Secure flag used when the cookie was set (see session/route.ts):
  // an expired Secure cookie is also rejected by browsers over plain HTTP, so
  // logout would silently fail to clear the session on such deployments.
  const isSecure = request.headers.get('x-forwarded-proto') === 'https'
    || new URL(request.url).protocol === 'https:';

  cookieStore.set(OSS_TOKEN_COOKIE, '', {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  cookieStore.set(OSS_USER_COOKIE, '', {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  return NextResponse.json({ success: true });
}
