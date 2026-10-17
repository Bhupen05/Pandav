import api from './axios';

// What kind of day it was
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'half-day' | 'leave';
// Whether an admin has accepted the record
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'half-day', 'leave'];
export const APPROVAL_STATUSES: ApprovalStatus[] = ['pending', 'approved', 'rejected'];

// A record as the API returns it (matches the backend Attendance model)
export interface AttendanceRecord {
  _id: string;
  user: {
    _id: string;
    name: string;
    email?: string;
    department?: string;
    profileImage?: string;
  };
  date: string;
  // Calendar day, YYYY-MM-DD, in the team's timezone
  day: string;
  status: AttendanceStatus;
  approvalStatus: ApprovalStatus;
  checkInTime?: string;
  checkOutTime?: string;
  workHours?: number;
  remarks?: string;
  approvedBy?: { _id: string; name: string };
}

interface AttendanceData {
  user?: string;
  date: string;
  status: AttendanceStatus;
  approvalStatus?: ApprovalStatus;
  checkInTime?: string;
  checkOutTime?: string;
  remarks?: string;
}

export const attendanceAPI = {
  // Get all attendance records
  getAttendance: async (filters?: {
    user?: string;
    status?: AttendanceStatus;
    approvalStatus?: ApprovalStatus;
    startDate?: string;
    endDate?: string;
  }) => {
    const response = await api.get('/attendance', { params: filters });
    return response.data;
  },

  // Get single attendance record
  getAttendanceById: async (id: string) => {
    const response = await api.get(`/attendance/${id}`);
    return response.data;
  },

  // Create attendance record
  createAttendance: async (data: AttendanceData) => {
    const response = await api.post('/attendance', data);
    return response.data;
  },

  // Update attendance record
  updateAttendance: async (id: string, data: Partial<AttendanceData>) => {
    const response = await api.put(`/attendance/${id}`, data);
    return response.data;
  },

  // Approve a record (admin only)
  approveAttendance: async (id: string, remarks?: string) => {
    const response = await api.put(`/attendance/${id}/approve`, { remarks });
    return response.data;
  },

  // Reject a record (admin only)
  rejectAttendance: async (id: string, remarks?: string) => {
    const response = await api.put(`/attendance/${id}/disapprove`, { remarks });
    return response.data;
  },

  // Delete attendance record
  deleteAttendance: async (id: string) => {
    const response = await api.delete(`/attendance/${id}`);
    return response.data;
  },

  // Check-in
  checkIn: async () => {
    const response = await api.post('/attendance/checkin');
    return response.data;
  },

  // Check-out
  checkOut: async () => {
    const response = await api.post('/attendance/checkout');
    return response.data;
  },
};
