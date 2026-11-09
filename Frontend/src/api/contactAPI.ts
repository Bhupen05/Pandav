import api, { type ApiError } from './axios';

// What the server accepts for each field of the public form (Backend/Doc/Contact.md)
export const CONTACT_LIMITS = {
  name: 100,
  email: 254,
  phone: 30,
  subject: 200,
  message: 5000,
} as const;

export type ContactField = keyof typeof CONTACT_LIMITS;

// The form takes this many messages an hour from each visitor address
export const CONTACT_HOURLY_LIMIT = 5;

interface ContactData {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
  // The hidden field people never see; only form-filling bots send a value
  website?: string;
}

// A refused request, plus how long to wait when there were too many (429)
export interface ContactError extends ApiError {
  // Seconds, from the Retry-After header
  retryAfter?: number;
}

const DEFAULT_LIMIT_MESSAGE = 'Too many messages sent. Please try again later.';

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

  // Submit contact form (Public). Rejects with a ContactError; a 429 carries
  // retryAfter, which the shared error handling drops along with the headers.
  createContact: async (data: ContactData) => {
    const response = await api.post('/contact', data, {
      validateStatus: (status) => (status >= 200 && status < 300) || status === 429,
    });

    if (response.status === 429) {
      const seconds = Number(response.headers['retry-after']);
      const refused: ContactError = {
        message: response.data?.message || DEFAULT_LIMIT_MESSAGE,
        status: 429,
        data: response.data,
        response: { status: 429, data: response.data },
        retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
      };
      return Promise.reject(refused);
    }

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
