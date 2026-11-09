import api from './axios';

interface LoginCredentials {
  email: string;
  password: string;
  // Keep the session after the browser closes
  rememberMe?: boolean;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  phone?: string;
  department?: string;
  profileImage?: string;
}

interface UpdatePasswordData {
  currentPassword: string;
  newPassword: string;
}

// The signed-in user, as kept for the session (the server's account payload)
export interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  department?: string;
  createdAt?: string;
  profileImage?: string;
  teamId?: string | null;
  // Whether the user confirmed that the address is theirs
  emailVerified: boolean;
  // An admin reset the password: nothing works until the owner chooses a new one
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  // Whether notifications marked for email are also emailed
  emailNotifications: boolean;
}

// What the sign-in screens need to know about this server
export interface AuthConfig {
  mailEnabled: boolean;
  emailVerificationRequired: boolean;
  passwordMinLength: number;
}

// The result of the first sign-in step: signed in, or a ticket for the code step
export type LoginResult =
  | { user: User; twoFactorTicket?: undefined }
  | { user?: undefined; twoFactorTicket: string };

type AccountPayload = Partial<User> & Pick<User, '_id' | 'name' | 'email' | 'role'>;

// Keeps the profile fields of a user returned by the API
export const toUser = (data: AccountPayload): User => ({
  _id: data._id,
  name: data.name,
  email: data.email,
  role: data.role,
  phone: data.phone,
  department: data.department,
  profileImage: data.profileImage,
  createdAt: data.createdAt,
  teamId: data.teamId,
  emailVerified: data.emailVerified === true,
  mustChangePassword: data.mustChangePassword === true,
  twoFactorEnabled: data.twoFactorEnabled === true,
  // On unless the user switched it off
  emailNotifications: data.emailNotifications !== false,
});

export const authAPI = {
  // Register new user
  register: async (data: RegisterData) => {
    const response = await api.post('/auth/register', data);
    return response.data;
  },

  // Login user. The server signs this browser in with an HttpOnly cookie, or,
  // with two-step sign-in on, answers with a ticket for the code step.
  login: async (credentials: LoginCredentials): Promise<LoginResult> => {
    const response = await api.post('/auth/login', {
      email: credentials.email.trim(),
      password: credentials.password,
      rememberMe: credentials.rememberMe === true,
    });
    const { data, message } = response.data;
    if (data?.twoFactorRequired && typeof data.ticket === 'string') {
      return { twoFactorTicket: data.ticket };
    }
    if (!response.data.success || !data) {
      throw { message: message || 'Invalid credentials' };
    }
    return { user: toUser(data) };
  },

  // Second sign-in step: the ticket from login and a code from the
  // authenticator app (or a backup code)
  verifyTwoFactor: async (ticket: string, code: string): Promise<User> => {
    const response = await api.post('/auth/2fa/verify', { ticket, code: code.trim() });
    return toUser(response.data.data);
  },

  // The user this browser's session cookie belongs to. Rejects with status
  // 401 when signed out. The first request can wake a sleeping server, so it
  // waits longer than other requests.
  getMe: async (): Promise<User> => {
    const response = await api.get('/auth/me', { timeout: 90000 });
    return toUser(response.data.data);
  },

  // Sign-in settings of this server: email set up, minimum password length
  getConfig: async (): Promise<AuthConfig> => {
    const response = await api.get('/auth/config');
    const data = response.data.data ?? {};
    return {
      mailEnabled: data.mailEnabled === true,
      emailVerificationRequired: data.emailVerificationRequired === true,
      passwordMinLength: Number(data.passwordMinLength) || 6,
    };
  },

  // Change password. Other sessions end; this one stays and is returned.
  updatePassword: async (data: UpdatePasswordData): Promise<User> => {
    const response = await api.put('/auth/updatepassword', data);
    return toUser(response.data.data);
  },

  // Clears the session cookie
  logout: async () => {
    await api.post('/auth/logout');
  },

  // Ends every session of the account, in every browser
  logoutAll: async () => {
    await api.post('/auth/logout-all');
  },

  // One-minute ticket for opening the chat socket
  socketToken: async (): Promise<string> => {
    const response = await api.post('/auth/socket-token');
    return response.data.data.token;
  },

  // Emails a link to choose a new password; the answer is the same whether or
  // not the address has an account
  forgotPassword: async (email: string): Promise<string | undefined> => {
    const response = await api.post('/auth/forgot-password', { email: email.trim() });
    return response.data.message;
  },

  // Chooses a new password with the token from the emailed link
  resetPassword: async (token: string, password: string): Promise<string | undefined> => {
    const response = await api.post('/auth/reset-password', { token, password });
    return response.data.message;
  },

  // Confirms the address with the token from the emailed link
  verifyEmail: async (token: string): Promise<{ message?: string; email?: string }> => {
    const response = await api.post('/auth/verify-email', { token });
    return { message: response.data.message, email: response.data.data?.email };
  },

  // A new confirmation link. Signed in: no address needed. Signed out (after
  // login refused the account): the address.
  resendVerification: async (email?: string): Promise<string | undefined> => {
    const response = await api.post('/auth/resend-verification', email ? { email: email.trim() } : undefined);
    return response.data.message;
  },

  // Two-step sign-in. Step 1: a secret and an otpauth address for the QR code
  setupTwoFactor: async (password: string): Promise<{ secret: string; otpauthUrl: string }> => {
    const response = await api.post('/auth/2fa/setup', { password });
    return response.data.data;
  },

  // Step 2: the first code from the app turns it on and returns the backup
  // codes, shown only this once
  enableTwoFactor: async (code: string): Promise<string[]> => {
    const response = await api.post('/auth/2fa/enable', { code: code.trim() });
    return response.data.data.backupCodes;
  },

  disableTwoFactor: async (password: string, code: string) => {
    await api.post('/auth/2fa/disable', { password, code: code.trim() });
  },

  // Replaces the backup codes; the old ones stop working
  renewBackupCodes: async (password: string, code: string): Promise<string[]> => {
    const response = await api.post('/auth/2fa/backup-codes', { password, code: code.trim() });
    return response.data.data.backupCodes;
  },
};
