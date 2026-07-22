import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { apiRequest } from '../lib/api';
import type { Team } from '../types/api';
import { DEFAULT_RETREAT_SETTINGS } from './defaults';
import {
  clearRetreatSettings,
  loadRetreatSettings,
  saveRetreatSettings,
} from './persistence';
import type { RetreatGroup, RetreatSettings } from './types';
import { getEffectiveDisplayMode } from './displayMode';

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
  // Saved settings may predate the current scene set (e.g. 'walk' or 'group-layout').
  const currentPage = candidate.currentPage === 'campfire'
    || candidate.currentPage === 'back'
    || candidate.currentPage === 'seating'
    ? candidate.currentPage
    : 'stand';
  const candidatePlans = Array.isArray(candidate.seatingPlans) ? candidate.seatingPlans : [];
  const seatingPlans = candidatePlans.length > 0
    ? candidatePlans.map((plan, index) => ({
        id: plan.id || `seating-${index + 1}`,
        name: plan.name || `자리표 ${index + 1}`,
        title: plan.title || '자리표',
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
    version: 1,
    currentPage,
    animationPlaying: candidate.animationPlaying ?? defaults.animationPlaying,
    transparentBackground: candidate.transparentBackground ?? defaults.transparentBackground,
    groups,
    seatingPlans,
    world: { ...defaults.world, ...candidate.world },
  };
}

export function RetreatProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<RetreatSettings>(() => (
    normalizeSettings(loadRetreatSettings())
  ));
  const [publishedTeams, setPublishedTeams] = useState<Team[]>([]);

  useEffect(() => {
    const timeout = window.setTimeout(() => saveRetreatSettings(settings), 180);
    return () => window.clearTimeout(timeout);
  }, [settings]);

  useEffect(() => {
    const mode = getEffectiveDisplayMode(settings.transparentBackground);
    const root = document.documentElement;
    root.dataset.obs = mode.obsMode ? 'true' : 'false';
    root.dataset.backgroundMode = mode.backgroundMode;

    return () => {
      delete root.dataset.obs;
      delete root.dataset.backgroundMode;
    };
  }, [settings.transparentBackground]);

  useEffect(() => {
    const channel = new BroadcastChannel('peter-retreat-display');
    channel.onmessage = (event: MessageEvent<RetreatSettings>) => {
      if (event.data?.version === 1) setSettings(normalizeSettings(event.data));
    };
    return () => channel.close();
  }, []);

  useEffect(() => {
    let active = true;
    const loadPublishedCharacters = async () => {
      try {
        const teams = await apiRequest<Team[]>('/teams', { cache: 'no-store' });
        if (active) setPublishedTeams(teams);
      } catch (error) {
        console.warn('승인된 조별 캐릭터를 불러오지 못했습니다.', error);
      }
    };
    void loadPublishedCharacters();
    const polling = window.setInterval(() => {
      void loadPublishedCharacters();
    }, 8_000);
    return () => {
      active = false;
      window.clearInterval(polling);
    };
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

  const displaySettings = useMemo<RetreatSettings>(() => {
    if (!publishedTeams.length) return settings;
    const teamsByNumber = new Map(publishedTeams.map((team) => [team.id, team]));
    return {
      ...settings,
      groups: settings.groups.map((group) => {
        const team = teamsByNumber.get(group.groupNumber);
        if (!team) return group;
        return {
          ...group,
          groupName: team.name || group.groupName,
          displayName: team.name || group.displayName,
          spriteAtlasUrl: team.showcase_sprite_active_version_id
            ? team.showcase_sprite_active_url || ''
            : '',
          spriteAtlasContract: team.showcase_sprite_active_version_id
            ? team.showcase_sprite_contract ?? null
            : null,
        };
      }),
    };
  }, [publishedTeams, settings]);

  const value = useMemo(() => ({
    settings: displaySettings,
    updateSettings,
    updateGroup,
    importSettings,
    resetSettings,
    saveNow,
  }), [
    displaySettings,
    importSettings,
    resetSettings,
    saveNow,
    updateGroup,
    updateSettings,
  ]);

  return <RetreatContext.Provider value={value}>{children}</RetreatContext.Provider>;
}

export function useRetreat() {
  const value = useContext(RetreatContext);
  if (!value) throw new Error('useRetreat must be used inside RetreatProvider');
  return value;
}
