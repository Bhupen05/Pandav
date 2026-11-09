import axios from 'axios';

// Shape of every rejected request from this instance. `response` mirrors
// axios's error shape for callers that read error.response.status/data.
export interface ApiError {
  message: string;
  status?: number;
  // The server's machine-readable reason, for example EMAIL_NOT_VERIFIED
  code?: string;
  // Seconds to wait before trying again (429)
  retryAfter?: number;
  data?: unknown;
  response?: {
    status: number;
    statusText?: string;
    data?: unknown;
  };
}

// Message to show the user for any error thrown by an API call
export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return fallback;
};

// The server's machine-readable reason for a failed request, if it gave one
export const getErrorCode = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

// The API is always called on this site's own /api path: Vercel forwards it
// to the backend (vercel.json), and so does Vite in development
// (vite.config.ts). That keeps the HttpOnly session cookie first-party.
export const apiBaseUrl = '/api/v2';

// Sockets can't go through that proxy, so they connect to the backend itself
export const socketBaseUrl = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000').replace(/\/+$/, '');

// Remembered across the reload to /login, which then says why the visitor is
// there. Written when a request is refused because the session ended.
export const SESSION_ENDED_KEY = 'pandav:session-ended';

const rememberSessionEnded = () => {
  try {
    sessionStorage.setItem(SESSION_ENDED_KEY, '1');
  } catch {
    // Storage can be blocked; the login page just won't explain
  }
};

// The auth context listens, so a refusal anywhere in the app can send the
// user to the change-password screen
const passwordChangeListeners = new Set<() => void>();
export const onPasswordChangeRequired = (listener: () => void) => {
  passwordChangeListeners.add(listener);
  return () => {
    passwordChangeListeners.delete(listener);
  };
};

// "30 seconds", "15 minutes", "2 hours"
export const describeWait = (seconds: number) => {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round(seconds / 3600)} hours`;
};

// Retry-After is a number of seconds, or an HTTP date
const parseRetryAfter = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.round((date - Date.now()) / 1000));
};

// Create axios instance with base configuration. The browser sends the
// session cookie itself; scripts never see the token.
const api = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout for requests
});

// Response interceptor - Handle errors globally
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response) {
      const { status, statusText, data, headers } = error.response;
      const code: string | undefined = typeof data?.code === 'string' ? data.code : undefined;

      // Handle 401 Unauthorized - session expired or revoked
      // BUT skip redirect for login/register, so the error can be shown, and for
      // the session check on page load, which signs out without leaving the page
      if (status === 401) {
        const url: string = error.config?.url ?? '';
        const isAuthEndpoint = url.includes('/auth/login') ||
                               url.includes('/auth/register') ||
                               url.includes('/auth/2fa/verify') ||
                               url.includes('/auth/me');

        if (!isAuthEndpoint && window.location.pathname !== '/login') {
          // A full reload: the app starts over and finds itself signed out
          rememberSessionEnded();
          window.location.href = '/login';
        }
      }

      // An admin reset this account's password: nothing works until the owner
      // chooses their own
      if (status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') {
        passwordChangeListeners.forEach((listener) => listener());
      }

      let message: string = data?.message || data?.error || `Request failed with status ${status}`;
      const retryAfter = status === 429 ? parseRetryAfter(headers?.['retry-after']) : undefined;
      if (status === 429 && retryAfter !== undefined && !/try again/i.test(message)) {
        message = `${message} Try again in ${describeWait(retryAfter)}.`;
      }

      const apiError: ApiError = {
        message,
        status,
        code,
        retryAfter,
        data,
        response: { status, statusText, data },
      };
      return Promise.reject(apiError);
    }

    // Network error or CORS issue
    if (error.request) {
      const apiError: ApiError = {
        message: error.code === 'ECONNABORTED'
          ? 'The server took too long to answer. Please try again.'
          : 'Cannot reach the server. Check your internet connection and try again.',
      };
      return Promise.reject(apiError);
    }

    // Other errors
    return Promise.reject({ message: error.message } as ApiError);
  }
);

export default api;
