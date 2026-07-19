import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { DEFAULT_RETREAT_SETTINGS } from './defaults';
import {
  clearRetreatSettings,
  loadRetreatSettings,
  saveRetreatSettings,
} from './persistence';
import type { RetreatGroup, RetreatSettings } from './types';

interface RetreatContextValue {
  settings: RetreatSettings;
  updateSettings: (updater: (current: RetreatSettings) => RetreatSettings) => void;
  updateGroup: (id: string, patch: Partial<RetreatGroup>) => void;
  importSettings: (next: RetreatSettings) => void;
  resetSettings: () => void;
  saveNow: () => void;
}

const RetreatContext = createContext<RetreatContextValue | null>(null);

function normalizeSettings(candidate: RetreatSettings | null): RetreatSettings {
  if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.groups)) {
    return structuredClone(DEFAULT_RETREAT_SETTINGS);
  }
  const defaults = structuredClone(DEFAULT_RETREAT_SETTINGS);
  const groups = defaults.groups.map((fallback) => ({
    ...fallback,
    ...(candidate.groups.find((group) => group.id === fallback.id) ?? {}),
  }));
  const candidatePlans = Array.isArray(candidate.seatingPlans) ? candidate.seatingPlans : [];
  const seatingPlans = candidatePlans.length > 0
    ? candidatePlans.map((plan, index) => ({
        id: plan.id || `seating-${index + 1}`,
        name: plan.name || `자리표 ${index + 1}`,
        title: plan.title || defaults.groupLayout.title,
        timeLabel: plan.timeLabel || '',
        slotGroupIds: Array.isArray(plan.slotGroupIds) && plan.slotGroupIds.length
          ? plan.slotGroupIds.slice(0, 21)
          : groups.map((group) => group.id),
        active: Boolean(plan.active),
      }))
    : defaults.seatingPlans;
  if (!seatingPlans.some((plan) => plan.active) && seatingPlans[0]) {
    seatingPlans[0] = { ...seatingPlans[0], active: true };
  }

  return {
    ...defaults,
    ...candidate,
    groups,
    seatingPlans,
    groupLayout: { ...defaults.groupLayout, ...candidate.groupLayout },
    notice: {
      ...defaults.notice,
      ...candidate.notice,
      rotation: { ...defaults.notice.rotation, ...candidate.notice?.rotation },
    },
    world: { ...defaults.world, ...candidate.world },
  };
}

export function RetreatProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<RetreatSettings>(() => (
    normalizeSettings(loadRetreatSettings())
  ));

  useEffect(() => {
    const timeout = window.setTimeout(() => saveRetreatSettings(settings), 180);
    return () => window.clearTimeout(timeout);
  }, [settings]);

  useEffect(() => {
    const channel = new BroadcastChannel('peter-retreat-display');
    channel.onmessage = (event: MessageEvent<RetreatSettings>) => {
      if (event.data?.version === 1) setSettings(normalizeSettings(event.data));
    };
    return () => channel.close();
  }, []);

  const updateSettings = useCallback((
    updater: (current: RetreatSettings) => RetreatSettings,
  ) => {
    setSettings((current) => {
      const next = updater(current);
      const channel = new BroadcastChannel('peter-retreat-display');
      channel.postMessage(next);
      channel.close();
      return next;
    });
  }, []);

  const updateGroup = useCallback((id: string, patch: Partial<RetreatGroup>) => {
    updateSettings((current) => ({
      ...current,
      groups: current.groups.map((group) => group.id === id ? { ...group, ...patch } : group),
    }));
  }, [updateSettings]);

  const importSettings = useCallback((next: RetreatSettings) => {
    setSettings(normalizeSettings(next));
  }, []);

  const resetSettings = useCallback(() => {
    clearRetreatSettings();
    setSettings(structuredClone(DEFAULT_RETREAT_SETTINGS));
  }, []);

  const saveNow = useCallback(() => saveRetreatSettings(settings), [settings]);

  const value = useMemo(() => ({
    settings,
    updateSettings,
    updateGroup,
    importSettings,
    resetSettings,
    saveNow,
  }), [importSettings, resetSettings, saveNow, settings, updateGroup, updateSettings]);

  return <RetreatContext.Provider value={value}>{children}</RetreatContext.Provider>;
}

export function useRetreat() {
  const value = useContext(RetreatContext);
  if (!value) throw new Error('useRetreat must be used inside RetreatProvider');
  return value;
}
