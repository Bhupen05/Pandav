// Background jobs for the task module, registered with utils/scheduler.js
// (see jobs/index.js). Each job's run(now) must be safe to repeat.
import Task, { OPEN_TASK_STATUSES, dayStart, dueDayOf } from '../models/Task.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import { toDayKey } from '../utils/dates.js';
import { notify } from '../utils/notify.js';
import { registerJob } from '../utils/scheduler.js';
import { activeTeamLeaders, idOf, notifyAssigned, shiftDate, short, taskLink } from '../utils/tasks.js';
import { teamUserIds } from '../utils/teams.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// A task that was already this many days overdue when the job first saw it
// (an old task, after an upgrade) is marked without a reminder, so the first
// run doesn't send one for every old task at once
const STALE_OVERDUE_DAYS = 7;

// 'task-reminders': once per due date, tells the assignees when an open task
// is due today or tomorrow, and the assignees and the team's leaders when its
// due day has passed. "Today" is the day in APP_TIMEZONE; a task's due day is
// the date of its due date.
export const sendTaskReminders = async (now) => {
  const today = toDayKey(now);
  const todayStart = dayStart(today);
  const result = { dueSoon: 0, overdue: 0, markedWithoutReminder: 0 };

  const dueSoon = await Task.find({
    status: { $in: OPEN_TASK_STATUSES },
    dueDate: { $gte: todayStart, $lt: new Date(todayStart.getTime() + 2 * DAY_MS) },
    'reminders.dueSoonAt': null,
  }).select('title assignedTo dueDate');
  for (const task of dueSoon) {
    // Claimed first, so a pass running at the same time sends nothing more
    const claimed = await Task.updateOne(
      { _id: task._id, dueDate: task.dueDate, 'reminders.dueSoonAt': null },
      { $set: { 'reminders.dueSoonAt': now } }
    );
    if (claimed.modifiedCount === 0) continue;

    const when = dueDayOf(task.dueDate) === today ? 'today' : 'tomorrow';
    await notify(null, task.assignedTo, {
      type: 'task_due_soon',
      title: `Due ${when}: ${short(task.title)}`,
      body: `"${short(task.title)}" is due ${when} (${dueDayOf(task.dueDate)}).`,
      link: taskLink(task),
      data: { taskId: String(task._id) },
    });
    result.dueSoon += 1;
  }

  const overdue = await Task.find({
    status: { $in: OPEN_TASK_STATUSES },
    dueDate: { $lt: todayStart },
    'reminders.overdueAt': null,
  }).select('title assignedTo dueDate team');
  const staleBefore = new Date(todayStart.getTime() - STALE_OVERDUE_DAYS * DAY_MS);
  for (const task of overdue) {
    const claimed = await Task.updateOne(
      { _id: task._id, dueDate: task.dueDate, 'reminders.overdueAt': null },
      { $set: { 'reminders.overdueAt': now } }
    );
    if (claimed.modifiedCount === 0) continue;
    if (task.dueDate < staleBefore) {
      result.markedWithoutReminder += 1;
      continue;
    }

    await notify(null, [...task.assignedTo.map(idOf), ...(await activeTeamLeaders(task))], {
      type: 'task_overdue',
      title: `Overdue: ${short(task.title)}`,
      body: `"${short(task.title)}" was due on ${dueDayOf(task.dueDate)} and isn't finished yet.`,
      link: taskLink(task),
      data: { taskId: String(task._id) },
    });
    result.overdue += 1;
  }

  return result;
};

// 'task-recurrence': creates the next task of each repeating series whose
// time has come. The task that schedules it hands the schedule on to the new
// task. Occurrences missed (while the server was down, or the team frozen)
// are skipped: the new task is the latest one due by now.
export const createNextOccurrences = async (now) => {
  const result = { created: 0, waiting: 0, ended: 0, failed: 0 };
  const due = await Task.find({ 'recurrence.nextOccurrenceAt': { $ne: null, $lte: now } }).select('-history');

  for (const task of due) {
    const { recurrence } = task;
    let team = null;
    if (task.team) {
      team = await Team.findById(task.team).select('leaders members isActive');
      // A frozen team takes no new work; the series waits until it is unfrozen
      if (team && !team.isActive) {
        result.waiting += 1;
        continue;
      }
    }

    // Claimed first, so a pass running at the same time can't create it twice
    const base = recurrence.nextOccurrenceAt;
    const claimed = await Task.findOneAndUpdate(
      { _id: task._id, 'recurrence.nextOccurrenceAt': base },
      { $set: { 'recurrence.nextOccurrenceAt': null } }
    ).select('_id');
    if (!claimed) continue;

    // The latest occurrence due by now, and not after the series' end
    const inRange = (date) => date <= now && (!recurrence.until || date <= recurrence.until);
    let count = 0;
    while (inRange(shiftDate(base, recurrence, count + 1)) && count < 10000) count += 1;
    const start = shiftDate(base, recurrence, count);
    const following = shiftDate(base, recurrence, count + 1);
    if (recurrence.until && start > recurrence.until) {
      result.ended += 1;
      continue;
    }

    // The people still able to take it: active, and still in the team
    const people = team ? teamUserIds(team) : null;
    const active = new Set((await User.find({ _id: { $in: task.assignedTo }, isActive: true, deletedAt: null }).distinct('_id')).map(String));
    const assignees = task.assignedTo.map(idOf).filter((id) => active.has(id) && (!people || people.includes(id)));
    if (assignees.length === 0) {
      await Task.addHistory(task._id, null, 'recurrence_stopped', { reason: 'Nobody on the task can take the next one' });
      result.ended += 1;
      continue;
    }

    const next = new Task({
      title: task.title,
      description: task.description,
      priority: task.priority,
      tags: task.tags,
      notes: task.notes,
      estimatedDays: task.estimatedDays,
      team: team ? task.team : null,
      createdBy: task.createdBy,
      assignedTo: assignees,
      startDate: start,
      dueDate: new Date(start.getTime() + (task.dueDate - task.startDate)),
      checklist: task.checklist.map((item) => ({ text: item.text })),
      recurrence: {
        frequency: recurrence.frequency,
        interval: recurrence.interval,
        until: recurrence.until,
        seriesId: recurrence.seriesId || task._id,
        nextOccurrenceAt: recurrence.until && following > recurrence.until ? null : following,
      },
    });
    next.logHistory(null, 'created', { repeatOf: String(task._id) });
    try {
      await next.save();
    } catch (error) {
      console.error(`Repeating task ${task._id} could not create its next occurrence:`, error.message);
      result.failed += 1;
      continue;
    }

    await notifyAssigned(null, next, assignees);
    result.created += 1;
  }

  return result;
};

registerJob('task-reminders', 15 * 60 * 1000, sendTaskReminders);
registerJob('task-recurrence', 30 * 60 * 1000, createNextOccurrences);
