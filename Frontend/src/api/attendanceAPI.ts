import api, { type ApiError } from './axios';

// What kind of day it was
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'half-day' | 'leave';
// Whether a reviewer has accepted the record
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'half-day', 'leave'];
export const APPROVAL_STATUSES: ApprovalStatus[] = ['pending', 'approved', 'rejected'];

export interface PersonRef {
  _id: string;
  name: string;
  email?: string;
  department?: string;
  profileImage?: string;
  isActive?: boolean;
}

export interface CorrectionRequest {
  checkOutTime: string;
  remarks?: string;
  requestedAt?: string;
}

// A record as the API returns it (Backend/Doc/Attendance.md)
export interface AttendanceRecord {
  _id: string;
  user: PersonRef;
  team?: { _id: string; name: string } | null;
  date: string;
  // Calendar day, YYYY-MM-DD, in the app's timezone
  day: string;
  status: AttendanceStatus;
  approvalStatus: ApprovalStatus;
  // Absent (or null) until set
  checkInTime?: string;
  checkOutTime?: string;
  workHours?: number;
  // The owner's own note
  remarks?: string;
  // The reviewer's note on their decision
  reviewRemarks?: string;
  // Who approved or rejected it, and when
  approvedBy?: { _id: string; name: string; email?: string };
  reviewedAt?: string;
  leaveType?: string | null;
  leaveRequestId?: string | null;
  missedCheckout?: boolean;
  correctionRequest?: CorrectionRequest | null;
  autoMarked?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Someone or something to pick from a list: a person or a team
export interface PickOption {
  _id: string;
  name: string;
  email?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface ListResponse<T> {
  success: boolean;
  count: number;
  data: T[];
  pagination?: Pagination;
}

export interface AttendanceFilters {
  user?: string;
  team?: string;
  status?: AttendanceStatus;
  approvalStatus?: ApprovalStatus;
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  reviewable?: boolean;
  missedCheckout?: boolean;
  hasCorrection?: boolean;
  page?: number;
  limit?: number;
}

interface AttendanceData {
  user?: string;
  date: string;
  status: AttendanceStatus;
  approvalStatus?: ApprovalStatus;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  remarks?: string;
  reviewRemarks?: string;
  leaveType?: string | null;
}

export interface LeaveType {
  key: string;
  label: string;
  // null: no limit
  daysPerYear: number | null;
}

export interface AttendanceSettings {
  // ISO weekdays: 1 is Monday, 7 is Sunday
  workdays: number[];
  // 'HH:MM', or null when nobody is marked late
  shiftStart: string | null;
  lateAfterMinutes: number;
  halfDayHours: number | null;
  autoAbsent: boolean;
  leaveTypes: LeaveType[];
  // The server's time zone (APP_TIMEZONE), read-only: it decides each record's day
  timezone?: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export interface Holiday {
  _id: string;
  day: string;
  name: string;
}

export interface MonthSummary {
  user: string;
  month: string;
  days: { present: number; late: number; halfDay: number; absent: number; leave: number };
  approvedHours: number;
  pendingHours: number;
  pendingCount: number;
  rejectedCount: number;
}

export interface PersonStats {
  user: PersonRef;
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  leave: number;
  hours: number;
}

export interface AttendanceStats {
  pendingCount: number;
  checkedInToday: number;
  people: PersonStats[];
}

export type LeaveRequestStatus = ApprovalStatus | 'mixed';

export interface LeaveRequest {
  leaveRequestId: string;
  user: PersonRef;
  team?: { _id: string; name: string } | null;
  leaveType: string;
  leaveTypeLabel?: string;
  startDate: string;
  endDate: string;
  days: number;
  halfDay: boolean;
  approvalStatus: LeaveRequestStatus;
  counts: { pending: number; approved: number; rejected: number };
  remarks?: string;
  reviewRemarks?: string;
  approvedBy?: { _id: string; name: string; email?: string } | null;
  reviewedAt?: string | null;
  createdAt?: string;
  records: { _id: string; day: string; status: AttendanceStatus; approvalStatus: ApprovalStatus }[];
}

export interface LeaveBalanceType {
  key: string;
  label: string;
  allowance: number | null;
  approved: number;
  pending: number;
  remaining: number | null;
}

export interface LeaveBalance {
  user: string;
  year: number;
  types: LeaveBalanceType[];
}

export interface BulkReviewResult {
  results: { id: string; ok: boolean; status: number; approvalStatus?: ApprovalStatus; message?: string }[];
  succeeded: number;
  failed: number;
}

export interface LeaveRequestBody {
  startDate: string;
  endDate?: string;
  leaveType: string;
  remarks?: string;
  halfDay?: boolean;
}

// Query parameters without the empty ones, so "All" filters send nothing
const clean = (params: object = {}) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '' && value !== null && value !== false));

// A failed blob request carries the server's JSON error as a Blob
const readBlobError = async (error: unknown): Promise<never> => {
  const apiError = error as ApiError;
  if (apiError?.data instanceof Blob) {
    try {
      const body = JSON.parse(await apiError.data.text());
      throw { ...apiError, message: body?.message || apiError.message, data: body };
    } catch (parsed) {
      if (parsed && typeof parsed === 'object' && 'message' in parsed) throw parsed;
    }
  }
  throw error;
};

export const attendanceAPI = {
  // Records the caller may see, newest first; paged when `page` is sent
  getAttendance: async (filters?: AttendanceFilters) => {
    const response = await api.get('/attendance', { params: clean(filters) });
    return response.data;
  },

  // The same list, typed
  listRecords: async (filters?: AttendanceFilters): Promise<ListResponse<AttendanceRecord>> => {
    const response = await api.get('/attendance', { params: clean(filters) });
    return response.data;
  },

  getAttendanceById: async (id: string) => {
    const response = await api.get(`/attendance/${id}`);
    return response.data;
  },

  createAttendance: async (data: AttendanceData) => {
    const response = await api.post('/attendance', data);
    return response.data;
  },

  // Admins: any field; reviewers and owners: see the API docs.
  // correctionRequest: null declines a correction
  updateAttendance: async (id: string, data: Partial<AttendanceData> & { correctionRequest?: null }) => {
    const response = await api.put(`/attendance/${id}`, data);
    return response.data;
  },

  // Approve a pending record; the note is stored as the reviewer's remarks
  approveAttendance: async (id: string, reviewRemarks?: string) => {
    const response = await api.put(`/attendance/${id}/approve`, { reviewRemarks });
    return response.data;
  },

  // Reject a pending record; the reason is stored as the reviewer's remarks
  rejectAttendance: async (id: string, reviewRemarks?: string) => {
    const response = await api.put(`/attendance/${id}/disapprove`, { reviewRemarks });
    return response.data;
  },

  bulkReview: async (ids: string[], action: 'approve' | 'reject', reviewRemarks?: string): Promise<{ success: boolean; message: string; data: BulkReviewResult }> => {
    const response = await api.post('/attendance/bulk-review', { ids, action, reviewRemarks });
    return response.data;
  },

  deleteAttendance: async (id: string) => {
    const response = await api.delete(`/attendance/${id}`);
    return response.data;
  },

  checkIn: async () => {
    const response = await api.post('/attendance/checkin');
    return response.data;
  },

  checkOut: async () => {
    const response = await api.post('/attendance/checkout');
    return response.data;
  },

  // The owner asks for the check-out time of a day to be fixed
  requestCorrection: async (id: string, body: { checkOutTime: string; remarks?: string }) => {
    const response = await api.post(`/attendance/${id}/correction`, body);
    return response.data;
  },

  // One person's month (yourself unless `user` is given)
  getSummary: async (params: { user?: string; month?: string } = {}): Promise<{ success: boolean; data: MonthSummary }> => {
    const response = await api.get('/attendance/summary', { params: clean(params) });
    return response.data;
  },

  getStats: async (params: { startDate?: string; endDate?: string; team?: string } = {}): Promise<{ success: boolean; data: AttendanceStats }> => {
    const response = await api.get('/attendance/stats', { params: clean(params) });
    return response.data;
  },

  // CSV of the records matching the filters (no paging)
  exportCsv: async (filters: AttendanceFilters = {}): Promise<{ blob: Blob; filename: string }> => {
    const { page: _page, limit: _limit, ...rest } = filters;
    void _page;
    void _limit;
    try {
      const response = await api.get('/attendance/export', { params: clean(rest), responseType: 'blob' });
      const disposition = String(response.headers?.['content-disposition'] || '');
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
      return { blob: response.data, filename: match ? decodeURIComponent(match[1]) : 'attendance.csv' };
    } catch (error) {
      return readBlobError(error);
    }
  },

  getSettings: async (): Promise<{ success: boolean; data: AttendanceSettings }> => {
    const response = await api.get('/attendance/settings');
    return response.data;
  },

  updateSettings: async (settings: Partial<AttendanceSettings>): Promise<{ success: boolean; message?: string; data: AttendanceSettings }> => {
    const response = await api.put('/attendance/settings', settings);
    return response.data;
  },

  getHolidays: async (year?: number): Promise<{ success: boolean; count: number; data: Holiday[] }> => {
    const response = await api.get('/attendance/holidays', { params: clean({ year }) });
    return response.data;
  },

  createHoliday: async (body: { day: string; name: string }) => {
    const response = await api.post('/attendance/holidays', body);
    return response.data;
  },

  deleteHoliday: async (id: string) => {
    const response = await api.delete(`/attendance/holidays/${id}`);
    return response.data;
  },

  requestLeave: async (body: LeaveRequestBody): Promise<{ success: boolean; data: LeaveRequest }> => {
    const response = await api.post('/attendance/leave', body);
    return response.data;
  },

  getLeaveRequests: async (params: { status?: ApprovalStatus; user?: string; page?: number; limit?: number } = {}): Promise<ListResponse<LeaveRequest>> => {
    const response = await api.get('/attendance/leave', { params: clean(params) });
    return response.data;
  },

  getLeaveBalance: async (params: { user?: string; year?: number } = {}): Promise<{ success: boolean; data: LeaveBalance }> => {
    const response = await api.get('/attendance/leave/balance', { params: clean(params) });
    return response.data;
  },

  approveLeave: async (leaveRequestId: string, reviewRemarks?: string) => {
    const response = await api.put(`/attendance/leave/${leaveRequestId}/approve`, { reviewRemarks });
    return response.data;
  },

  rejectLeave: async (leaveRequestId: string, reviewRemarks?: string) => {
    const response = await api.put(`/attendance/leave/${leaveRequestId}/reject`, { reviewRemarks });
    return response.data;
  },

  withdrawLeave: async (leaveRequestId: string): Promise<{ success: boolean; message: string; data: { withdrawn: number; days: string[] } }> => {
    const response = await api.delete(`/attendance/leave/${leaveRequestId}`);
    return response.data;
  },

  // Admins: active people whose name or email contains `q` (the first 20 by name), for
  // choosing who a record is for and filtering by person
  searchPeople: async (q = ''): Promise<PickOption[]> => {
    const response = await api.get('/users', { params: clean({ q: q.trim(), isActive: true, sort: 'name', page: 1, limit: 20 }) });
    const people: PickOption[] = Array.isArray(response.data?.data) ? response.data.data : [];
    return people.map(({ _id, name, email }) => ({ _id, name, email }));
  },

  // Admins: one person's name, for a filter that opened from a link
  getPerson: async (id: string): Promise<PickOption> => {
    const response = await api.get(`/users/${encodeURIComponent(id)}`);
    const { _id, name, email } = response.data?.data ?? {};
    return { _id, name, email };
  },

  // Admins: teams whose name contains `q`. The server doesn't page this list, so only the first 20 are kept
  searchTeams: async (q = ''): Promise<PickOption[]> => {
    const response = await api.get('/teams', { params: clean({ q: q.trim() }) });
    const teams: PickOption[] = Array.isArray(response.data?.data) ? response.data.data : [];
    return teams.slice(0, 20).map(({ _id, name }) => ({ _id, name }));
  },

  // One team's name (admins, and the team's own people), for a filter that opened from a link
  getTeam: async (id: string): Promise<PickOption> => {
    const response = await api.get(`/teams/${encodeURIComponent(id)}`);
    const { _id, name } = response.data?.data ?? {};
    return { _id, name };
  },
};
