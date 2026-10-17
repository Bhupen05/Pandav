import Team from '../models/Team.js';

const idOf = (ref) => String(ref?._id ?? ref);

// Everyone in a team, leaders included
export const teamUserIds = (team) => [...team.leaders, ...team.members].map(idOf);

// Whether the user is a leader of this team
export const isTeamLeader = (team, userId) => team.leaders.some((leader) => idOf(leader) === idOf(userId));

// Ids of everyone in the teams this user leads (including the user)
export const ledUserIds = async (userId) => {
  const teams = await Team.find({ leaders: userId }).select('leaders members');
  return [...new Set(teams.flatMap(teamUserIds))];
};

// Whether a reviewer may act on another user's attendance or task. Admins can
// act on anyone; team leaders on the people in their teams but never on
// themselves, so their own requests still go to someone else.
export const canReviewFor = async (reviewer, userIds) => {
  if (reviewer.role === 'admin') return true;
  if (reviewer.role !== 'team_leader') return false;

  const ids = userIds.map(idOf);
  if (ids.length === 0 || ids.includes(idOf(reviewer))) return false;

  const led = await ledUserIds(reviewer.id);
  return ids.every((id) => led.includes(id));
};
