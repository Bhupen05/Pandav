import api from './axios';

// Counts for the badges in the navigation. Tasks, attendance, teams and the
// Social Hub belong to other screens, so the shell reads only their totals,
// with its own calls.

const totalOf = (response: { data?: { pagination?: { total?: number } } }) =>
  Number(response.data?.pagination?.total) || 0;

export const navAPI = {
  // Team invites waiting for this user to answer
  pendingInvites: async (): Promise<number> => {
    const response = await api.get('/teams/invites/my');
    const { data, count } = response.data;
    return Array.isArray(data) ? data.length : Number(count) || 0;
  },

  // Tasks, attendance records and posts waiting for this reviewer. A part that
  // can't be read counts as zero, so one failing request never hides the rest.
  waitingApprovals: async (): Promise<number> => {
    const [tasks, attendance, posts] = await Promise.allSettled([
      api.get('/tasks/pending-approval', { params: { page: 1, limit: 1 } }),
      api.get('/attendance', { params: { approvalStatus: 'pending', reviewable: true, page: 1, limit: 1 } }),
      api.get('/social/posts/pending-approval'),
    ]);
    let total = 0;
    if (tasks.status === 'fulfilled') total += totalOf(tasks.value);
    if (attendance.status === 'fulfilled') total += totalOf(attendance.value);
    if (posts.status === 'fulfilled') {
      const { data, count } = posts.value.data;
      total += Array.isArray(data) ? data.length : Number(count) || 0;
    }
    return total;
  },

  // New messages in the contact inbox (admins)
  newContactMessages: async (): Promise<number> => {
    const response = await api.get('/admin/stats');
    return Number(response.data?.data?.contact?.byStatus?.new) || 0;
  },
};
