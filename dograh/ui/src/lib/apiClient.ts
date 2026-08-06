import type { Client } from '@/client/client';
import type { CreateClientConfig } from '@/client/client.gen';

export function getServerBackendUrl() {
    return process.env.BACKEND_URL || 'http://api:8000';
}

/**
 * Resolve the base URL the browser should use to reach the backend API.
 *
 * Precedence:
 *   1. NEXT_PUBLIC_BACKEND_URL — explicit build-time operator config, always wins
 *      (e.g. a split deployment where the browser reaches the API at a public
 *      host:port rather than through the UI's same-origin proxy).
 *   2. window.location.origin — the origin the page was loaded from. The browser
 *      is guaranteed to reach it, and the UI serves a same-origin /api/v1/*
 *      proxy route (app/api/v1/[...path]) that forwards to the backend.
 *
 * The /health backend_api_endpoint is intentionally NOT used for the browser's
 * API client: the backend may report a localhost/private address (e.g.
 * http://localhost:8000) that is unreachable from a browser which loaded the UI
 * from a different host/port. That endpoint is for external consumers
 * (webhooks, telephony) — see resolveWebhookBaseUrl.
 */
export function resolveBrowserBackendUrl(_backendApiEndpoint?: string | null): string {
    return (
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        (typeof window !== 'undefined' ? window.location.origin : '')
    );
}

export const createClientConfig: CreateClientConfig = (config) => {
    // Use different URLs for server-side vs client-side
    const isServer = typeof window === 'undefined';
    let baseUrl: string;

    if (isServer) {
        baseUrl = getServerBackendUrl();
    } else {
        // The backend-reported endpoint is not known yet at module init;
        // AppConfigProvider upgrades the client base URL once /health reports it
        // (when no explicit NEXT_PUBLIC_BACKEND_URL is configured).
        baseUrl = resolveBrowserBackendUrl();
    }

    return {
        ...config,
        baseUrl,
    };
};

let interceptorRegistered = false;

/**
 * Register a request interceptor that attaches a fresh access token
 * to every outgoing SDK request. Idempotent — safe for React strict mode.
 */
export function setupAuthInterceptor(apiClient: Client, getAccessToken: () => Promise<string>) {
    if (interceptorRegistered) return;
    interceptorRegistered = true;

    apiClient.interceptors.request.use(async (request) => {
        if (request.headers.get('Authorization')) {
            return request;
        }
        try {
            const token = await getAccessToken();
            request.headers.set('Authorization', `Bearer ${token}`);
        } catch {
            // If token retrieval fails, let the request proceed without auth
        }
        return request;
    });
}
