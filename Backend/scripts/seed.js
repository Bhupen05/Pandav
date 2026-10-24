// Fills a database on this machine with demo data: an admin, three teams (one
// of them frozen), people outside any team, and their tasks, attendance,
// messages and Social Hub activity. Every account's password is PandavLocal#2026.
//
//   npm run seed -- --uri mongodb://127.0.0.1:27017/pandav_dev
//   npm run seed                      uses MONGODB_URI from the environment or Backend/.env
//
// It deletes everything already in that database first, so it refuses a
// database that isn't on this machine unless given --allow-remote.
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import TeamInvite from '../src/models/TeamInvite.js';
import Task from '../src/models/Task.js';
import Attendance from '../src/models/Attendance.js';
import Chat from '../src/models/Chat.js';
import TeamChatMessage from '../src/models/TeamChatMessage.js';
import Contact from '../src/models/Contact.js';
import PersonalTask from '../src/models/PersonalTaskV2.js';
import SocialPost from '../src/models/SocialPostV2.js';
import NetworkConnection from '../src/models/NetworkConnectionV2.js';
import '../src/models/SocialIntegrationV2.js';
import '../src/models/SocialPublishJobV2.js';
import '../src/models/AuditEventV2.js';
import { toDayKey } from '../src/utils/dates.js';

dotenv.config();

const PASSWORD = 'PandavLocal#2026';
const LOCAL_URI = /^mongodb:\/\/(?:[^@/]*@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/;

const args = process.argv.slice(2);
const uriAt = args.indexOf('--uri');
const uri = uriAt >= 0 ? args[uriAt + 1] : process.env.MONGODB_URI;

if (!uri) {
  console.error('No database: pass --uri mongodb://127.0.0.1:27017/pandav_dev or set MONGODB_URI');
  process.exit(1);
}
if (!LOCAL_URI.test(uri) && !args.includes('--allow-remote')) {
  console.error('Refusing to seed a database that is not on this machine: seeding deletes everything in it.');
  console.error('Pass --uri mongodb://127.0.0.1:27017/pandav_dev, or add --allow-remote if you really mean it.');
  process.exit(1);
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = new Date();
const at = (days, hours = 0) => new Date(now.getTime() + days * DAY + hours * HOUR);
const id = () => new mongoose.Types.ObjectId();

// A wall-clock time ('09:15') on a day ('2026-10-16') in APP_TIMEZONE
const zoneOffset = (date) => {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
    timeZoneName: 'longOffset',
  }).formatToParts(date).find((part) => part.type === 'timeZoneName').value;
  return name === 'GMT' ? '+00:00' : name.slice(3);
};
const onDay = (day, time) => new Date(`${day}T${time}:00${zoneOffset(new Date(`${day}T12:00:00Z`))}`);
const isWeekday = (day) => ![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
const minutes = (time, add) => {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + add;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// People and teams ---------------------------------------------------------

const teams = {
  web: { _id: id(), name: 'Web Platform', description: 'Builds and runs the Pandav web app and API.' },
  mobile: { _id: id(), name: 'Mobile App', description: 'The Android and iOS apps.' },
  design: {
    _id: id(),
    name: 'Design Studio',
    description: 'Brand and product design. Frozen while the team is reorganised.',
    isActive: false,
  },
};

const people = {
  admin: { name: 'Local Admin', role: 'admin', department: 'Management' },
  arjun: { name: 'Arjun Mehta', role: 'team_leader', team: 'web', department: 'Engineering' },
  priya: { name: 'Priya Sharma', role: 'team_member', team: 'web', department: 'Engineering' },
  rohan: { name: 'Rohan Verma', role: 'team_member', team: 'web', department: 'Engineering' },
  sneha: { name: 'Sneha Kulkarni', role: 'team_member', team: 'web', department: 'Engineering' },
  kavya: { name: 'Kavya Nair', role: 'team_leader', team: 'mobile', department: 'Mobile' },
  vikram: { name: 'Vikram Singh', role: 'team_member', team: 'mobile', department: 'Mobile' },
  ananya: { name: 'Ananya Rao', role: 'team_member', team: 'mobile', department: 'Mobile' },
  isha: { name: 'Isha Kapoor', role: 'team_leader', team: 'design', department: 'Design' },
  dev: { name: 'Dev Patel', role: 'team_member', team: 'design', department: 'Design' },
  nikhil: { name: 'Nikhil Joshi', role: 'user', department: 'Marketing' },
  farah: { name: 'Farah Khan', role: 'user', department: 'Operations' },
  rahul: { name: 'Rahul Das', role: 'user', department: 'Sales', isActive: false },
};

Object.entries(people).forEach(([key, person]) => {
  person._id = id();
  person.email = `${key}@pandav.local`;
});

const u = (key) => people[key]._id;
const teamOf = (key) => (people[key].team ? teams[people[key].team]._id : null);
const teamMembers = (team) => Object.keys(people).filter((key) => people[key].team === team);
const leaderOf = (key) => {
  const team = people[key].team;
  const leader = Object.keys(people).find((k) => people[k].team === team && people[k].role === 'team_leader');
  // Frozen teams' approvals go to admins, as do leaders' own
  return team && teams[team].isActive !== false && leader !== key ? leader : 'admin';
};

async function seedPeople() {
  const password = await bcrypt.hash(PASSWORD, 10);
  await User.insertMany(Object.values(people).map((person) => ({
    _id: person._id,
    name: person.name,
    email: person.email,
    password,
    role: person.role,
    teamId: person.team ? teams[person.team]._id : null,
    department: person.department,
    isActive: person.isActive ?? true,
    createdAt: at(-45),
  })));

  const inTeam = (team, role) => Object.keys(people)
    .filter((key) => people[key].team === team && people[key].role === role)
    .map(u);
  await Team.insertMany(Object.entries(teams).map(([key, team]) => ({
    ...team,
    leaders: inTeam(key, 'team_leader'),
    members: inTeam(key, 'team_member'),
    // Anyone may start a team now; Kavya started hers
    createdBy: key === 'mobile' ? u('kavya') : u('admin'),
    createdAt: at(-40),
  })));

  await TeamInvite.insertMany([
    { team: teams.web._id, invitedUser: u('nikhil'), invitedBy: u('arjun'), status: 'pending', createdAt: at(-1) },
    { team: teams.mobile._id, invitedUser: u('farah'), invitedBy: u('kavya'), status: 'declined', createdAt: at(-9) },
  ]);
}

// Tasks ----------------------------------------------------------------------

const task = ({ team, by, to, start, due, ...rest }) => ({
  team: team ? teams[team]._id : null,
  createdBy: u(by),
  assignedTo: to.map(u),
  startDate: at(start),
  dueDate: at(due),
  createdAt: at(start - 1),
  ...rest,
});

const done = (reviewer, daysAgo) => ({
  status: 'completed',
  approvedBy: u(reviewer),
  approvedAt: at(-daysAgo),
  completedDate: at(-daysAgo),
});

const requested = (key, daysAgo) => ({
  status: 'completion-requested',
  completionRequestedBy: u(key),
  completionRequestedAt: at(-daysAgo),
});

async function seedTasks() {
  const tasks = [
    task({
      team: 'web', by: 'arjun', to: ['priya'], start: -20, due: -12, priority: 'high',
      title: 'Move sessions to an HttpOnly cookie',
      description: 'Keep the session token out of page scripts: set it as an HttpOnly cookie through the /api proxy.',
      tags: ['security', 'auth'], ...done('arjun', 13),
    }),
    task({
      team: 'web', by: 'arjun', to: ['rohan'], start: -6, due: 3, priority: 'high', status: 'in-progress',
      title: 'Team chat read receipts',
      description: 'Show who has read each team chat message, with one event per batch instead of one per message.',
      tags: ['chat'],
    }),
    task({
      team: 'web', by: 'arjun', to: ['sneha'], start: -10, due: -1, priority: 'medium',
      title: 'API reference for tasks and attendance',
      description: 'Document every task and attendance endpoint in Backend/Doc, with request and response examples.',
      tags: ['docs'], ...requested('sneha', 1),
    }),
    task({
      team: 'web', by: 'arjun', to: ['priya', 'rohan'], start: -5, due: -1, priority: 'urgent', status: 'in-progress',
      title: 'Fix the overdue badge on the Tasks page',
      description: 'Tasks due today show as overdue for users west of the server timezone.',
      tags: ['bug', 'frontend'],
      assigneeProgress: [
        { user: u('priya'), status: 'completion-requested', completionRequestedAt: at(0, -2) },
        { user: u('rohan'), status: 'in-progress' },
      ],
    }),
    task({
      team: 'web', by: 'arjun', to: ['rohan'], start: -15, due: -8, priority: 'medium',
      title: 'Run browser tests in CI',
      description: 'Add a Playwright job to GitHub Actions that starts the API and the frontend and signs in as each role.',
      tags: ['ci', 'testing'], editedBy: u('arjun'), editedAt: at(-14), ...done('arjun', 8),
    }),
    task({
      team: 'web', by: 'arjun', to: ['sneha'], start: 2, due: 12, priority: 'low', status: 'pending',
      title: 'Page the Users list',
      description: 'Load users 50 at a time; the dropdowns that need everyone keep their own request.',
      tags: ['frontend'],
    }),
    task({
      team: 'web', by: 'admin', to: ['arjun'], start: -3, due: 7, priority: 'medium', status: 'in-progress',
      title: 'Quarterly roadmap for Web Platform',
      description: 'Draft next quarter\'s goals for the team and share them in team chat.',
      tags: ['planning'],
    }),
    task({
      team: 'mobile', by: 'kavya', to: ['vikram'], start: -8, due: 5, priority: 'high', status: 'in-progress',
      title: 'Offline mode for attendance check-in',
      description: 'Queue check-ins while offline and send them when the phone reconnects.',
      tags: ['android', 'ios'],
    }),
    task({
      team: 'mobile', by: 'kavya', to: ['ananya'], start: -9, due: -2, priority: 'medium',
      title: 'Push notification prototype',
      description: 'Notify assignees about new tasks on iOS and Android.',
      tags: ['notifications'], ...requested('ananya', 1),
    }),
    task({
      team: 'mobile', by: 'kavya', to: ['vikram'], start: -4, due: 0.5, priority: 'urgent', status: 'in-progress',
      title: 'Login crash on Android 14',
      description: 'The app closes right after signing in on Android 14 devices.',
      tags: ['bug', 'android'],
      rejectionReason: 'Still crashes on a Pixel 8 after a cold start',
      rejectedBy: u('kavya'),
      rejectedAt: at(-1),
    }),
    task({
      team: 'mobile', by: 'kavya', to: ['ananya'], start: 1, due: 10, priority: 'low', status: 'pending',
      title: 'App store screenshots',
      description: 'Fresh screenshots for both stores, in light and dark mode.',
      tags: ['release'],
    }),
    task({
      team: 'mobile', by: 'kavya', to: ['vikram', 'ananya'], start: -14, due: -7, priority: 'low', status: 'cancelled',
      title: 'Evaluate the React Native upgrade',
      description: 'List what breaks when moving to the latest React Native.',
      notes: 'Postponed to next quarter.',
    }),
    task({
      team: 'design', by: 'isha', to: ['dev'], start: -12, due: 4, priority: 'medium', status: 'in-progress',
      title: 'Brand refresh moodboard',
      description: 'Collect references for the new colours and type.',
      tags: ['brand'],
    }),
    task({
      by: 'admin', to: ['nikhil'], start: 0, due: 6, priority: 'medium', status: 'pending',
      title: 'Update the company profile on the website',
      description: 'New team photos and the updated services list.',
      tags: ['marketing'],
    }),
    task({
      by: 'admin', to: ['farah'], start: -10, due: -4, priority: 'medium',
      title: 'Vendor contracts review',
      description: 'Check renewal dates and notice periods for every vendor.',
      tags: ['operations'], ...done('admin', 4),
    }),
  ];

  // create() rather than insertMany() so each task fills in assigneeProgress
  for (const data of tasks) await Task.create(data);
  return tasks.length;
}

// Attendance -----------------------------------------------------------------

async function seedAttendance() {
  const workers = Object.keys(people).filter((key) => key !== 'admin' && people[key].isActive !== false);

  // The last ten working days, then today if people would have checked in by now
  const days = [];
  for (let back = 1; days.length < 10; back += 1) {
    const day = toDayKey(at(-back));
    if (isWeekday(day)) days.unshift(day);
  }
  const today = toDayKey(now);
  const checkedInToday = isWeekday(today) && onDay(today, '09:45') < now;

  const records = [];
  workers.forEach((key, w) => {
    days.forEach((day, d) => {
      const recent = d >= days.length - 2;
      const base = {
        user: u(key),
        team: teamOf(key),
        date: onDay(day, '00:00'),
        day,
        approvalStatus: recent ? 'pending' : 'approved',
        approvedBy: recent ? undefined : u(leaderOf(key)),
      };

      if (key === 'sneha' && d === days.length - 2) {
        records.push({ ...base, status: 'leave', approvalStatus: 'pending', approvedBy: undefined, remarks: 'Family function' });
        return;
      }

      const late = (w + d) % 9 === 4;
      const halfDay = !late && (w * 3 + d) % 13 === 7;
      const checkIn = late ? '10:20' : minutes('09:00', (w * 7 + d * 3) % 40);
      const checkOut = halfDay ? '13:30' : minutes('18:00', (w + d) % 30);
      records.push({
        ...base,
        status: late ? 'late' : halfDay ? 'half-day' : 'present',
        checkInTime: onDay(day, checkIn),
        checkOutTime: onDay(day, checkOut),
        remarks: late ? 'Traffic' : halfDay ? 'Doctor\'s appointment' : undefined,
      });
    });

    if (checkedInToday && w % 3 !== 2) {
      records.push({
        user: u(key),
        team: teamOf(key),
        date: onDay(today, '00:00'),
        day: today,
        status: 'present',
        approvalStatus: 'pending',
        checkInTime: onDay(today, minutes('09:00', (w * 5) % 40)),
      });
    }
  });

  // create() so each record works out its workHours
  for (const record of records) await Attendance.create(record);
  return records.length;
}

// Messages -------------------------------------------------------------------

// [sender, text, hours ago]; the receiver has read all but the last `unread`
const conversation = (a, b, lines, unread = 0) => lines.map(([from, message, hoursAgo], i) => ({
  sender: u(from),
  receiver: u(from === a ? b : a),
  message,
  timestamp: at(0, -hoursAgo),
  isRead: i < lines.length - unread,
}));

async function seedMessages() {
  const chats = [
    ...conversation('arjun', 'priya', [
      ['priya', 'Cookie sessions are merged. Can you check the logout flow when you get a minute?', 30],
      ['arjun', 'Looks good. Clear the cookie with the same path it was set with, though.', 29],
      ['priya', 'Done, pushed the fix.', 28],
      ['arjun', 'Approved 👍', 27],
      ['priya', 'I have asked for completion on the overdue badge fix.', 2],
    ], 1),
    ...conversation('admin', 'arjun', [
      ['admin', 'How is the roadmap coming along?', 26],
      ['arjun', 'Draft by Thursday. I will share it in team chat as well.', 25],
      ['admin', 'Great, thanks.', 24],
    ]),
    ...conversation('kavya', 'vikram', [
      ['kavya', 'The Android 14 crash is still there on my Pixel 8, so I sent the task back.', 20],
      ['vikram', 'Got it. I can reproduce it after a cold start, looking into it now.', 3],
    ], 1),
    ...conversation('ananya', 'sneha', [
      ['ananya', 'Hi! Do you have API docs for attendance? I am building offline check-in.', 22],
      ['sneha', 'Yes, they are in Backend/Doc. Arjun is reviewing them.', 21],
    ]),
  ];
  await Chat.insertMany(chats);

  // [sender, text, hours ago]; everyone has read the messages older than `unreadAfter` hours
  const teamChat = (team, lines, unreadAfter = 0) => lines.map(([from, message, hoursAgo]) => ({
    team: teams[team]._id,
    sender: u(from),
    message,
    createdAt: at(0, -hoursAgo),
    readBy: teamMembers(team)
      .filter((key) => key === from || hoursAgo > unreadAfter)
      .map((key) => ({ user: u(key), readAt: at(0, -hoursAgo + 0.5) })),
  }));
  const teamMessages = [
    ...teamChat('web', [
      ['arjun', 'Morning all. Sprint review is at 4 pm today.', 50],
      ['priya', 'I will demo cookie sessions.', 49],
      ['rohan', 'Read receipts are nearly done, I will show what I have.', 48],
      ['sneha', 'The API docs for tasks are up for review.', 23],
      ['arjun', 'Thanks Sneha, reviewing them today.', 3],
    ], 4),
    ...teamChat('mobile', [
      ['kavya', 'Reminder: store screenshots are due next week.', 30],
      ['ananya', 'On it after the push notification prototype.', 29],
      ['vikram', 'The Android 14 fix should land tomorrow.', 5],
    ], 6),
    ...teamChat('design', [
      ['isha', 'The moodboard draft is in the shared drive.', 150],
      ['dev', 'Thanks, adding my references this week.', 140],
    ]),
  ];
  for (const message of teamMessages) await TeamChatMessage.create(message);

  await Contact.insertMany([
    {
      name: 'Sanjay Gupta',
      email: 'sanjay@example.com',
      subject: 'Pricing for a 50-person team',
      message: 'Hi, we are an agency of about 50 people. What would Pandav cost us per month?',
      createdAt: at(0, -5),
    },
    {
      name: 'Lakshmi Menon',
      email: 'lakshmi@example.com',
      subject: 'Demo request',
      message: 'Could someone walk us through tasks and attendance next week?',
      status: 'in-progress',
      createdAt: at(-2),
    },
    {
      name: 'Tom Baker',
      email: 'tom@example.com',
      subject: 'Cannot reset my password',
      message: 'The reset email never arrives.',
      status: 'resolved',
      resolvedBy: u('admin'),
      resolvedAt: at(-4),
      createdAt: at(-5),
    },
  ]);

  return { chats: chats.length, teamMessages: teamMessages.length };
}

// Social Hub -----------------------------------------------------------------

const published = (daysAgo) => ({
  pandav: { status: 'published', message: 'Post is available in Pandav feed', publishedAt: at(-daysAgo) },
});

async function seedSocial() {
  await NetworkConnection.insertMany([
    { requester: u('nikhil'), recipient: u('priya'), status: 'accepted', respondedAt: at(-20), createdAt: at(-21) },
    { requester: u('ananya'), recipient: u('sneha'), status: 'accepted', respondedAt: at(-15), createdAt: at(-16) },
    { requester: u('isha'), recipient: u('kavya'), status: 'accepted', respondedAt: at(-30), createdAt: at(-31) },
    { requester: u('nikhil'), recipient: u('farah'), status: 'accepted', respondedAt: at(-10), createdAt: at(-10) },
    { requester: u('farah'), recipient: u('arjun'), status: 'pending', createdAt: at(-1) },
    { requester: u('rohan'), recipient: u('vikram'), status: 'rejected', respondedAt: at(-6), createdAt: at(-7) },
  ]);

  const personal = await PersonalTask.insertMany([
    { user: u('priya'), title: 'Write a blog post on cookie sessions', status: 'in_progress', dueDate: at(5) },
    { user: u('priya'), title: 'Finish the Node.js security course', status: 'todo', priority: 'low' },
    {
      user: u('priya'), title: 'Speak at the frontend meetup', status: 'completed', priority: 'high',
      completedAt: at(-3), autoGenerateLinkedInPost: true, autoPostStatus: 'published',
    },
    { user: u('rohan'), title: 'Learn Socket.io rooms', status: 'completed', completedAt: at(-6) },
    { user: u('rohan'), title: 'Set up a home lab', status: 'todo', priority: 'low' },
    { user: u('vikram'), title: 'List the Android 14 test devices', status: 'in_progress', priority: 'high', dueDate: at(1) },
    { user: u('nikhil'), title: 'Plan the November newsletter', status: 'todo', priority: 'high', dueDate: at(4) },
  ]);

  const comment = (key, text, daysAgo) => ({ user: u(key), text, createdAt: at(-daysAgo), updatedAt: at(-daysAgo) });
  const posts = [
    {
      author: u('priya'),
      sourceTask: personal[2]._id,
      title: 'Spoke at the frontend meetup',
      content: 'Gave my first meetup talk: why session tokens belong in HttpOnly cookies, not localStorage. Slides are on my profile.',
      tags: ['security', 'webdev'],
      likes: ['arjun', 'rohan', 'sneha', 'nikhil'].map(u),
      comments: [comment('arjun', 'Great talk!', 2.9), comment('nikhil', 'Could you do a version for non-engineers some time?', 2.5)],
      publishResults: published(3),
      createdAt: at(-3),
    },
    {
      author: u('arjun'),
      content: 'Sprint review today at 4 pm. Bring your demos!',
      visibility: 'team',
      likes: [u('priya')],
      publishResults: published(2),
      createdAt: at(-2),
    },
    {
      author: u('kavya'),
      title: 'We are hiring',
      content: 'The Mobile App team is looking for a React Native engineer. Message me if you know someone.',
      tags: ['hiring'],
      likes: ['vikram', 'ananya', 'farah'].map(u),
      comments: [comment('isha', 'Shared it with a friend.', 3.5)],
      publishResults: published(4),
      createdAt: at(-4),
    },
    {
      // A member's LinkedIn post waits for their leader
      author: u('vikram'),
      content: 'Offline check-in is coming to the Pandav app: mark attendance with no signal and it syncs when you are back online.',
      tags: ['android', 'ios'],
      targets: { pandav: true, linkedin: true, github: false },
      approvalStatus: 'pending',
      publishResults: published(0.3),
      createdAt: at(0, -7),
    },
    {
      author: u('ananya'),
      content: 'Push notifications finally work on iOS 🎉',
      visibility: 'connections',
      likes: [u('sneha')],
      publishResults: published(1),
      createdAt: at(-1),
    },
    {
      author: u('farah'),
      content: 'All our vendor contracts are in one place now, with renewal reminders. Ask me if you need one.',
      publishResults: published(3.5),
      createdAt: at(-3.5),
    },
    {
      author: u('sneha'),
      title: 'API docs are up',
      content: 'Every tasks and attendance endpoint now has request and response examples in Backend/Doc.',
      tags: ['docs'],
      likes: ['arjun', 'ananya'].map(u),
      comments: [comment('ananya', 'Exactly what I needed, thanks!', 0.8)],
      publishResults: published(1),
      createdAt: at(-1),
    },
    {
      // Something for the admin's Moderation tab
      author: u('nikhil'),
      content: 'LIMITED OFFER!!! Get 10,000 followers today, click the link in my profile!!!',
      moderationStatus: 'flagged',
      moderationReason: 'Reported as spam',
      publishResults: published(0.5),
      createdAt: at(0, -12),
    },
  ];
  const created = [];
  for (const post of posts) created.push(await SocialPost.create(post));

  // Priya's meetup post was shared from her completed personal task
  await PersonalTask.updateOne({ _id: personal[2]._id }, { lastAutoGeneratedPost: created[0]._id });

  return { posts: posts.length, personal: personal.length };
}

// ---------------------------------------------------------------------------

async function main() {
  await mongoose.connect(uri);
  const { name, host } = mongoose.connection;
  console.log(`Seeding ${name} on ${host}`);

  const models = Object.values(mongoose.models);
  await Promise.all(models.map((model) => model.init()));
  await Promise.all(models.map((model) => model.deleteMany({})));

  await seedPeople();
  const tasks = await seedTasks();
  const attendance = await seedAttendance();
  const { chats, teamMessages } = await seedMessages();
  const { posts, personal } = await seedSocial();

  console.log(`\n${Object.keys(people).length} people, ${Object.keys(teams).length} teams, ${tasks} tasks, ` +
    `${attendance} attendance records, ${chats} direct messages, ${teamMessages} team chat messages, ` +
    `${posts} posts, ${personal} personal tasks, 3 contact messages`);
  console.log(`\nEvery account's password: ${PASSWORD}\n`);
  console.table(Object.values(people).map((person) => ({
    email: person.email,
    role: person.role,
    team: person.team
      ? `${teams[person.team].name}${teams[person.team].isActive === false ? ' (frozen)' : ''}`
      : '',
    note: person.isActive === false ? 'deactivated' : '',
  })));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
