import axios from 'axios';

// Create axios instance with base configuration
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://pandav.onrender.com/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
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
      // Handle 401 Unauthorized - token expired or invalid
      if (error.response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
      
      // Log detailed error information for debugging
      console.error('API Error:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        url: error.config?.url
      });
      
      // Return error message from backend
      return Promise.reject(error.response.data);
    }
    
    // Network error or CORS issue
    if (error.request) {
      console.error('Network Error:', {
        message: 'No response received from server',
        url: error.config?.url,
        method: error.config?.method
      });
      return Promise.reject({ 
        message: 'Cannot connect to server. Please check your internet connection or if the backend is running.' 
      });
    }
    
    // Other errors
    console.error('Request Error:', error.message);
    return Promise.reject(error);
  }
);

export default api;
