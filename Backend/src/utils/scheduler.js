// Background jobs (publishing queued posts, task reminders, attendance
// upkeep) run on timers inside this process: one instance only, like the
// rate limits. Each module registers its jobs in src/jobs/.
//
// DISABLE_SCHEDULER=true switches the timers off (the tests do). An admin can
// still run any job by hand with POST /api/v2/admin/jobs/:name/run.

const jobs = new Map();

// `run(now)` does one pass and returns a summary of what it did (shown to an
// admin who runs it by hand). It must be safe to run at any time and more
// than once: a pass that finds nothing to do does nothing.
export const registerJob = (name, everyMs, run) => {
  jobs.set(name, { name, everyMs, run, running: false, lastRunAt: null, lastResult: null, lastError: null });
};

// Runs a job now. Returns null for an unknown job, and { skipped: true } if a
// pass is already running.
export const runJob = async (name, now = new Date()) => {
  const job = jobs.get(name);
  if (!job) return null;
  if (job.running) return { skipped: true, reason: 'already running' };

  job.running = true;
  try {
    const result = (await job.run(now)) ?? {};
    job.lastResult = result;
    job.lastError = null;
    return result;
  } catch (error) {
    job.lastError = error.message;
    throw error;
  } finally {
    job.running = false;
    job.lastRunAt = new Date();
  }
};

export const listJobs = () =>
  [...jobs.values()].map(({ name, everyMs, running, lastRunAt, lastResult, lastError }) => ({
    name,
    everyMinutes: everyMs / 60000,
    running,
    lastRunAt,
    lastResult,
    lastError,
  }));

export const startScheduler = () => {
  if (process.env.DISABLE_SCHEDULER === 'true') {
    console.log('Background jobs are off (DISABLE_SCHEDULER=true)');
    return;
  }
  for (const job of jobs.values()) {
    setInterval(() => {
      runJob(job.name).catch((error) => console.error(`Job ${job.name} failed:`, error.message));
    }, job.everyMs).unref();
  }
};
