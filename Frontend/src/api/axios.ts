import axios from 'axios';

// Shape of every rejected request from this instance. `response` mirrors
// axios's error shape for callers that read error.response.status/data.
export interface ApiError {
  message: string;
  status?: number;
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

// The API is always called on this site's own /api path: Vercel forwards it
// to the backend (vercel.json), and so does Vite in development
// (vite.config.ts). That keeps the HttpOnly session cookie first-party.
export const apiBaseUrl = '/api/v2';

// Sockets can't go through that proxy, so they connect to the backend itself
export const socketBaseUrl = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000').replace(/\/+$/, '');

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
      const { status, statusText, data } = error.response;

      // Handle 401 Unauthorized - session expired or revoked
      // BUT skip redirect for login/register, so the error can be shown, and for
      // the session check on page load, which signs out without leaving the page
      if (status === 401) {
        const isAuthEndpoint = error.config?.url?.includes('/auth/login') ||
                               error.config?.url?.includes('/auth/register') ||
                               error.config?.url?.includes('/auth/me');

        if (!isAuthEndpoint) {
          // A full reload: the app starts over and finds itself signed out
          window.location.href = '/login';
        }
      }

      const apiError: ApiError = {
        message: data?.message || data?.error || `Request failed with status ${status}`,
        status,
        data,
        response: { status, statusText, data },
      };
      return Promise.reject(apiError);
    }

    // Network error or CORS issue
    if (error.request) {
      const apiError: ApiError = {
        message: 'Cannot connect to server. Please check your internet connection or if the backend is running.',
      };
      return Promise.reject(apiError);
    }

    // Other errors
    return Promise.reject({ message: error.message } as ApiError);
  }
);

export default api;
