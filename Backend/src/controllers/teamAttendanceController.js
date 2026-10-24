import Attendance from '../models/Attendance.js';
import Team from '../models/Team.js';
import { sendServerError } from '../utils/http.js';
import { dayRange } from '../utils/dates.js';
import { canReviewFor, findTeamToManage, teamUserIds } from '../utils/teams.js';

// Team attendance: the attendance endpoints under /api/v2/teams/:teamId/attendance

// ─── Team Attendance ──────────────────────────────────────────────────────────

// @desc    Get attendance for all team members
// @route   GET /api/teams/:teamId/attendance
// @access  Private (Admin or team leader)
export const getTeamAttendance = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { startDate, endDate, status } = req.query;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (req.user.role !== 'admin') {
      const isLeader = team.leaders.some(l => l.toString() === req.user.id.toString());
      if (!isLeader) {
        return res.status(403).json({ success: false, message: 'Only team leaders can view team attendance' });
      }
    }

    // Matched by member rather than the record's team, so check-ins from
    // before someone joined the team (or without a team set) still show
    const filter = { user: { $in: teamUserIds(team) } };
    if (status) {
      // Accept the approval states the team dashboard filters by as well as day types
      const approval = { requested: 'pending', pending: 'pending', approved: 'approved', rejected: 'rejected' }[status];
      if (approval) filter.approvalStatus = approval;
      else filter.status = status;
    }
    if (startDate || endDate) {
      const { range, error } = dayRange(startDate, endDate);
      if (error) return res.status(400).json({ success: false, message: error });
      filter.day = range;
    }

    const attendance = await Attendance.find(filter)
      .populate('user', 'name email department profileImage')
      .populate('team', 'name')
      .populate('approvedBy', 'name email')
      .sort('-date');

    res.json({ success: true, count: attendance.length, data: attendance });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get pending attendance for team (for leader approval)
// @route   GET /api/teams/:teamId/attendance/pending
// @access  Private (Admin or team leader)
export const getTeamPendingAttendance = async (req, res) => {
  try {
    const team = await findTeamToManage(req, res, 'view pending attendance');
    if (!team) return;

    const filter = { user: { $in: teamUserIds(team) }, approvalStatus: 'pending' };
    if (req.user.role !== 'admin') filter.user.$ne = req.user._id;

    const attendance = await Attendance.find(filter)
      .populate('user', 'name email department profileImage')
      .populate('team', 'name')
      .sort('-date');

    res.json({ success: true, count: attendance.length, data: attendance });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Approve attendance record (team leader)
// @route   PUT /api/teams/:teamId/attendance/:attendanceId/approve
// @access  Private (Admin or team leader)
export const approveTeamAttendance = async (req, res) => {
  try {
    const { attendanceId } = req.params;

    const team = await findTeamToManage(req, res, 'approve attendance');
    if (!team) return;

    const attendance = await Attendance.findById(attendanceId);
    if (!attendance) return res.status(404).json({ success: false, message: 'Attendance record not found' });

    // Make sure this attendance belongs to someone in the team
    if (!teamUserIds(team).includes(attendance.user.toString())) {
      return res.status(403).json({ success: false, message: 'This attendance does not belong to your team' });
    }

    if (!(await canReviewFor(req.user, [attendance.user]))) {
      return res.status(403).json({ success: false, message: 'You cannot review your own attendance' });
    }

    attendance.approvalStatus = 'approved';
    attendance.approvedBy = req.user.id;
    await attendance.save();

    const populated = await Attendance.findById(attendance._id)
      .populate('user', 'name email department profileImage')
      .populate('team', 'name')
      .populate('approvedBy', 'name email');

    res.json({ success: true, data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Disapprove attendance record (team leader)
// @route   PUT /api/teams/:teamId/attendance/:attendanceId/disapprove
// @access  Private (Admin or team leader)
export const disapproveTeamAttendance = async (req, res) => {
  try {
    const { attendanceId } = req.params;

    const team = await findTeamToManage(req, res, 'disapprove attendance');
    if (!team) return;

    const attendance = await Attendance.findById(attendanceId);
    if (!attendance) return res.status(404).json({ success: false, message: 'Attendance record not found' });

    // Make sure this attendance belongs to someone in the team
    if (!teamUserIds(team).includes(attendance.user.toString())) {
      return res.status(403).json({ success: false, message: 'This attendance does not belong to your team' });
    }

    if (!(await canReviewFor(req.user, [attendance.user]))) {
      return res.status(403).json({ success: false, message: 'You cannot review your own attendance' });
    }

    attendance.approvalStatus = 'rejected';
    attendance.approvedBy = req.user.id;
    await attendance.save();

    const populated = await Attendance.findById(attendance._id)
      .populate('user', 'name email department profileImage')
      .populate('team', 'name')
      .populate('approvedBy', 'name email');

    res.json({ success: true, data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};
