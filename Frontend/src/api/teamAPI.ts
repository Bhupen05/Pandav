import api from './axios';

export const teamAPI = {
  // ── Team CRUD ────────────────────────────────────────────────────────────────

  // Admin: get all teams
  getTeams: async () => {
    const response = await api.get('/teams');
    return response.data;
  },

  // Get logged-in user's team
  getMyTeam: async () => {
    const response = await api.get('/teams/my');
    return response.data;
  },

  // Get single team by id
  getTeam: async (teamId: string) => {
    const response = await api.get(`/teams/${teamId}`);
    return response.data;
  },

  // Admin or team leader: create a team. Leaders are assigned automatically.
  createTeam: async (data: { name: string; description?: string; leaderId?: string }) => {
    const response = await api.post('/teams', data);
    return response.data;
  },

  // Admin or team leader: update team details
  updateTeam: async (teamId: string, data: { name?: string; description?: string; isActive?: boolean }) => {
    const response = await api.put(`/teams/${teamId}`, data);
    return response.data;
  },

  // Admin: delete team
  deleteTeam: async (teamId: string) => {
    const response = await api.delete(`/teams/${teamId}`);
    return response.data;
  },

  // ── Member Management ─────────────────────────────────────────────────────

  // Leader/Admin: invite a user to join the team (by userId or username)
  inviteMember: async (teamId: string, userIdentifier: string) => {
    // Check if it looks like an ObjectId (24 hex chars), else treat as username
    const isUserId = /^[a-f\d]{24}$/i.test(userIdentifier);
    const body = isUserId ? { userId: userIdentifier } : { username: userIdentifier };
    const response = await api.post(`/teams/${teamId}/invite`, body);
    return response.data;
  },

  // Leader/Admin: remove a member from team
  removeMember: async (teamId: string, userId: string) => {
    const response = await api.delete(`/teams/${teamId}/members/${userId}`);
    return response.data;
  },

  // Admin: add extra leader to team
  addLeader: async (teamId: string, userId: string) => {
    const response = await api.post(`/teams/${teamId}/leaders`, { userId });
    return response.data;
  },

  // ── Invites ───────────────────────────────────────────────────────────────

  // Get pending invites for logged-in user
  getMyInvites: async () => {
    const response = await api.get('/teams/invites/my');
    return response.data;
  },

  // Accept an invite
  acceptInvite: async (inviteId: string) => {
    const response = await api.put(`/teams/invites/${inviteId}/accept`);
    return response.data;
  },

  // Decline an invite
  declineInvite: async (inviteId: string) => {
    const response = await api.put(`/teams/invites/${inviteId}/decline`);
    return response.data;
  },

  // ── Team Tasks ────────────────────────────────────────────────────────────

  // Get all tasks for a team
  getTeamTasks: async (teamId: string) => {
    const response = await api.get(`/teams/${teamId}/tasks`);
    return response.data;
  },

  // Leader/Admin: create a task for the team
  createTeamTask: async (teamId: string, data: any) => {
    const response = await api.post(`/teams/${teamId}/tasks`, data);
    return response.data;
  },

  // Leader/Admin: get tasks pending approval
  getTeamPendingApprovalTasks: async (teamId: string) => {
    const response = await api.get(`/teams/${teamId}/tasks/pending-approval`);
    return response.data;
  },

  // Leader/Admin: approve a task completion
  approveTeamTask: async (teamId: string, taskId: string) => {
    const response = await api.put(`/teams/${teamId}/tasks/${taskId}/approve`);
    return response.data;
  },

  // Leader/Admin: reject a task completion
  rejectTeamTask: async (teamId: string, taskId: string, data?: { rejectionReason?: string }) => {
    const response = await api.put(`/teams/${teamId}/tasks/${taskId}/reject`, data || {});
    return response.data;
  },

  // ── Team Attendance ───────────────────────────────────────────────────────

  // Leader/Admin: get all attendance for team
  getTeamAttendance: async (teamId: string, filters?: { startDate?: string; endDate?: string; status?: string }) => {
    const response = await api.get(`/teams/${teamId}/attendance`, { params: filters });
    return response.data;
  },

  // Leader/Admin: get pending attendance requests
  getTeamPendingAttendance: async (teamId: string) => {
    const response = await api.get(`/teams/${teamId}/attendance/pending`);
    return response.data;
  },

  // Leader/Admin: approve attendance
  approveTeamAttendance: async (teamId: string, attendanceId: string) => {
    const response = await api.put(`/teams/${teamId}/attendance/${attendanceId}/approve`);
    return response.data;
  },

  // Leader/Admin: disapprove attendance
  disapproveTeamAttendance: async (teamId: string, attendanceId: string) => {
    const response = await api.put(`/teams/${teamId}/attendance/${attendanceId}/disapprove`);
    return response.data;
  },
};
