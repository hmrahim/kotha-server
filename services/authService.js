// =================== API SERVICE ===================
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_BASE_URL = 'http://192.168.1.100:5000'; // আপনার backend URL

// Create axios instance
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

// Request interceptor - attach access token
apiClient.interceptors.request.use(
  async (config) => {
    try {
      const accessToken = await SecureStore.getItemAsync('accessToken');
      if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
      }
    } catch (error) {
      console.error('Error retrieving token:', error);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If token expired and not already retried
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = await SecureStore.getItemAsync('refreshToken');
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const response = await axios.post(
          `${API_BASE_URL}/api/auth/refresh-token`,
          { refreshToken }
        );

        const { accessToken } = response.data;

        // Save new access token
        await SecureStore.setItemAsync('accessToken', accessToken);

        // Retry original request
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
        // Clear tokens and redirect to login
        await SecureStore.deleteItemAsync('accessToken');
        await SecureStore.deleteItemAsync('refreshToken');
        throw refreshError;
      }
    }

    return Promise.reject(error);
  }
);

// =================== AUTH SERVICE ===================
export const authService = {
  // Sign Up
  async signup(email, password, name, phone = '') {
    try {
      const response = await apiClient.post('/api/auth/signup', {
        email,
        password,
        name,
        phone,
      });

      const { accessToken, refreshToken } = response.data;

      // Save tokens securely
      await SecureStore.setItemAsync('accessToken', accessToken);
      await SecureStore.setItemAsync('refreshToken', refreshToken);
      await SecureStore.setItemAsync('userId', response.data.user.id);

      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Login
  async login(email, password) {
    try {
      const response = await apiClient.post('/api/auth/login', {
        email,
        password,
      });

      const { accessToken, refreshToken } = response.data;

      // Save tokens securely
      await SecureStore.setItemAsync('accessToken', accessToken);
      await SecureStore.setItemAsync('refreshToken', refreshToken);
      await SecureStore.setItemAsync('userId', response.data.user.id);

      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Logout
  async logout() {
    try {
      const refreshToken = await SecureStore.getItemAsync('refreshToken');
      
      await apiClient.post('/api/auth/logout', { refreshToken });

      // Clear tokens
      await SecureStore.deleteItemAsync('accessToken');
      await SecureStore.deleteItemAsync('refreshToken');
      await SecureStore.deleteItemAsync('userId');
    } catch (error) {
      console.error('Logout error:', error);
      // Still clear tokens even if logout fails
      await SecureStore.deleteItemAsync('accessToken');
      await SecureStore.deleteItemAsync('refreshToken');
      await SecureStore.deleteItemAsync('userId');
    }
  },

  // Get current user
  async getCurrentUser() {
    try {
      const response = await apiClient.get('/api/auth/me');
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Update profile
  async updateProfile(name, phone, profilePicture) {
    try {
      const response = await apiClient.put('/api/auth/update-profile', {
        name,
        phone,
        profilePicture,
      });
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Change password
  async changePassword(currentPassword, newPassword) {
    try {
      const response = await apiClient.post('/api/auth/change-password', {
        currentPassword,
        newPassword,
      });
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Check if user is logged in
  async isLoggedIn() {
    try {
      const accessToken = await SecureStore.getItemAsync('accessToken');
      return !!accessToken;
    } catch (error) {
      return false;
    }
  },

  // Get stored tokens (for debugging)
  async getTokens() {
    try {
      const accessToken = await SecureStore.getItemAsync('accessToken');
      const refreshToken = await SecureStore.getItemAsync('refreshToken');
      return { accessToken, refreshToken };
    } catch (error) {
      return null;
    }
  },
};

export default apiClient;