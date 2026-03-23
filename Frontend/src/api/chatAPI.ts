/**
 * Chat API Module - V2
 *
 * Handles all chat-related API calls including:
 * - Direct messaging (user-to-user)
 * - Team messaging
 * - Message history retrieval
 * - Chat list management
 */

import api from './axios';

interface SendMessagePayload {
  receiverId?: string;
  teamId?: string;
  message: string;
}

export const chatAPI = {
  /**
   * Direct Chat - Legacy endpoints
   */

  // Send direct message
  sendMessage: async (payload: SendMessagePayload) => {
    const response = await api.post('/chat/send', payload);
    return response.data;
  },

  // Get messages with a specific user
  getMessages: async (userId: string) => {
    const response = await api.get(`/chat/messages/${userId}`);
    return response.data;
  },

  // Get all conversations/chat list
  getChats: async () => {
    const response = await api.get('/chat/chats');
    return response.data;
  },

  /**
   * Team Chat - Endpoints
   */

  // Send team message
  sendTeamMessage: async (teamId: string, message: string) => {
    const response = await api.post(`/chat/teams/${teamId}/send`, { message });
    return response.data;
  },

  // Get team messages
  getTeamMessages: async (teamId: string, limit: number = 50, offset: number = 0) => {
    const response = await api.get(`/chat/teams/${teamId}/messages`, {
      params: { limit, offset }
    });
    return response.data;
  },

  // Get all team chats (conversations for teams the user is in)
  getTeamChats: async () => {
    const response = await api.get('/chat/teams/chats');
    return response.data;
  },

  /**
   * Social - Permission-gated direct messaging
   * (Only works with accepted connections)
   */

  // Send message to a connected user
  sendSocialMessage: async (userId: string, message: string) => {
    const response = await api.post('/social/messages', { userId, message });
    return response.data;
  },

  // Get messages with a connected user
  getSocialMessages: async (userId: string) => {
    const response = await api.get(`/social/messages/${userId}`);
    return response.data;
  },

  /**
   * Helper functions
   */

  // Mark message as read
  markMessageAsRead: async (messageId: string) => {
    const response = await api.patch(`/chat/messages/${messageId}/read`);
    return response.data;
  },

  // Delete message
  deleteMessage: async (messageId: string) => {
    const response = await api.delete(`/chat/messages/${messageId}`);
    return response.data;
  },
};
