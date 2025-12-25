import api from './axios';

interface ContactData {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
}

export const contactAPI = {
  // Get all contact messages (Admin only)
  getContacts: async (filters?: { status?: string }) => {
    const response = await api.get('/contact', { params: filters });
    return response.data;
  },

  // Get single contact message (Admin only)
  getContact: async (id: string) => {
    const response = await api.get(`/contact/${id}`);
    return response.data;
  },

  // Submit contact form (Public)
  createContact: async (data: ContactData) => {
    const response = await api.post('/contact', data);
    return response.data;
  },

  // Update contact message status (Admin only)
  updateContact: async (id: string, data: { status: string }) => {
    const response = await api.put(`/contact/${id}`, data);
    return response.data;
  },

  // Delete contact message (Admin only)
  deleteContact: async (id: string) => {
    const response = await api.delete(`/contact/${id}`);
    return response.data;
  },
};
