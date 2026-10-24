import Attendance from '../models/Attendance.js';
import Team from '../models/Team.js';
import { dayRange } from '../utils/dates.js';
import { listResponse, sendServerError } from '../utils/http.js';
import { findTeamToManage, isTeamLeader, teamUserIds } from '../utils/teams.js';
import { idOf, oid, readReviewRemarks, reviewRecord, withRefs } from '../utils/attendance.js';

// Team attendance: the attendance endpoints under /api/v2/teams/:teamId/attendance.
// A team's attendance is the records whose `team` is this team (set when each
// record was made), so a member's history from another team stays with that
// team, and the records of someone who has left stay readable here. Reviews
// follow the same rules as /api/v2/attendance (utils/attendance.js).

// ─── Team Attendance ──────────────────────────────────────────────────────────

// @desc    Get the team's attendance records
// @route   GET /api/v2/teams/:teamId/attendance
// @access  Private (Admin or the team's leaders, frozen or not)
export const getTeamAttendance = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { startDate, endDate, status } = req.query;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (req.user.role !== 'admin' && !isTeamLeader(team, req.user.id)) {
      return res.status(403).json({ success: false, message: 'Only team leaders can view team attendance' });
    }

    const filter = { team: team._id };
    if (status) {
      // Accept the approval states the team dashboard filters by as well as day types
      const approval = { requested: 'pending', pending: 'pending', approved: 'approved', rejected: 'rejected' }[status];
      if (approval) filter.approvalStatus = approval;
      else filter.status = String(status);
    }
    if (startDate || endDate) {
      const { range, error } = dayRange(startDate, endDate);
      if (error) return res.status(400).json({ success: false, message: error });
      filter.day = range;
    }

    const query = withRefs(Attendance.find(filter)).sort('-date');
    res.json(await listResponse(Attendance, filter, query, req.query));
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    The team's records waiting for review that the caller can review
// @route   GET /api/v2/teams/:teamId/attendance/pending
// @access  Private (Admin, or the team's leaders while it isn't frozen)
export const getTeamPendingAttendance = async (req, res) => {
  try {
    const team = await findTeamToManage(req, res, 'view pending attendance');
    if (!team) return;

    const filter = { team: team._id, approvalStatus: 'pending' };
    // A leader reviews the people still in the team, never themselves; a
    // former member's records are for admins
    if (req.user.role !== 'admin') {
      filter.user = { $in: teamUserIds(team).filter((id) => id !== idOf(req.user)).map(oid) };
    }

    const attendance = await withRefs(Attendance.find(filter)).sort('-date');
    res.json({ success: true, count: attendance.length, data: attendance });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Approves or rejects one of the team's records, by the same rules as
// PUT /attendance/:id/approve
const reviewTeamRecord = (approvalStatus, action, message) => async (req, res) => {
  try {
    const team = await findTeamToManage(req, res, `${action} attendance`);
    if (!team) return;

    const remarks = readReviewRemarks(req.body);
    if (remarks.error) return res.status(400).json({ success: false, message: remarks.error });

    const attendance = await Attendance.findById(req.params.attendanceId);
    if (!attendance) return res.status(404).json({ success: false, message: 'Attendance record not found' });

    if (idOf(attendance.team) !== idOf(team)) {
      return res.status(403).json({ success: false, message: 'This attendance does not belong to your team' });
    }

    const result = await reviewRecord(req, attendance, approvalStatus, remarks.value);
    if (result.status !== 200) return res.status(result.status).json({ success: false, message: result.message });

    res.json({ success: true, message, data: await withRefs(Attendance.findById(attendance._id)) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Approve attendance record (team leader)
// @route   PUT /api/v2/teams/:teamId/attendance/:attendanceId/approve
// @access  Private (Admin or team leader)
export const approveTeamAttendance = reviewTeamRecord('approved', 'approve', 'Attendance approved successfully');

// @desc    Reject attendance record (team leader)
// @route   PUT /api/v2/teams/:teamId/attendance/:attendanceId/disapprove (also /reject)
// @access  Private (Admin or team leader)
export const disapproveTeamAttendance = reviewTeamRecord('rejected', 'disapprove', 'Attendance rejected');
