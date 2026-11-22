import {
  continueAsNew,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import { MediaActivity } from '@gitroom/orchestrator/activities/media.activity';

const { deleteExpiredMedia } = proxyActivities<MediaActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

// Started with the other infinite workflows when MEDIA_RETENTION_DAYS is set:
// every hour, removes from storage the media of the posts published more than
// MEDIA_RETENTION_DAYS days ago (see MediaService.deleteExpiredMedia). Only ids
// and counters go through the workflow; the page cursor carries over the hours
// so a long library is always swept to the end.
export async function mediaRetentionWorkflow({
  lastId,
}: { lastId?: string } = {}) {
  let loops = 0;
  while (true) {
    for (let page = 0; page < 20; page++) {
      const result = await deleteExpiredMedia(lastId);
      lastId = result.lastId;
      if (!lastId) {
        break;
      }
    }

    await sleep('1 hour');

    // Keep the history small
    if (++loops >= 24 || workflowInfo().historyLength > 1000) {
      return await continueAsNew<typeof mediaRetentionWorkflow>({ lastId });
    }
  }
}
