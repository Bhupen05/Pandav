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

// Backend API URL including the version prefix (VITE_API_URL), e.g.
// http://localhost:5000/api/v2. Defaults to /api/v2 on the same origin.
export const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api/v2').replace(/\/+$/, '');

// Socket.io lives at the server root, without the /api or /api/vN prefix
export const socketBaseUrl = /^https?:\/\//.test(apiBaseUrl)
  ? apiBaseUrl.replace(/\/api(?:\/v\d+)?$/, '')
  : window.location.origin;

// Create axios instance with base configuration
const api = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout for requests
});

// Request interceptor - Add token to requests
api.interceptors.request.use(
  (config) => {
    // Check sessionStorage first (session-based), then localStorage (remember me)
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - Handle errors globally
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response) {
      const { status, statusText, data } = error.response;

      // Handle 401 Unauthorized - token expired or invalid
      // BUT skip redirect for login/register, so the error can be shown, and for
      // the session check on page load, which signs out without leaving the page
      if (status === 401) {
        const isAuthEndpoint = error.config?.url?.includes('/auth/login') ||
                               error.config?.url?.includes('/auth/register') ||
                               error.config?.url?.includes('/auth/me');

        if (!isAuthEndpoint) {
          // Clear both storage types
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          sessionStorage.removeItem('token');
          sessionStorage.removeItem('user');
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
