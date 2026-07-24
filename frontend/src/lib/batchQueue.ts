export const BATCH_WORKFLOW_CONCURRENCY = 2;

export interface ComposeQueueItem {
  teamId: number;
  restart: boolean;
  patchFrames: number[];
}

export function mergeComposeQueue(
  current: ComposeQueueItem[],
  incoming: ComposeQueueItem[],
  activeTeamIds: Iterable<number>,
) {
  const occupied = new Set(activeTeamIds);
  current.forEach((job) => occupied.add(job.teamId));
  const merged = [...current];

  incoming.forEach((job) => {
    if (occupied.has(job.teamId)) return;
    occupied.add(job.teamId);
    merged.push({
      teamId: job.teamId,
      restart: job.restart,
      patchFrames: [...job.patchFrames],
    });
  });

  return merged;
}

export function reserveComposeJobs(
  queue: ComposeQueueItem[],
  activeCount: number,
  concurrency = BATCH_WORKFLOW_CONCURRENCY,
) {
  const availableSlots = Math.max(0, concurrency - activeCount);
  return {
    starting: queue.slice(0, availableSlots),
    remaining: queue.slice(availableSlots),
  };
}

export function composeJobsForPersistence(
  queue: ComposeQueueItem[],
  reserved: ComposeQueueItem[],
) {
  return [...reserved, ...queue];
}
