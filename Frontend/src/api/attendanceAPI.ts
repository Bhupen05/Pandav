import api from './axios';

interface AttendanceData {
  user?: string;
  date: string;
  status: string;
  checkInTime?: string;
  checkOutTime?: string;
  remarks?: string;
}

export const attendanceAPI = {
  // Get all attendance records
  getAttendance: async (filters?: {
    user?: string;
    status?: string;
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
