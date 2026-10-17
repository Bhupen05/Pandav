import Team from '../models/Team.js';
import TeamInvite from '../models/TeamInvite.js';
import User from '../models/User.js';
import Task from '../models/Task.js';
import Attendance from '../models/Attendance.js';
import { escapeRegex, pick, sendServerError } from '../utils/http.js';
import { toDayKey } from '../utils/dates.js';
import { canReviewFor, teamUserIds } from '../utils/teams.js';

// Fields a leader may set when creating a team task; progress and approval
// go through the task workflow
const TEAM_TASK_FIELDS = [
  'title',
  'description',
  'assignedTo',
  'priority',
  'startDate',
  'dueDate',
  'estimatedDays',
  'tags',
  'notes',
];

// ─── Team CRUD ────────────────────────────────────────────────────────────────

// @desc    Create team
// @route   POST /api/teams
// @access  Private (Admin or team leader)
export const createTeam = async (req, res) => {
  try {
    const { name, description } = req.body;
    let { leaderId } = req.body;

    if (req.user.role === 'team_leader') {
      const existingTeam = await Team.findOne({ leaders: req.user.id });
      if (existingTeam) {
        return res.status(400).json({ success: false, message: 'You already manage a team' });
      }
      leaderId = req.user.id;
    }

    if (!leaderId) {
      return res.status(400).json({ success: false, message: 'leaderId is required' });
    }

    const leader = await User.findById(leaderId);
    if (!leader) {
      return res.status(404).json({ success: false, message: 'Leader user not found' });
    }

    if (req.user.role === 'admin' && leader.teamId) {
      return res.status(400).json({ success: false, message: 'Selected leader already belongs to a team' });
    }

    const team = await Team.create({
      name,
      description,
      leaders: [leaderId],
      members: [],
      createdBy: req.user.id,
    });

    // Promote leader's role
    leader.role = 'team_leader';
    leader.teamId = team._id;
    await leader.save();

    const populated = await Team.findById(team._id)
      .populate('leaders', 'name email profileImage role')
      .populate('members', 'name email profileImage role')
      .populate('createdBy', 'name email');

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'A team with this name already exists' });
    }
    sendServerError(res, error);
  }
};

// @desc    Get all teams
// @route   GET /api/teams
// @access  Private (Admin)
export const getTeams = async (req, res) => {
  try {
    const teams = await Team.find()
      .populate('leaders', 'name email profileImage role')
      .populate('members', 'name email profileImage role')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: teams.length, data: teams });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get my team (for team_leader / member)
// @route   GET /api/teams/my
// @access  Private
export const getMyTeam = async (req, res) => {
  try {
    const team = await Team.findOne({
      $or: [
        { leaders: req.user.id },
        { members: req.user.id },
      ],
    })
      .populate('leaders', 'name email profileImage role department')
      .populate('members', 'name email profileImage role department')
      .populate('createdBy', 'name email');

    if (!team) {
      return res.status(404).json({ success: false, message: 'You are not part of any team' });
    }

    res.json({ success: true, data: team });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get single team
// @route   GET /api/teams/:id
// @access  Private (Admin or team leader/member)
export const getTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .populate('leaders', 'name email profileImage role department')
      .populate('members', 'name email profileImage role department')
      .populate('createdBy', 'name email');

    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // Allow admin, or leaders/members of this team
    const isMember =
      team.leaders.some(l => l._id.toString() === req.user.id.toString()) ||
      team.members.some(m => m._id.toString() === req.user.id.toString());

    if (req.user.role !== 'admin' && !isMember) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this team' });
    }

    res.json({ success: true, data: team });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Update team details
// @route   PUT /api/teams/:id
// @access  Private (Admin or team leader)
export const updateTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    // isLeaderOfTeam middleware already verified if not admin
    const { name, description, isActive } = req.body;
    if (name !== undefined) team.name = name;
    if (description !== undefined) team.description = description;
    if (isActive !== undefined && req.user.role === 'admin') team.isActive = isActive;

    await team.save();

    const populated = await Team.findById(team._id)
      .populate('leaders', 'name email profileImage role')
      .populate('members', 'name email profileImage role')
      .populate('createdBy', 'name email');

    res.json({ success: true, data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Delete team
// @route   DELETE /api/teams/:id
// @access  Private (Admin)
export const deleteTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    // Demote leaders and clear teamId from all affected users
    const allUserIds = [...team.leaders.map(l => l.toString()), ...team.members.map(m => m.toString())];
    await User.updateMany(
      { _id: { $in: allUserIds } },
      { $set: { teamId: null } }
    );
    await User.updateMany(
      { _id: { $in: team.members.map(m => m.toString()) }, role: 'team_member' },
      { $set: { role: 'user' } }
    );
    // Demote leaders back to user role
    await User.updateMany(
      { _id: { $in: team.leaders.map(l => l.toString()) }, role: 'team_leader' },
      { $set: { role: 'user' } }
    );

    await TeamInvite.deleteMany({ team: team._id });
    await team.deleteOne();

    res.json({ success: true, message: 'Team deleted successfully' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// ─── Members Management ───────────────────────────────────────────────────────

// @desc    Invite a user to team
// @route   POST /api/teams/:teamId/invite
// @access  Private (Admin or team leader)
export const inviteMember = async (req, res) => {
  try {
    let { userId, username } = req.body;
    const teamId = req.params.teamId;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    // If username provided instead of userId, look up the user
    if (!userId && username) {
      const userByName = await User.findOne({ name: { $regex: `^${escapeRegex(String(username).trim())}$`, $options: 'i' } });
      if (!userByName) {
        return res.status(404).json({ success: false, message: `User "${username}" not found` });
      }
      userId = userByName._id;
    }

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Please provide userId or username' });
    }

    const invitedUser = await User.findById(userId);
    if (!invitedUser) return res.status(404).json({ success: false, message: 'User not found' });

    // Check if already a member or leader
    const alreadyIn =
      team.leaders.some(l => l.toString() === userId) ||
      team.members.some(m => m.toString() === userId);
    if (alreadyIn) {
      return res.status(400).json({ success: false, message: 'User is already in this team' });
    }

    // Check for existing pending invite
    const existingInvite = await TeamInvite.findOne({ team: teamId, invitedUser: userId, status: 'pending' });
    if (existingInvite) {
      return res.status(400).json({ success: false, message: 'A pending invite already exists for this user' });
    }

    const invite = await TeamInvite.create({
      team: teamId,
      invitedUser: userId,
      invitedBy: req.user.id,
    });

    const populated = await TeamInvite.findById(invite._id)
      .populate('team', 'name description')
      .populate('invitedUser', 'name email profileImage')
      .populate('invitedBy', 'name email');

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Accept team invite
// @route   PUT /api/teams/invites/:inviteId/accept
// @access  Private (the invited user)
export const acceptInvite = async (req, res) => {
  try {
    const invite = await TeamInvite.findById(req.params.inviteId).populate('team');

    if (!invite) return res.status(404).json({ success: false, message: 'Invite not found' });

    if (invite.invitedUser.toString() !== req.user.id.toString()) {
      return res.status(403).json({ success: false, message: 'This invite is not for you' });
    }

    if (invite.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Invite is already ${invite.status}` });
    }

    if (invite.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'This invite has expired' });
    }

    const team = invite.team;

    // Add user to team.members if not already there
    if (!team.members.some(m => m.toString() === req.user.id.toString())) {
      team.members.push(req.user.id);
      await team.save();
    }

    // Promote accepted invitees to explicit team members
    await User.findByIdAndUpdate(req.user.id, {
      teamId: team._id,
      role: 'team_member',
    });

    invite.status = 'accepted';
    await invite.save();

    res.json({ success: true, message: 'Invite accepted. You are now part of the team.' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Decline team invite
// @route   PUT /api/teams/invites/:inviteId/decline
// @access  Private (the invited user)
export const declineInvite = async (req, res) => {
  try {
    const invite = await TeamInvite.findById(req.params.inviteId);

    if (!invite) return res.status(404).json({ success: false, message: 'Invite not found' });

    if (invite.invitedUser.toString() !== req.user.id.toString()) {
      return res.status(403).json({ success: false, message: 'This invite is not for you' });
    }

    if (invite.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Invite is already ${invite.status}` });
    }

    invite.status = 'declined';
    await invite.save();

    res.json({ success: true, message: 'Invite declined' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get my pending invites
// @route   GET /api/teams/invites/my
// @access  Private
export const getMyInvites = async (req, res) => {
  try {
    const invites = await TeamInvite.find({ invitedUser: req.user.id, status: 'pending' })
      .populate('team', 'name description')
      .populate('invitedBy', 'name email profileImage')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: invites.length, data: invites });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Remove a member from the team
// @route   DELETE /api/teams/:teamId/members/:userId
// @access  Private (Admin or team leader)
export const removeMember = async (req, res) => {
  try {
    const { teamId, userId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (req.user.role !== 'admin') {
      const isLeader = team.leaders.some(l => l.toString() === req.user.id.toString());
      if (!isLeader) {
        return res.status(403).json({ success: false, message: 'Only team leaders can remove members' });
      }
    }

    const isLeaderTarget = team.leaders.some(l => l.toString() === userId);
    // Leaders can only be removed by admin
    if (isLeaderTarget && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admin can remove a team leader' });
    }

    team.members = team.members.filter(m => m.toString() !== userId);
    if (isLeaderTarget) {
      team.leaders = team.leaders.filter(l => l.toString() !== userId);
      await User.findByIdAndUpdate(userId, { role: 'user', teamId: null });
    } else {
      await User.findByIdAndUpdate(userId, { role: 'user', teamId: null });
    }

    await team.save();

    const populated = await Team.findById(team._id)
      .populate('leaders', 'name email profileImage role')
      .populate('members', 'name email profileImage role');

    res.json({ success: true, data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Add an extra leader to team
// @route   POST /api/teams/:teamId/leaders
// @access  Private (Admin)
export const addLeader = async (req, res) => {
  try {
    const { userId } = req.body;
    const team = await Team.findById(req.params.teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!team.leaders.some(l => l.toString() === userId)) {
      team.leaders.push(userId);
    }
    // Remove from members if was a member
    team.members = team.members.filter(m => m.toString() !== userId);

    await team.save();
    user.role = 'team_leader';
    user.teamId = team._id;
    await user.save();

    const populated = await Team.findById(team._id)
      .populate('leaders', 'name email profileImage role')
      .populate('members', 'name email profileImage role');

    res.json({ success: true, data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};

// ─── Team Tasks ───────────────────────────────────────────────────────────────

// @desc    Get all tasks for a team
// @route   GET /api/teams/:teamId/tasks
// @access  Private (Admin or team leader/member)
export const getTeamTasks = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const isMember =
      team.leaders.some(l => l.toString() === req.user.id.toString()) ||
      team.members.some(m => m.toString() === req.user.id.toString());

    if (req.user.role !== 'admin' && !isMember) {
      return res.status(403).json({ success: false, message: 'Not authorized to view team tasks' });
    }

    const tasks = await Task.find({ team: teamId })
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Create a task for the team
// @route   POST /api/teams/:teamId/tasks
// @access  Private (Admin or team leader)
export const createTeamTask = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (req.user.role !== 'admin') {
      const isLeader = team.leaders.some(l => l.toString() === req.user.id.toString());
      if (!isLeader) {
        return res.status(403).json({ success: false, message: 'Only team leaders can create team tasks' });
      }
    }

    // Validate assignees are part of the team
    const allTeamUserIds = [
      ...team.leaders.map(l => l.toString()),
      ...team.members.map(m => m.toString()),
    ];

    const assignedTo = Array.isArray(req.body.assignedTo) ? req.body.assignedTo : [req.body.assignedTo];
    const invalidAssignees = assignedTo.filter(id => !allTeamUserIds.includes(id.toString()));
    if (invalidAssignees.length > 0) {
      return res.status(400).json({ success: false, message: 'All assignees must be members of the team' });
    }

    const task = await Task.create({
      ...pick(req.body, TEAM_TASK_FIELDS),
      createdBy: req.user.id,
      team: teamId,
    });

    const populated = await Task.findById(task._id)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('team', 'name');

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Get tasks pending approval for a team
// @route   GET /api/teams/:teamId/tasks/pending-approval
// @access  Private (Admin or team leader)
export const getTeamPendingApprovalTasks = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (req.user.role !== 'admin') {
      const isLeader = team.leaders.some(l => l.toString() === req.user.id.toString());
      if (!isLeader) {
        return res.status(403).json({ success: false, message: 'Only team leaders can view pending approvals' });
      }
    }

    const filter = { team: teamId, status: 'completion-requested' };
    if (req.user.role !== 'admin') filter.assignedTo = { $ne: req.user._id };

    const tasks = await Task.find(filter)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .sort({ completionRequestedAt: -1 });

    res.json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Approve team task completion
// @route   PUT /api/teams/:teamId/tasks/:taskId/approve
// @access  Private (Admin or team leader)
export const approveTeamTask = async (req, res) => {
  try {
    const { teamId, taskId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (req.user.role !== 'admin') {
      const isLeader = team.leaders.some(l => l.toString() === req.user.id.toString());
      if (!isLeader) {
        return res.status(403).json({ success: false, message: 'Only team leaders can approve tasks' });
      }
    }

    const task = await Task.findOne({ _id: taskId, team: teamId });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found in this team' });

    if (!(await canReviewFor(req.user, task.assignedTo))) {
      return res.status(403).json({ success: false, message: 'You cannot approve a task assigned to you' });
    }

    if (!task.hasCompletionRequest()) {
      return res.status(400).json({ success: false, message: 'Task completion has not been requested' });
    }

    task.approveCompletion(req.user.id);
    await task.save();

    const populated = await Task.findById(task._id)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('completionRequestedBy', 'name email');

    res.json({ success: true, message: 'Task completion approved', data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Reject team task completion
// @route   PUT /api/teams/:teamId/tasks/:taskId/reject
// @access  Private (Admin or team leader)
export const rejectTeamTask = async (req, res) => {
  try {
    const { teamId, taskId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (req.user.role !== 'admin') {
      const isLeader = team.leaders.some(l => l.toString() === req.user.id.toString());
      if (!isLeader) {
        return res.status(403).json({ success: false, message: 'Only team leaders can reject tasks' });
      }
    }

    const task = await Task.findOne({ _id: taskId, team: teamId });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found in this team' });

    if (!(await canReviewFor(req.user, task.assignedTo))) {
      return res.status(403).json({ success: false, message: 'You cannot reject a task assigned to you' });
    }

    if (!task.hasCompletionRequest()) {
      return res.status(400).json({ success: false, message: 'Task completion has not been requested' });
    }

    task.rejectCompletion(req.user.id, req.body.rejectionReason);
    await task.save();

    const populated = await Task.findById(task._id)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('rejectedBy', 'name email');

    res.json({ success: true, message: 'Task completion rejected', data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};

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
      filter.day = {};
      if (startDate) filter.day.$gte = toDayKey(startDate);
      if (endDate) filter.day.$lte = toDayKey(endDate);
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
    const { teamId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (req.user.role !== 'admin') {
      const isLeader = team.leaders.some(l => l.toString() === req.user.id.toString());
      if (!isLeader) {
        return res.status(403).json({ success: false, message: 'Only team leaders can view pending attendance' });
      }
    }

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
    const { teamId, attendanceId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (req.user.role !== 'admin') {
      const isLeader = team.leaders.some(l => l.toString() === req.user.id.toString());
      if (!isLeader) {
        return res.status(403).json({ success: false, message: 'Only team leaders can approve attendance' });
      }
    }

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
    const { teamId, attendanceId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (req.user.role !== 'admin') {
      const isLeader = team.leaders.some(l => l.toString() === req.user.id.toString());
      if (!isLeader) {
        return res.status(403).json({ success: false, message: 'Only team leaders can disapprove attendance' });
      }
    }

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
