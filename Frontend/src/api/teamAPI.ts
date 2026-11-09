import type { AxiosResponse } from 'axios';
import api from './axios';

// Query parameters shared by the paged lists below
export interface PageParams {
  page?: number;
  limit?: number;
}

export interface TeamTaskQuery extends PageParams {
  q?: string;
  status?: string;
  priority?: string;
  overdue?: boolean;
  sort?: string;
}

export interface TeamAttendanceQuery extends PageParams {
  startDate?: string;
  endDate?: string;
  // An approval state (pending, approved, rejected) or a kind of day
  status?: string;
}

export interface InviteTarget {
  userId?: string;
  email?: string;
  username?: string;
}

// A 429 from the invite limits says in Retry-After how many seconds to wait.
// The shared error handler drops response headers, so these requests let a
// 429 through and turn it into the usual error shape, with `retryAfter` added.
const letRateLimitThrough = {
  validateStatus: (status: number) => (status >= 200 && status < 300) || status === 429,
};

const unlessRateLimited = <T>(response: AxiosResponse<T>): T => {
  if (response.status === 429) {
    const data = response.data as { message?: string } | undefined;
    const seconds = Number(response.headers?.['retry-after']);
    throw {
      message: data?.message || 'Too many requests. Please try again later.',
      status: 429,
      data,
      retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
    };
  }
  return response.data;
};

// Text typed into an invite box: an email, a user id, or someone's full name
const inviteBody = (target: string | InviteTarget): InviteTarget => {
  if (typeof target !== 'string') return target;
  const value = target.trim();
  if (value.includes('@')) return { email: value };
  if (/^[a-f\d]{24}$/i.test(value)) return { userId: value };
  return { username: value };
};

const cleanParams = <T extends object>(params?: T) => {
  if (!params) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = typeof value === 'boolean' ? String(value) : (value as string | number);
  }
  return out;
};

export const teamAPI = {
  // ── Teams ─────────────────────────────────────────────────────────────────

  // Admin: every team, newest first. q matches part of the name; frozen
  // true/false keeps only frozen or only active teams
  getTeams: async (params?: { q?: string; frozen?: boolean }) => {
    const response = await api.get('/teams', { params: cleanParams(params) });
    return response.data;
  },

  // The team the signed-in user leads or belongs to (404 when none)
  getMyTeam: async () => {
    const response = await api.get('/teams/my');
    return response.data;
  },

  getTeam: async (teamId: string) => {
    const response = await api.get(`/teams/${teamId}`);
    return response.data;
  },

  // Anyone outside a team creates one they lead; admins name the leader
  createTeam: async (data: { name: string; description?: string; leaderId?: string }) => {
    const response = await api.post('/teams', data);
    return response.data;
  },

  // Rename, describe, or (admins) freeze and unfreeze a team
  updateTeam: async (teamId: string, data: { name?: string; description?: string; isActive?: boolean }) => {
    const response = await api.put(`/teams/${teamId}`, data);
    return response.data;
  },

  // Admin: delete a team. Its people go back to being users without a team
  deleteTeam: async (teamId: string) => {
    const response = await api.delete(`/teams/${teamId}`);
    return response.data;
  },

  // ── People ────────────────────────────────────────────────────────────────

  // Invite someone by user id, email or exact name. A string is read as an
  // email when it has an @, as an id when it looks like one, else as a name
  inviteMember: async (teamId: string, target: string | InviteTarget) => {
    const response = await api.post(`/teams/${teamId}/invite`, inviteBody(target), letRateLimitThrough);
    return unlessRateLimited(response);
  },

  // People who could be invited: part of a name, or a whole email (2+ characters)
  getInviteCandidates: async (teamId: string, q: string) => {
    const response = await api.get(`/teams/${teamId}/invite-candidates`, { params: { q } });
    return response.data;
  },

  // The invites a team has sent: open ones, and those declined, withdrawn or
  // expired in the last 30 days, each with its `state`
  getTeamInvites: async (teamId: string, params?: PageParams) => {
    const response = await api.get(`/teams/${teamId}/invites`, { params: cleanParams(params) });
    return response.data;
  },

  withdrawInvite: async (teamId: string, inviteId: string) => {
    const response = await api.delete(`/teams/${teamId}/invites/${inviteId}`);
    return response.data;
  },

  removeMember: async (teamId: string, userId: string) => {
    const response = await api.delete(`/teams/${teamId}/members/${userId}`);
    return response.data;
  },

  // Admin: make someone a leader (a member of the team, or someone in no team)
  addLeader: async (teamId: string, userId: string) => {
    const response = await api.post(`/teams/${teamId}/leaders`, { userId });
    return response.data;
  },

  // Leave the team (a leader only while another active leader stays)
  leaveTeam: async (teamId: string) => {
    const response = await api.post(`/teams/${teamId}/leave`);
    return response.data;
  },

  // Admin: active accounts with role `user`, who can lead or join a team
  searchEligibleUsers: async (q: string, limit = 10) => {
    const response = await api.get('/users', {
      params: cleanParams({ q: q.trim(), isActive: true, role: 'user', sort: 'name', page: 1, limit }),
    });
    return response.data;
  },

  // The signed-in user's role and team, after a change of membership
  getSessionRole: async (): Promise<{ role: string; teamId?: string | null }> => {
    const response = await api.get('/auth/me');
    const data = response.data?.data ?? {};
    return { role: data.role, teamId: data.teamId ?? null };
  },

  // ── Invites received ──────────────────────────────────────────────────────

  getMyInvites: async () => {
    const response = await api.get('/teams/invites/my');
    return response.data;
  },

  acceptInvite: async (inviteId: string) => {
    const response = await api.put(`/teams/invites/${inviteId}/accept`);
    return response.data;
  },

  declineInvite: async (inviteId: string) => {
    const response = await api.put(`/teams/invites/${inviteId}/decline`);
    return response.data;
  },

  // ── Team tasks ────────────────────────────────────────────────────────────

  // The team's tasks. With `page`, one page and `pagination`
  getTeamTasks: async (teamId: string, params?: TeamTaskQuery) => {
    const response = await api.get(`/teams/${teamId}/tasks`, { params: cleanParams(params) });
    return response.data;
  },

  // The tasks of this team that are assigned to the signed-in member
  getMyTeamTasks: async (teamId: string, params?: TeamTaskQuery) => {
    const response = await api.get('/tasks', { params: cleanParams({ ...params, team: teamId }) });
    return response.data;
  },

  createTeamTask: async (teamId: string, data: Record<string, unknown>) => {
    const response = await api.post(`/teams/${teamId}/tasks`, data);
    return response.data;
  },

  updateTask: async (taskId: string, data: Record<string, unknown>) => {
    const response = await api.put(`/tasks/${taskId}`, data);
    return response.data;
  },

  deleteTask: async (taskId: string) => {
    const response = await api.delete(`/tasks/${taskId}`);
    return response.data;
  },

  // Exactly the team's tasks the caller can review now
  getTeamPendingApprovalTasks: async (teamId: string) => {
    const response = await api.get(`/teams/${teamId}/tasks/pending-approval`);
    return response.data;
  },

  approveTeamTask: async (teamId: string, taskId: string) => {
    const response = await api.put(`/teams/${teamId}/tasks/${taskId}/approve`);
    return response.data;
  },

  rejectTeamTask: async (teamId: string, taskId: string, data?: { rejectionReason?: string }) => {
    const response = await api.put(`/teams/${teamId}/tasks/${taskId}/reject`, data || {});
    return response.data;
  },

  // ── Team attendance ───────────────────────────────────────────────────────

  getTeamAttendance: async (teamId: string, filters?: TeamAttendanceQuery) => {
    const response = await api.get(`/teams/${teamId}/attendance`, { params: cleanParams(filters) });
    return response.data;
  },

  // The team's pending days the caller can review
  getTeamPendingAttendance: async (teamId: string) => {
    const response = await api.get(`/teams/${teamId}/attendance/pending`);
    return response.data;
  },

  approveTeamAttendance: async (teamId: string, attendanceId: string, reviewRemarks?: string) => {
    const response = await api.put(
      `/teams/${teamId}/attendance/${attendanceId}/approve`,
      reviewRemarks ? { reviewRemarks } : {},
    );
    return response.data;
  },

  disapproveTeamAttendance: async (teamId: string, attendanceId: string, reviewRemarks?: string) => {
    const response = await api.put(
      `/teams/${teamId}/attendance/${attendanceId}/disapprove`,
      reviewRemarks ? { reviewRemarks } : {},
    );
    return response.data;
  },

  // The signed-in user's month: approved days by type and hours
  getMyAttendanceSummary: async (month?: string) => {
    const response = await api.get('/attendance/summary', { params: cleanParams({ month }) });
    return response.data;
  },
};
