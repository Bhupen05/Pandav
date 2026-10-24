import mongoose from 'mongoose';
import Team, { TEAM_DESCRIPTION_MAX, TEAM_NAME_MAX } from '../models/Team.js';
import TeamInvite, { inviteState } from '../models/TeamInvite.js';
import User from '../models/User.js';
import Task from '../models/Task.js';
import Attendance from '../models/Attendance.js';
import TeamChatMessage from '../models/TeamChatMessage.js';
import { escapeRegex, pick, sendServerError } from '../utils/http.js';
import { notify } from '../utils/notify.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { blockedUserIds, isBlockedBetween } from '../utils/blocks.js';
import { FROZEN_TEAM_MESSAGE, findTeamToManage, isInAnyTeam, isTeamLeader, teamUserIds } from '../utils/teams.js';

const TEAM_ROLES = ['team_leader', 'team_member'];

const LAST_LEADER_MESSAGE = "This is the team's only leader. Make someone else a leader first, or delete the team.";
const ONLY_LEADER_LEAVING_MESSAGE =
  "You are this team's only leader. Ask an admin to make someone else a leader before you leave, or to delete the team.";
const ALREADY_IN_A_TEAM_MESSAGE = 'You already belong to a team. Leave it before joining another one.';
const TEAM_GONE_MESSAGE = 'This team no longer accepts members';

// What the team endpoints show about each leader and member
const PERSON_FIELDS = 'name email profileImage role department isActive';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// A team can send this many invites an hour, so nobody can be flooded with them
const INVITES_PER_HOUR = 30;
// How far back the sent-invites list shows declined, withdrawn and expired ones
const INVITE_HISTORY_DAYS = 30;
const MAX_CANDIDATES = 10;
const MAX_SEARCH_LENGTH = 100;

const idText = (ref) => String(ref?._id ?? ref);

// A team with its people. Deleted accounts are taken out of their team when
// they are deleted; they are left out here too, in case one wasn't.
const withPeople = (query) => query
  .populate({ path: 'leaders', select: PERSON_FIELDS, match: { deletedAt: null } })
  .populate({ path: 'members', select: PERSON_FIELDS, match: { deletedAt: null } })
  .populate('createdBy', 'name email');

const loadTeam = (teamId) => withPeople(Team.findById(teamId));

// How many of each team's invites are still waiting for an answer, by team id
const openInviteCounts = async (teamIds, now = new Date()) => {
  const rows = await TeamInvite.aggregate([
    { $match: { team: { $in: teamIds }, status: 'pending', expiresAt: { $gt: now } } },
    { $group: { _id: '$team', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
};

// A populated team plus its head counts; openInvites only for those who may
// see the team's invites
const withCounts = (team, openInvites) => ({
  ...team.toObject(),
  counts: {
    leaders: team.leaders.length,
    members: team.members.length,
    ...(openInvites === undefined ? {} : { openInvites }),
  },
});

// Why this user can't be made a team's leader, or null if they can. A user
// belongs to at most one team, and admins never take a team role (it would
// replace their admin role).
const leaderProblem = async (user, teamId = null) => {
  if (!user.isActive) return 'This account is deactivated';
  if (user.role === 'admin') return 'An admin cannot lead a team';
  if (await isInAnyTeam(user._id, teamId)) return 'This user already belongs to another team';
  return null;
};

// Why this user can't be invited to a team, or null if they can
const inviteeProblem = async (user) => {
  if (!user.isActive) return 'This account is deactivated';
  if (user.role === 'admin' || user.role === 'team_leader') return 'Admins and team leaders cannot be invited to a team';
  if (await isInAnyTeam(user._id)) return 'This user already belongs to a team';
  return null;
};

// Why the signed-in user can't accept an invite right now, or null
const joinProblem = async (user) => {
  if (user.role === 'admin' || user.role === 'team_leader') return 'Admins and team leaders cannot join a team by invite';
  if (await isInAnyTeam(user._id)) return ALREADY_IN_A_TEAM_MESSAGE;
  return null;
};

const isTextOrUnset = (value) => value === undefined || typeof value === 'string';

// Why a team name or description is too long, or null
const lengthProblem = (name, description) => {
  if (typeof name === 'string' && name.trim().length > TEAM_NAME_MAX) {
    return `A team name can be at most ${TEAM_NAME_MAX} characters`;
  }
  if (typeof description === 'string' && description.trim().length > TEAM_DESCRIPTION_MAX) {
    return `A team description can be at most ${TEAM_DESCRIPTION_MAX} characters`;
  }
  return null;
};

// Takes someone who just left a team (or was removed) back to a plain user:
// only a team role is taken away, only while they aren't in another team, and
// their open team tasks no longer wait on them. Finished ones keep them as
// the record of who did the work.
const releaseFromTeam = async (userId, teamId) => {
  await User.updateOne(
    { _id: userId, role: { $in: TEAM_ROLES }, teamId: { $in: [teamId, null] } },
    { $set: { role: 'user' } }
  );
  await User.updateOne({ _id: userId, teamId }, { $set: { teamId: null } });
  await Task.unassignUser(userId, { team: teamId });
};

// Puts an invite whose acceptance couldn't finish back to pending
const reopenInvite = (inviteId) =>
  TeamInvite.updateOne({ _id: inviteId, status: 'accepted' }, { $set: { status: 'pending' }, $unset: { respondedAt: 1 } });

// The answer for an invite that is no longer pending or has expired
const closedInviteMessage = (invite, now = new Date()) => {
  const state = inviteState(invite, now);
  return state === 'expired' ? 'This invite has expired' : `Invite is already ${state}`;
};

// ─── Team CRUD ────────────────────────────────────────────────────────────────

// @desc    Create team
// @route   POST /api/v2/teams
// @access  Private. An admin picks the leader; anyone else who isn't in a
//          team creates their own and becomes its leader.
export const createTeam = async (req, res) => {
  try {
    const { name, description } = req.body;
    const isAdmin = req.user.role === 'admin';
    const leaderId = isAdmin ? req.body.leaderId : req.user.id;

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'A team name is required' });
    }
    if (!isTextOrUnset(description)) {
      return res.status(400).json({ success: false, message: 'The team description must be text' });
    }
    const tooLong = lengthProblem(name, description);
    if (tooLong) return res.status(400).json({ success: false, message: tooLong });

    if (!leaderId) {
      return res.status(400).json({ success: false, message: 'leaderId is required' });
    }

    const leader = await User.findOne({ _id: leaderId, deletedAt: null });
    if (!leader) {
      return res.status(404).json({ success: false, message: 'Leader user not found' });
    }

    const alreadyInTeam = isAdmin ? 'Selected leader already belongs to a team' : 'You already belong to a team';
    const problem = await leaderProblem(leader);
    if (problem || (isAdmin && leader.teamId)) {
      return res.status(400).json({ success: false, message: isAdmin ? problem || alreadyInTeam : alreadyInTeam });
    }

    // Claim the leader before the team exists, and only while their team is
    // still what was checked above, so a second team or an invite accepted
    // at the same moment can't also take them
    const teamId = new mongoose.Types.ObjectId();
    const before = await User.findOneAndUpdate(
      { _id: leader._id, teamId: leader.teamId ?? null, isActive: true, deletedAt: null, role: { $ne: 'admin' } },
      { $set: { role: 'team_leader', teamId } }
    );
    if (!before) {
      return res.status(400).json({ success: false, message: alreadyInTeam });
    }

    let team;
    try {
      team = await Team.create({
        _id: teamId,
        name,
        description,
        leaders: [leader._id],
        members: [],
        createdBy: req.user.id,
      });
    } catch (error) {
      // No team after all (a taken name, say): the leader gets their role back
      await User.updateOne({ _id: leader._id, teamId }, { $set: { role: before.role, teamId: before.teamId ?? null } });
      throw error;
    }

    if (isAdmin) {
      await notify(req, leader._id, {
        type: 'team_leader_added',
        title: `${req.user.name} made you the leader of ${team.name}`,
        body: 'You can now invite people to the team and give them tasks.',
        link: '/teams',
        data: { teamId: String(team._id) },
      });
    }
    await logAuditEventV2(req, {
      action: 'team_created',
      targetType: 'Team',
      targetId: team._id,
      details: { name: team.name, leaderId: String(leader._id) },
    });

    res.status(201).json({ success: true, data: await loadTeam(team._id) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'A team with this name already exists' });
    }
    sendServerError(res, error);
  }
};

// @desc    Get all teams, with head counts. ?q= matches the name, ?frozen=true|false
// @route   GET /api/v2/teams
// @access  Private (Admin)
export const getTeams = async (req, res) => {
  try {
    const { q, frozen } = req.query;
    const filter = {};

    if (q !== undefined) {
      if (typeof q !== 'string') {
        return res.status(400).json({ success: false, message: 'The search must be text' });
      }
      if (q.trim().length > MAX_SEARCH_LENGTH) {
        return res.status(400).json({ success: false, message: `The search can be at most ${MAX_SEARCH_LENGTH} characters` });
      }
      if (q.trim()) filter.name = { $regex: escapeRegex(q.trim()), $options: 'i' };
    }
    if (frozen !== undefined) {
      if (frozen !== 'true' && frozen !== 'false') {
        return res.status(400).json({ success: false, message: 'frozen must be true or false' });
      }
      filter.isActive = frozen === 'true' ? false : { $ne: false };
    }

    const teams = await withPeople(Team.find(filter)).sort({ createdAt: -1 });
    const invites = await openInviteCounts(teams.map((team) => team._id));
    const data = teams.map((team) => withCounts(team, invites.get(String(team._id)) || 0));

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get my team (for team_leader / member)
// @route   GET /api/v2/teams/my
// @access  Private
export const getMyTeam = async (req, res) => {
  try {
    const team = await withPeople(Team.findOne({
      $or: [
        { leaders: req.user.id },
        { members: req.user.id },
      ],
    }));

    if (!team) {
      return res.status(404).json({ success: false, message: 'You are not part of any team' });
    }

    // Leaders also see how many of the team's invites are still open
    const openInvites = isTeamLeader(team, req.user.id)
      ? (await openInviteCounts([team._id])).get(String(team._id)) || 0
      : undefined;

    res.json({ success: true, data: withCounts(team, openInvites) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get single team
// @route   GET /api/v2/teams/:id
// @access  Private (Admin or team leader/member)
export const getTeam = async (req, res) => {
  try {
    const team = await loadTeam(req.params.id);

    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // Allow admin, or leaders/members of this team
    const isAdmin = req.user.role === 'admin';
    const isLeader = isTeamLeader(team, req.user.id);
    const isMember = isLeader || team.members.some((m) => m._id.toString() === req.user.id.toString());

    if (!isAdmin && !isMember) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this team' });
    }

    const openInvites = isAdmin || isLeader
      ? (await openInviteCounts([team._id])).get(String(team._id)) || 0
      : undefined;

    res.json({ success: true, data: withCounts(team, openInvites) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Tells a team's people that an admin froze or unfroze it. Leaders and
// members have different team pages and different things they can still do.
const notifyFreeze = async (req, team, frozen) => {
  const type = frozen ? 'team_frozen' : 'team_unfrozen';
  const title = frozen ? `${team.name} has been frozen` : `${team.name} has been unfrozen`;
  const data = { teamId: String(team._id) };
  await notify(req, team.leaders, {
    type,
    title,
    body: frozen
      ? "An admin has paused the team. You can still read its tasks, attendance and chat, but you can't change or approve anything until it is unfrozen."
      : 'An admin has unfrozen the team. You can manage it and review its work again.',
    link: '/teams',
    data,
  });
  await notify(req, team.members, {
    type,
    title,
    body: frozen
      ? 'An admin has paused the team. You can still work on your tasks and check in; anything that needs a review goes to an admin, and the team chat is read-only.'
      : 'An admin has unfrozen the team. Your leaders review your work again, and the team chat is open.',
    link: '/team-member',
    data,
  });
};

// @desc    Update team details; admins also freeze or unfreeze it
// @route   PUT /api/v2/teams/:id
// @access  Private (Admin or team leader)
export const updateTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const isAdmin = req.user.role === 'admin';
    // isLeaderOfTeam middleware already verified if not admin
    if (!team.isActive && !isAdmin) {
      return res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE });
    }

    const { name, description } = req.body;
    // "true"/"false" as text are read as booleans, as on users
    const isActive = ['true', 'false'].includes(req.body.isActive) ? req.body.isActive === 'true' : req.body.isActive;
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive must be true or false' });
    }
    if (!isTextOrUnset(name) || !isTextOrUnset(description) || (name !== undefined && !name.trim())) {
      return res.status(400).json({ success: false, message: 'Team name and description must be text' });
    }
    const tooLong = lengthProblem(name, description);
    if (tooLong) return res.status(400).json({ success: false, message: tooLong });

    const changes = {};
    if (name !== undefined) changes.name = name.trim();
    if (description !== undefined) changes.description = description.trim();
    if (isActive !== undefined && isAdmin) changes.isActive = isActive;

    if (Object.keys(changes).length > 0) {
      // A leader's change goes through only while the team is still active
      const before = await Team.findOneAndUpdate(
        { _id: team._id, ...(isAdmin ? {} : { isActive: true }) },
        { $set: changes },
        { runValidators: true }
      );
      if (!before) {
        const stillThere = await Team.exists({ _id: team._id });
        return stillThere
          ? res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE })
          : res.status(404).json({ success: false, message: 'Team not found' });
      }

      const after = await Team.findById(team._id);
      const edited = ['name', 'description'].filter((field) => changes[field] !== undefined && (before[field] || '') !== changes[field]);
      if (edited.length > 0) {
        await logAuditEventV2(req, {
          action: 'team_updated',
          targetType: 'Team',
          targetId: team._id,
          details: { fields: edited, ...(edited.includes('name') ? { from: before.name, to: after.name } : {}) },
        });
      }
      // Only a change of state is announced, not a repeated freeze
      if (changes.isActive !== undefined && before.isActive !== changes.isActive) {
        await notifyFreeze(req, after, !changes.isActive);
        await logAuditEventV2(req, {
          action: changes.isActive ? 'team_unfrozen' : 'team_frozen',
          targetType: 'Team',
          targetId: team._id,
          details: { name: after.name },
        });
      }
    }

    res.json({ success: true, data: await loadTeam(team._id) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'A team with this name already exists' });
    }
    sendServerError(res, error);
  }
};

// @desc    Delete team
// @route   DELETE /api/v2/teams/:id
// @access  Private (Admin)
export const deleteTeam = async (req, res) => {
  try {
    // Deleting the team first means nobody can join it while it is cleaned up
    const team = await Team.findOneAndDelete({ _id: req.params.id });
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    // Leaders and members go back to plain users (only those whose team this
    // was), and nothing is left pointing at the deleted team
    const allUserIds = teamUserIds(team);
    const people = { $or: [{ _id: { $in: allUserIds } }, { teamId: team._id }] };
    await User.updateMany(
      { ...people, role: { $in: TEAM_ROLES }, teamId: { $in: [team._id, null] } },
      { $set: { role: 'user' } }
    );
    await User.updateMany({ teamId: team._id }, { $set: { teamId: null } });

    await Promise.all([
      TeamInvite.deleteMany({ team: team._id }),
      TeamChatMessage.deleteMany({ team: team._id }),
      Task.updateMany({ team: team._id }, { $set: { team: null } }),
      Attendance.updateMany({ team: team._id }, { $set: { team: null } }),
    ]);

    await notify(req, allUserIds, {
      type: 'team_deleted',
      title: `${team.name} was deleted`,
      body: 'An admin deleted the team, so you are no longer in a team. Your tasks and attendance records are kept.',
      link: '/teams',
      data: { teamId: String(team._id) },
    });
    await logAuditEventV2(req, {
      action: 'team_deleted',
      targetType: 'Team',
      targetId: team._id,
      details: { name: team.name, leaders: team.leaders.length, members: team.members.length },
    });

    res.json({ success: true, message: 'Team deleted successfully' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// ─── Invites ──────────────────────────────────────────────────────────────────

// The person an invite is for, by id, email or name (in that order of
// preference). Deactivated and deleted accounts are never found, so an invite
// can't be used to learn whether one exists. Returns { user, byEmail } or
// { status, message }.
const findInvitee = async ({ userId, email, username }) => {
  const visible = { isActive: true, deletedAt: null };
  const given = (value) => value !== undefined && value !== null && value !== '';

  if (given(userId)) {
    if (!mongoose.isObjectIdOrHexString(userId)) return { status: 400, message: 'Invalid userId' };
    const user = await User.findOne({ _id: userId, ...visible });
    return user ? { user } : { status: 404, message: 'User not found' };
  }

  if (given(email)) {
    if (typeof email !== 'string') return { status: 400, message: 'The email must be text' };
    const address = email.trim().toLowerCase();
    const user = await User.findOne({ email: address, ...visible });
    return user ? { user, byEmail: true } : { status: 404, message: `Nobody with the email ${address} was found` };
  }

  if (given(username)) {
    if (typeof username !== 'string' || !username.trim()) return { status: 400, message: 'The name must be text' };
    const name = username.trim();
    // Names aren't unique, so a name only works when it picks out one person
    const matches = await User.find({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' }, ...visible }).limit(2);
    if (matches.length === 0) return { status: 404, message: `User "${name}" not found` };
    if (matches.length > 1) {
      return { status: 409, message: `More than one person is called ${name}. Invite them by email.` };
    }
    return { user: matches[0] };
  }

  return { status: 400, message: 'Please provide userId, email or username' };
};

// @desc    Invite a user to team, by userId, email or username
// @route   POST /api/v2/teams/:teamId/invite
// @access  Private (Admin or team leader)
export const inviteMember = async (req, res) => {
  try {
    const team = await Team.findById(req.params.teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
    if (!team.isActive) return res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE });

    // At most INVITES_PER_HOUR invites per team in any hour
    const now = new Date();
    const recent = await TeamInvite.find({ team: team._id, createdAt: { $gt: new Date(now.getTime() - HOUR_MS) } })
      .select('createdAt')
      .sort({ createdAt: 1 })
      .limit(INVITES_PER_HOUR);
    if (recent.length >= INVITES_PER_HOUR) {
      const retryAfter = Math.max(1, Math.ceil((recent[0].createdAt.getTime() + HOUR_MS - now.getTime()) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        message: `This team has sent ${INVITES_PER_HOUR} invites in the last hour. Please try again later.`,
      });
    }

    const found = await findInvitee(pick(req.body, ['userId', 'email', 'username']));
    if (!found.user) return res.status(found.status).json({ success: false, message: found.message });
    const invitedUser = found.user;

    if (teamUserIds(team).includes(String(invitedUser._id))) {
      return res.status(400).json({ success: false, message: 'User is already in this team' });
    }

    const problem = await inviteeProblem(invitedUser);
    if (problem) return res.status(400).json({ success: false, message: problem });

    // Nobody gets invites from someone they blocked, or who blocked them
    if (req.user.role !== 'admin' && await isBlockedBetween(req.user._id, invitedUser._id)) {
      return res.status(403).json({ success: false, message: "You can't invite this person" });
    }

    // An unexpired pending invite blocks a second one; an expired one doesn't
    const existingInvite = await TeamInvite.findOne({
      team: team._id, invitedUser: invitedUser._id, status: 'pending', expiresAt: { $gt: now },
    });
    if (existingInvite) {
      return res.status(400).json({ success: false, message: 'A pending invite already exists for this user' });
    }

    const invite = await TeamInvite.create({
      team: team._id,
      invitedUser: invitedUser._id,
      invitedBy: req.user.id,
    });

    // A leader sees the invitee's email only if they typed it themselves
    const showEmail = req.user.role === 'admin' || found.byEmail;
    const populated = await TeamInvite.findById(invite._id)
      .populate('team', 'name description')
      .populate('invitedUser', showEmail ? 'name email profileImage department' : 'name profileImage department')
      .populate('invitedBy', 'name email');

    await notify(req, invitedUser._id, {
      type: 'team_invite',
      title: `${req.user.name} invited you to join ${team.name}`,
      body: 'Accept or decline the invite on the Team page. It expires in 7 days.',
      link: '/teams',
      data: { teamId: String(team._id), inviteId: String(invite._id) },
      email: true,
    });
    await logAuditEventV2(req, {
      action: 'team_invite_sent',
      targetType: 'TeamInvite',
      targetId: invite._id,
      details: { teamId: String(team._id), invitedUserId: String(invitedUser._id) },
    });

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    People a leader can invite: active users in no team, by name or exact email
// @route   GET /api/v2/teams/:teamId/invite-candidates?q=
// @access  Private (Admin, or a leader of this team while it is active)
export const getInviteCandidates = async (req, res) => {
  try {
    const team = await findTeamToManage(req, res, 'search for people to invite');
    if (!team) return;

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2) {
      return res.status(400).json({ success: false, message: 'Type at least 2 characters to search' });
    }
    if (q.length > MAX_SEARCH_LENGTH) {
      return res.status(400).json({ success: false, message: `The search can be at most ${MAX_SEARCH_LENGTH} characters` });
    }

    const isAdmin = req.user.role === 'admin';
    const exactEmail = q.toLowerCase();
    const blocked = isAdmin ? [] : await blockedUserIds(req.user._id);
    // A few extra, for anyone dropped below
    const found = await User.find({
      role: 'user',
      teamId: null,
      isActive: true,
      deletedAt: null,
      _id: { $nin: blocked },
      $or: [{ name: { $regex: escapeRegex(q), $options: 'i' } }, { email: exactEmail }],
    })
      .select('name email department profileImage')
      .sort({ name: 1 })
      .limit(MAX_CANDIDATES * 2);

    // In case someone's teamId fell out of step with a team's lists
    const ids = found.map((user) => user._id);
    const inTeams = new Set((await Team.find({ $or: [{ leaders: { $in: ids } }, { members: { $in: ids } }] })
      .select('leaders members')).flatMap(teamUserIds));
    const invited = new Set((await TeamInvite.distinct('invitedUser', {
      team: team._id, invitedUser: { $in: ids }, status: 'pending', expiresAt: { $gt: new Date() },
    })).map(String));

    const data = found
      .filter((user) => !inTeams.has(String(user._id)))
      .slice(0, MAX_CANDIDATES)
      .map((user) => ({
        _id: user._id,
        name: user.name,
        department: user.department,
        profileImage: user.profileImage,
        // Only someone who already knows the address sees it
        ...(isAdmin || user.email === exactEmail ? { email: user.email } : {}),
        invitePending: invited.has(String(user._id)),
      }));

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    The invites a team has sent: open ones, and those declined,
//          withdrawn or expired in the last 30 days
// @route   GET /api/v2/teams/:teamId/invites
// @access  Private (Admin or a leader of this team, frozen or not)
export const getTeamInvites = async (req, res) => {
  try {
    const team = await Team.findById(req.params.teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && !isTeamLeader(team, req.user.id)) {
      return res.status(403).json({ success: false, message: "Only the team's leaders can see its invites" });
    }

    const now = new Date();
    const since = new Date(now.getTime() - INVITE_HISTORY_DAYS * DAY_MS);
    const invites = await TeamInvite.find({
      team: team._id,
      $or: [
        // Waiting for an answer, or expired within the period
        { status: 'pending', expiresAt: { $gt: since } },
        {
          status: { $in: ['declined', 'withdrawn'] },
          $or: [{ respondedAt: { $gte: since } }, { respondedAt: null, updatedAt: { $gte: since } }],
        },
      ],
    })
      .populate('invitedUser', isAdmin ? 'name email profileImage department isActive' : 'name profileImage department isActive')
      .populate('invitedBy', 'name')
      .populate('withdrawnBy', 'name')
      .sort({ createdAt: -1 });

    const data = invites.map((invite) => ({ ...invite.toObject(), state: inviteState(invite, now) }));
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Withdraw a pending invite
// @route   DELETE /api/v2/teams/:teamId/invites/:inviteId
// @access  Private (Admin, or a leader of this team while it is active)
export const withdrawInvite = async (req, res) => {
  try {
    const team = await findTeamToManage(req, res, 'withdraw invites');
    if (!team) return;

    const now = new Date();
    const invite = await TeamInvite.findOneAndUpdate(
      { _id: req.params.inviteId, team: team._id, status: 'pending', expiresAt: { $gt: now } },
      { $set: { status: 'withdrawn', respondedAt: now, withdrawnBy: req.user._id } },
      { new: true }
    );
    if (!invite) {
      const current = await TeamInvite.findOne({ _id: req.params.inviteId, team: team._id });
      if (!current) return res.status(404).json({ success: false, message: 'Invite not found' });
      const state = inviteState(current, now);
      return res.status(409).json({
        success: false,
        message: state === 'expired' ? 'This invite has already expired' : `This invite was already ${state}`,
      });
    }

    await logAuditEventV2(req, {
      action: 'team_invite_withdrawn',
      targetType: 'TeamInvite',
      targetId: invite._id,
      details: { teamId: String(team._id), invitedUserId: String(invite.invitedUser) },
    });

    res.json({ success: true, message: 'Invite withdrawn', data: { ...invite.toObject(), state: 'withdrawn' } });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Accept team invite
// @route   PUT /api/v2/teams/invites/:inviteId/accept
// @access  Private (the invited user)
export const acceptInvite = async (req, res) => {
  try {
    const invite = await TeamInvite.findById(req.params.inviteId).populate('team');

    if (!invite) return res.status(404).json({ success: false, message: 'Invite not found' });

    if (invite.invitedUser.toString() !== req.user.id.toString()) {
      return res.status(403).json({ success: false, message: 'This invite is not for you' });
    }

    if (inviteState(invite) !== 'pending') {
      return res.status(400).json({ success: false, message: closedInviteMessage(invite) });
    }

    const team = invite.team;
    if (!team) {
      return res.status(400).json({ success: false, message: TEAM_GONE_MESSAGE });
    }
    if (!team.isActive) {
      return res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE });
    }

    // Things may have changed since the invite was sent
    const problem = await joinProblem(req.user);
    if (problem) return res.status(400).json({ success: false, message: problem });

    // Three steps, each only if nothing changed since the checks above, and
    // undone if a later one can't go ahead: so two invites accepted at the
    // same moment never put someone in two teams.
    // 1. The invite, while it is still pending
    const now = new Date();
    const claimed = await TeamInvite.findOneAndUpdate(
      { _id: invite._id, status: 'pending', expiresAt: { $gt: now } },
      { $set: { status: 'accepted', respondedAt: now } }
    );
    if (!claimed) {
      const current = await TeamInvite.findById(invite._id);
      return res.status(400).json({ success: false, message: current ? closedInviteMessage(current, now) : 'Invite not found' });
    }

    // 2. The user, while their team is still what was checked above (none:
    //    a teamId left over from old data that no team lists doesn't count)
    const before = await User.findOneAndUpdate(
      {
        _id: req.user._id,
        teamId: req.user.teamId ?? null,
        isActive: true,
        deletedAt: null,
        role: { $nin: ['admin', 'team_leader'] },
      },
      { $set: { teamId: team._id, role: 'team_member' } }
    );
    if (!before) {
      await reopenInvite(invite._id);
      return res.status(400).json({ success: false, message: ALREADY_IN_A_TEAM_MESSAGE });
    }

    // 3. The team, while it exists and isn't frozen
    const joined = await Team.findOneAndUpdate(
      { _id: team._id, isActive: true },
      { $addToSet: { members: req.user._id } },
      { new: true }
    );
    if (!joined) {
      await User.updateOne({ _id: req.user._id, teamId: team._id }, { $set: { teamId: before.teamId ?? null, role: before.role } });
      await reopenInvite(invite._id);
      const stillThere = await Team.exists({ _id: team._id });
      return res.status(400).json({ success: false, message: stillThere ? FROZEN_TEAM_MESSAGE : TEAM_GONE_MESSAGE });
    }

    await notify(req, joined.leaders, {
      type: 'team_invite_accepted',
      title: `${req.user.name} joined ${joined.name}`,
      body: `${req.user.name} accepted the invite and is now a member of the team.`,
      link: '/teams',
      data: { teamId: String(team._id), inviteId: String(invite._id), userId: String(req.user._id) },
    });
    await logAuditEventV2(req, {
      action: 'team_invite_accepted',
      targetType: 'TeamInvite',
      targetId: invite._id,
      details: { teamId: String(team._id) },
    });

    res.json({ success: true, message: 'Invite accepted. You are now part of the team.' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Decline team invite
// @route   PUT /api/v2/teams/invites/:inviteId/decline
// @access  Private (the invited user)
export const declineInvite = async (req, res) => {
  try {
    const invite = await TeamInvite.findById(req.params.inviteId);

    if (!invite) return res.status(404).json({ success: false, message: 'Invite not found' });

    if (invite.invitedUser.toString() !== req.user.id.toString()) {
      return res.status(403).json({ success: false, message: 'This invite is not for you' });
    }

    // An expired invite can still be declined, to clear it away
    const declined = await TeamInvite.findOneAndUpdate(
      { _id: invite._id, status: 'pending' },
      { $set: { status: 'declined', respondedAt: new Date() } },
      { new: true }
    );
    if (!declined) {
      const current = await TeamInvite.findById(invite._id);
      return res.status(400).json({ success: false, message: `Invite is already ${current?.status || invite.status}` });
    }

    const team = await Team.findById(invite.team).select('name leaders');
    if (team) {
      await notify(req, team.leaders, {
        type: 'team_invite_declined',
        title: `${req.user.name} declined the invite to ${team.name}`,
        link: '/teams',
        data: { teamId: String(team._id), inviteId: String(invite._id), userId: String(req.user._id) },
      });
    }

    res.json({ success: true, message: 'Invite declined' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get my pending invites
// @route   GET /api/v2/teams/invites/my
// @access  Private
export const getMyInvites = async (req, res) => {
  try {
    const invites = await TeamInvite.find({ invitedUser: req.user.id, status: 'pending', expiresAt: { $gt: new Date() } })
      .populate('team', 'name description isActive')
      .populate('invitedBy', 'name email profileImage')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: invites.length, data: invites });
  } catch (error) {
    sendServerError(res, error);
  }
};

// ─── Members Management ───────────────────────────────────────────────────────

// @desc    Leave a team
// @route   POST /api/v2/teams/:teamId/leave
// @access  Private (a member, or a leader while another active leader stays).
//          Allowed while the team is frozen, so its people can move on.
export const leaveTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const userId = req.user._id;
    const isLeader = isTeamLeader(team, userId);
    if (!isLeader && !team.members.some((member) => member.equals(userId))) {
      return res.status(404).json({ success: false, message: 'You are not in this team' });
    }

    let updated;
    if (isLeader) {
      // Someone who can still sign in has to keep leading the team. The
      // update checks they are still there, so two leaders leaving at once
      // can't leave it with nobody.
      const others = await User.distinct('_id', {
        _id: { $in: team.leaders.filter((leader) => !leader.equals(userId)) },
        isActive: true,
        deletedAt: null,
      });
      if (others.length > 0) {
        updated = await Team.findOneAndUpdate(
          { _id: team._id, $and: [{ leaders: userId }, { leaders: { $in: others } }] },
          { $pull: { leaders: userId, members: userId } },
          { new: true }
        );
      }
      if (!updated) {
        return res.status(409).json({ success: false, message: ONLY_LEADER_LEAVING_MESSAGE });
      }
    } else {
      updated = await Team.findOneAndUpdate(
        { _id: team._id, members: userId },
        { $pull: { members: userId } },
        { new: true }
      );
      if (!updated) return res.status(404).json({ success: false, message: 'You are not in this team' });
    }

    await releaseFromTeam(userId, team._id);

    await notify(req, updated.leaders, {
      type: 'team_member_left',
      title: `${req.user.name} left ${team.name}`,
      body: isLeader
        ? `${req.user.name} is no longer one of the team's leaders.`
        : `${req.user.name} is no longer in the team. Their unfinished team tasks no longer list them.`,
      link: '/teams',
      data: { teamId: String(team._id), userId: String(userId) },
    });
    await logAuditEventV2(req, {
      action: 'team_member_left',
      targetType: 'Team',
      targetId: team._id,
      details: { userId: String(userId), wasLeader: isLeader },
    });

    res.json({ success: true, message: `You have left ${team.name}.` });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Remove a member from the team
// @route   DELETE /api/v2/teams/:teamId/members/:userId
// @access  Private (Admin or team leader)
export const removeMember = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      if (!isTeamLeader(team, req.user.id)) {
        return res.status(403).json({ success: false, message: 'Only team leaders can remove members' });
      }
      if (!team.isActive) {
        return res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE });
      }
    }

    // Only people in this team can be removed from it
    const userId = String(req.params.userId).toLowerCase();
    if (!mongoose.isObjectIdOrHexString(userId) || !teamUserIds(team).includes(userId)) {
      return res.status(404).json({ success: false, message: 'User is not in this team' });
    }

    const isLeaderTarget = isTeamLeader(team, userId);
    // Leaders can only be removed by admin
    if (isLeaderTarget && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Only admin can remove a team leader' });
    }

    // A leader only while another leader stays, and a leader's removal only
    // while the team is still active, both checked by the update itself
    const updated = await Team.findOneAndUpdate(
      isLeaderTarget
        ? { _id: team._id, leaders: userId, 'leaders.1': { $exists: true } }
        : { _id: team._id, members: userId, ...(isAdmin ? {} : { isActive: true }) },
      { $pull: { leaders: userId, members: userId } },
      { new: true }
    );
    if (!updated) {
      return isLeaderTarget
        ? res.status(400).json({ success: false, message: LAST_LEADER_MESSAGE })
        : res.status(404).json({ success: false, message: 'User is not in this team' });
    }

    await releaseFromTeam(userId, team._id);

    await notify(req, userId, {
      type: 'team_removed',
      title: `You were removed from ${team.name}`,
      body: `${req.user.name} took you out of the team. Your finished work stays on record.`,
      link: '/teams',
      data: { teamId: String(team._id) },
      email: false,
    });
    await logAuditEventV2(req, {
      action: isLeaderTarget ? 'team_leader_removed' : 'team_member_removed',
      targetType: 'Team',
      targetId: team._id,
      details: { userId },
    });

    res.json({ success: true, data: await loadTeam(team._id) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Add an extra leader to team
// @route   POST /api/v2/teams/:teamId/leaders
// @access  Private (Admin)
export const addLeader = async (req, res) => {
  try {
    const { userId } = req.body;
    const team = await Team.findById(req.params.teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
    if (!team.isActive) return res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE });

    const user = userId ? await User.findOne({ _id: userId, deletedAt: null }) : null;
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // A member of this team may be promoted; anyone in another team may not
    const problem = await leaderProblem(user, team._id);
    if (problem) return res.status(400).json({ success: false, message: problem });

    // Already a leader: nothing changes but their role, should it be out of step
    if (isTeamLeader(team, user._id)) {
      await User.updateOne(
        { _id: user._id, role: { $ne: 'admin' }, teamId: user.teamId ?? null },
        { $set: { role: 'team_leader', teamId: team._id } }
      );
      return res.json({ success: true, data: await loadTeam(team._id) });
    }

    // As when accepting an invite: the user first, only while their team is
    // still what was checked above (so they can't join another one at the
    // same moment), then the team, only while it is active; the user is put
    // back if the team step can't go ahead
    const before = await User.findOneAndUpdate(
      { _id: user._id, isActive: true, deletedAt: null, role: { $ne: 'admin' }, teamId: user.teamId ?? null },
      { $set: { role: 'team_leader', teamId: team._id } }
    );
    if (!before) {
      return res.status(400).json({ success: false, message: 'This user already belongs to another team' });
    }
    const updated = await Team.findOneAndUpdate(
      { _id: team._id, isActive: true },
      { $addToSet: { leaders: user._id }, $pull: { members: user._id } },
      { new: true }
    );
    if (!updated) {
      await User.updateOne(
        { _id: user._id, teamId: team._id, role: 'team_leader' },
        { $set: { role: before.role, teamId: before.teamId } }
      );
      const stillThere = await Team.exists({ _id: team._id });
      return stillThere
        ? res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE })
        : res.status(404).json({ success: false, message: 'Team not found' });
    }

    await notify(req, user._id, {
      type: 'team_leader_added',
      title: `${req.user.name} made you a leader of ${team.name}`,
      body: "You can now invite people, give the team tasks and review your teammates' work.",
      link: '/teams',
      data: { teamId: String(team._id) },
    });
    await logAuditEventV2(req, {
      action: 'team_leader_added',
      targetType: 'Team',
      targetId: team._id,
      details: { userId: String(user._id), wasMember: idText(before.teamId) === String(team._id) },
    });

    res.json({ success: true, data: await loadTeam(team._id) });
  } catch (error) {
    sendServerError(res, error);
  }
};
