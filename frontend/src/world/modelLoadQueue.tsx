import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ModelLoadStats } from './config';

interface QueueRequest {
  key: string;
  teamId: number;
  subscribers: Set<() => void>;
  started: boolean;
}

class ModelLoadQueueController {
  private waiting: QueueRequest[] = [];
  private active = new Map<string, QueueRequest>();
  private outcomes = new Map<string, 'ready' | 'failed'>();
  private selectedTeamId: number | null = null;

  constructor(
    private limit: number,
    private statsRef: RefObject<ModelLoadStats>,
    private onStatsChange: (stats: ModelLoadStats) => void,
  ) {}

  setLimit(limit: number) {
    this.limit = Math.max(1, limit);
    this.pump();
  }

  request(key: string, teamId: number, start: () => void) {
    if (this.outcomes.has(key)) {
      start();
      return () => undefined;
    }

    const existing = this.active.get(key) ?? this.waiting.find((request) => request.key === key);
    const request: QueueRequest = existing ?? {
      key,
      teamId,
      subscribers: new Set(),
      started: false,
    };
    request.subscribers.add(start);
    if (request.started) start();
    else if (!existing) this.waiting.push(request);
    this.pump();

    return () => {
      request.subscribers.delete(start);
      if (!request.started && request.subscribers.size === 0) {
        this.waiting = this.waiting.filter((candidate) => candidate !== request);
      } else if (request.started && request.subscribers.size === 0) {
        queueMicrotask(() => {
          if (request.subscribers.size > 0 || this.active.get(key) !== request) return;
          this.active.delete(key);
          this.pump();
        });
      }
      this.updateStats();
    };
  }

  settle(key: string, outcome: 'ready' | 'failed') {
    this.active.delete(key);
    this.outcomes.set(key, outcome);
    this.pump();
  }

  prioritize(teamId: number | null) {
    this.selectedTeamId = teamId;
    this.pump();
  }

  dispose() {
    this.waiting = [];
    this.active.clear();
    this.updateStats();
  }

  private pump() {
    while (this.active.size < this.limit) {
      let index = this.selectedTeamId === null
        ? -1
        : this.waiting.findIndex((request) => request.subscribers.size > 0 && request.teamId === this.selectedTeamId);
      if (index < 0) index = this.waiting.findIndex((request) => request.subscribers.size > 0);
      if (index < 0) break;

      const [request] = this.waiting.splice(index, 1);
      if (!request || request.subscribers.size === 0) continue;
      request.started = true;
      this.active.set(request.key, request);
      request.subscribers.forEach((subscriber) => subscriber());
    }
    this.updateStats();
  }

  private updateStats() {
    const stats = this.statsRef.current;
    stats.waiting = this.waiting.filter((request) => request.subscribers.size > 0).length;
    stats.active = this.active.size;
    stats.ready = [...this.outcomes.values()].filter((outcome) => outcome === 'ready').length;
    stats.failed = [...this.outcomes.values()].filter((outcome) => outcome === 'failed').length;
    stats.limit = this.limit;
    stats.peakActive = Math.max(stats.peakActive, stats.active);
    this.onStatsChange({ ...stats });
  }
}

const ModelLoadQueueContext = createContext<ModelLoadQueueController | null>(null);

export function ModelLoadQueueProvider({
  limit,
  statsRef,
  onStatsChange,
  children,
}: {
  limit: number;
  statsRef: RefObject<ModelLoadStats>;
  onStatsChange: (stats: ModelLoadStats) => void;
  children: ReactNode;
}) {
  const queue = useMemo(
    () => new ModelLoadQueueController(limit, statsRef, onStatsChange),
    [onStatsChange, statsRef],
  );

  useEffect(() => {
    queue.setLimit(limit);
  }, [limit, queue]);

  useEffect(() => () => queue.dispose(), [queue]);

  return <ModelLoadQueueContext.Provider value={queue}>{children}</ModelLoadQueueContext.Provider>;
}

export function ModelLoadPriority({ selectionRef }: { selectionRef: RefObject<number | null> }) {
  const queue = useContext(ModelLoadQueueContext);
  const previousSelection = useRef<number | null | undefined>(undefined);

  useFrame(() => {
    if (!queue || previousSelection.current === selectionRef.current) return;
    previousSelection.current = selectionRef.current;
    queue.prioritize(selectionRef.current);
  });

  return null;
}

export function useModelLoadPermit(teamId: number, url: string) {
  const queue = useContext(ModelLoadQueueContext);
  const [permitted, setPermitted] = useState(false);
  const settled = useRef(false);
  const key = `${teamId}:${url}`;

  useEffect(() => {
    if (!queue) {
      setPermitted(true);
      return undefined;
    }
    settled.current = false;
    setPermitted(false);
    return queue.request(key, teamId, () => setPermitted(true));
  }, [key, queue, teamId]);

  const markSettled = useCallback((outcome: 'ready' | 'failed') => {
    if (!queue || settled.current) return;
    settled.current = true;
    queue.settle(key, outcome);
  }, [key, queue]);

  return { permitted, markSettled };
}
