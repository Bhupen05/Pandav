// Background jobs for the social module, registered with utils/scheduler.js
// (see jobs/index.js). Each job's run(now) must be safe to repeat.
import { registerJob } from '../utils/scheduler.js';
import { publishDueJobs } from '../utils/socialPublishing.js';

// The publishing queue, every minute: jobs whose run stopped part-way go back
// in the queue (or fail when out of attempts), then up to 20 queued jobs that
// are due are run. A job is claimed before it runs, so a pass never publishes
// anything a request is publishing at the same moment.
registerJob('social-publish', 60 * 1000, async (now) => {
  const { recovered, outcomes } = await publishDueJobs(now, 20);
  return {
    requeued: recovered.requeued,
    failedStuck: recovered.failed,
    processed: outcomes.length,
    published: outcomes.filter((outcome) => outcome.status === 'completed').length,
    retrying: outcomes.filter((outcome) => outcome.status === 'queued').length,
    failed: outcomes.filter((outcome) => outcome.status === 'failed').length,
  };
});
