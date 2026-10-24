import Team from '../models/Team.js';

const idOf = (ref) => String(ref?._id ?? ref);

// What leaders and members of a frozen (inactive) team are told when they try
// to change something. Admins can still act on the team.
export const FROZEN_TEAM_MESSAGE = 'This team is frozen. An admin has to unfreeze it before anything can change.';

// Everyone in a team, leaders included
export const teamUserIds = (team) => [...team.leaders, ...team.members].map(idOf);

// Whether the user is a leader of this team
export const isTeamLeader = (team, userId) => team.leaders.some((leader) => idOf(leader) === idOf(userId));

// Whether the user leads or is a member of any team, other than `exceptTeamId`.
// Each user belongs to at most one team (User.teamId).
export const isInAnyTeam = async (userId, exceptTeamId = null) =>
  Boolean(await Team.exists({
    ...(exceptTeamId ? { _id: { $ne: exceptTeamId } } : {}),
    $or: [{ leaders: userId }, { members: userId }],
  }));

// Ids of everyone in the teams this user leads (including the user). With
// `activeOnly`, frozen teams are left out: their leaders can still look at
// the team's history but can't act on it.
export const ledUserIds = async (userId, { activeOnly = false } = {}) => {
  const teams = await Team.find({ leaders: userId, ...(activeOnly ? { isActive: true } : {}) }).select('leaders members');
  return [...new Set(teams.flatMap(teamUserIds))];
};

// Ids of the teams this user leads. With `activeOnly`, frozen teams are left out.
export const ledTeamIds = async (userId, { activeOnly = false } = {}) =>
  (await Team.find({ leaders: userId, ...(activeOnly ? { isActive: true } : {}) }).distinct('_id')).map(String);

// Whether a reviewer may change a record that belongs to a team (a task's or
// an attendance record's `team`): admins always; a team leader only for a
// team they lead that isn't frozen. A record that belongs to no team, or to a
// team the person was in before, is for admins only, so moving someone into a
// team doesn't hand their history to its leader.
export const leadsRecordTeam = async (reviewer, teamId) => {
  if (reviewer.role === 'admin') return true;
  if (reviewer.role !== 'team_leader' || !teamId) return false;
  return Boolean(await Team.exists({ _id: idOf(teamId), leaders: idOf(reviewer), isActive: true }));
};

// Whether two users are in the same team, and that team isn't frozen
export const areTeammates = async (userId, otherId) =>
  Boolean(await Team.exists({
    isActive: true,
    $and: [
      { $or: [{ leaders: userId }, { members: userId }] },
      { $or: [{ leaders: otherId }, { members: otherId }] },
    ],
  }));

// Whether a reviewer may act on other users' attendance, tasks or posts.
// Admins can act on anyone; team leaders on the people in the teams they
// lead, as long as the team isn't frozen, but never on themselves, so their
// own requests still go to someone else.
export const canReviewFor = async (reviewer, userIds) => {
  if (reviewer.role === 'admin') return true;
  if (reviewer.role !== 'team_leader') return false;

  const ids = userIds.map(idOf);
  if (ids.length === 0 || ids.includes(idOf(reviewer))) return false;

  const led = await ledUserIds(reviewer.id ?? idOf(reviewer), { activeOnly: true });
  return ids.every((id) => led.includes(id));
};

// Loads the team in req.params.teamId for a leader's action, or sends why the
// caller can't take it and returns null. Admins act on any team, frozen or
// not, so a frozen team's waiting reviews go to them; leaders act only on
// their own team while it is active.
export const findTeamToManage = async (req, res, action) => {
  const team = await Team.findById(req.params.teamId);
  if (!team) {
    res.status(404).json({ success: false, message: 'Team not found' });
    return null;
  }
  if (req.user.role !== 'admin') {
    if (!isTeamLeader(team, req.user.id)) {
      res.status(403).json({ success: false, message: `Only team leaders can ${action}` });
      return null;
    }
    if (!team.isActive) {
      res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE });
      return null;
    }
  }
  return team;
};
