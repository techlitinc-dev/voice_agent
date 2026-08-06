import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const OSS_TOKEN_COOKIE = 'dograh_auth_token';
const OSS_USER_COOKIE = 'dograh_auth_user';

export async function POST(request: NextRequest) {
  const { token, user } = await request.json();

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const cookieStore = await cookies();

  // Only mark the cookie Secure when the request actually arrived over HTTPS.
  // Using NODE_ENV here is wrong for OSS installs served over plain HTTP
  // (e.g. http://host:3010) — browsers silently drop Secure cookies on
  // non-HTTPS connections, which makes the token vanish and every subsequent
  // /api/auth/oss check 401.
  const isSecure = request.headers.get('x-forwarded-proto') === 'https'
    || new URL(request.url).protocol === 'https:';

  cookieStore.set(OSS_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });

  cookieStore.set(OSS_USER_COOKIE, JSON.stringify(user), {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });

  return NextResponse.json({ success: true });
}
