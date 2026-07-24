import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATCH_WORKFLOW_CONCURRENCY,
  composeJobsForPersistence,
  mergeComposeQueue,
  reserveComposeJobs,
} from '../frontend/src/lib/batchQueue.ts';

const job = (teamId) => ({ teamId, restart: true, patchFrames: [] });

test('the batch scheduler starts no more than two teams', () => {
  const queue = [job(1), job(2), job(3), job(4)];
  const first = reserveComposeJobs(queue, 0);

  assert.equal(BATCH_WORKFLOW_CONCURRENCY, 2);
  assert.deepEqual(first.starting.map(({ teamId }) => teamId), [1, 2]);
  assert.deepEqual(first.remaining.map(({ teamId }) => teamId), [3, 4]);

  const whileOneIsActive = reserveComposeJobs(first.remaining, 1);
  assert.deepEqual(whileOneIsActive.starting.map(({ teamId }) => teamId), [3]);
  assert.deepEqual(whileOneIsActive.remaining.map(({ teamId }) => teamId), [4]);
});

test('the batch scheduler ignores queued and active duplicate teams', () => {
  const merged = mergeComposeQueue(
    [job(1)],
    [job(1), job(2), job(3)],
    [2],
  );

  assert.deepEqual(merged.map(({ teamId }) => teamId), [1, 3]);
});

test('reserved jobs survive reload until the backend confirms their start', () => {
  const persisted = composeJobsForPersistence(
    [job(3)],
    [{ ...job(1), patchFrames: [4, 7] }, job(2)],
  );

  assert.deepEqual(
    persisted.map(({ teamId, restart }) => ({ teamId, restart })),
    [
      { teamId: 1, restart: true },
      { teamId: 2, restart: true },
      { teamId: 3, restart: true },
    ],
  );
  assert.deepEqual(persisted[0].patchFrames, [4, 7]);
});
