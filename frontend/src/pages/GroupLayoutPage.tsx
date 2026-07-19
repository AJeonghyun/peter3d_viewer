import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  activateSeatingPreset,
  fetchSeatingPresets,
} from '../lib/seatingPresets';
import { RetreatCharacter } from '../retreat/RetreatCharacter';
import { useRetreat } from '../retreat/RetreatProvider';
import type { RetreatGroup } from '../retreat/types';
import type { AnimationName } from '../spriteLab/types';
import '../styles/retreat-group.css';

interface GroupLayoutPageProps {
  preview?: boolean;
}

interface CardMotion {
  animation: AnimationName;
  flipX: boolean;
}

const ROW_SIZES = [4, 4, 4, 4, 3, 2] as const;
const MOTIONS = ['idle', 'idle', 'idle', 'wave'] as const satisfies readonly AnimationName[];

function seededValue(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function buildRows(groups: RetreatGroup[]) {
  let cursor = 0;
  return ROW_SIZES.map((rowSize) => {
    const row = groups.slice(cursor, cursor + rowSize);
    cursor += rowSize;
    return row;
  });
}

function buildCardMotion(group: RetreatGroup, fallbackIndex: number): CardMotion {
  const seed = group.groupNumber || fallbackIndex + 1;
  return {
    animation: MOTIONS[fallbackIndex % MOTIONS.length],
    flipX: seededValue(seed + 5) > 0.5,
  };
}

function isDefaultGroupName(group: RetreatGroup) {
  const name = group.groupName.trim();
  return !name || name === `${group.groupNumber}조` || name === `베드로 ${group.groupNumber}조`;
}

export default function GroupLayoutPage({ preview = false }: GroupLayoutPageProps) {
  const { settings, updateSettings } = useRetreat();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [presetMessage, setPresetMessage] = useState('');
  const activePlan = useMemo(
    () => settings.seatingPlans.find((plan) => plan.active) ?? settings.seatingPlans[0],
    [settings.seatingPlans],
  );
  const groups = useMemo(() => {
    const byId = new Map(settings.groups.map((group) => [group.id, group]));
    const ordered = activePlan?.slotGroupIds
      .map((id) => byId.get(id))
      .filter((group): group is RetreatGroup => Boolean(group)) ?? [];
    const used = new Set(ordered.map((group) => group.id));
    const remaining = settings.groups
      .filter((group) => !used.has(group.id))
      .sort((first, second) => first.groupNumber - second.groupNumber);
    return [...ordered, ...remaining].slice(0, 21);
  }, [activePlan, settings.groups]);
  const rows = useMemo(() => buildRows(groups), [groups]);
  const playing = settings.animationPlaying && settings.groupLayout.animationEnabled;
  let groupIndex = 0;

  const syncPlans = useCallback(async () => {
    try {
      const collection = await fetchSeatingPresets();
      updateSettings((current) => {
        const byNumber = new Map(current.groups.map((group) => [group.groupNumber, group.id]));
        const seatingPlans = collection.presets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          title: preset.title,
          timeLabel: preset.time_label,
          slotGroupIds: preset.group_order
            .map((groupNumber) => byNumber.get(groupNumber))
            .filter((id): id is string => Boolean(id)),
          active: preset.id === collection.active_preset_id,
        }));
        const active = seatingPlans.find((plan) => plan.active) ?? seatingPlans[0];
        return {
          ...current,
          groupLayout: {
            ...current.groupLayout,
            title: active?.title ?? current.groupLayout.title,
          },
          seatingPlans: seatingPlans.length ? seatingPlans : current.seatingPlans,
        };
      });
      setPresetMessage('');
    } catch {
      setPresetMessage('기본 자리표 표시 중');
    }
  }, [updateSettings]);

  useEffect(() => {
    document.title = 'DO YOU LOVE ME · 자리표';
    void syncPlans();
    const interval = window.setInterval(syncPlans, 4_000);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 's') setSelectorOpen((current) => !current);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [syncPlans]);

  async function activatePlan(planId: string) {
    updateSettings((current) => ({
      ...current,
      groupLayout: {
        ...current.groupLayout,
        title: current.seatingPlans.find((plan) => plan.id === planId)?.title
          ?? current.groupLayout.title,
      },
      seatingPlans: current.seatingPlans.map((plan) => ({
        ...plan,
        active: plan.id === planId,
      })),
    }));
    setPresetMessage('자리표 변경 중…');
    try {
      await activateSeatingPreset(planId);
      await syncPlans();
      setSelectorOpen(false);
    } catch (error) {
      setPresetMessage(error instanceof Error ? error.message : '자리표를 변경하지 못했습니다');
    }
  }

  return (
    <main
      className="retreat-group-page"
      data-display-page="group-layout"
      data-preview={preview ? 'true' : 'false'}
      aria-label="21개 조 편성표"
    >
      <section
        className="retreat-group-stage"
        aria-labelledby="retreat-group-title"
      >
        <div className="retreat-group-stage__sun" aria-hidden="true" />
        <div className="retreat-group-stage__sky" aria-hidden="true" />
        <div className="retreat-group-stage__sea" aria-hidden="true" />
        <div className="retreat-group-stage__waves retreat-group-stage__waves--back" aria-hidden="true" />
        <div className="retreat-group-stage__waves retreat-group-stage__waves--front" aria-hidden="true" />
        <div className="retreat-group-stage__shore" aria-hidden="true" />

        <header className="retreat-group-stage__header">
          <p>{activePlan?.timeLabel || 'DO YOU LOVE ME'}</p>
          <h1 id="retreat-group-title">{activePlan?.title ?? settings.groupLayout.title}</h1>
        </header>

        <div
          className="retreat-group-plan"
          data-open={selectorOpen ? 'true' : 'false'}
          data-export-ignore="true"
        >
          <button
            type="button"
            className="retreat-group-plan__trigger"
            onClick={() => setSelectorOpen((current) => !current)}
            aria-expanded={selectorOpen}
          >
            자리표 · {activePlan?.name ?? '기본'} ▾
          </button>
          {selectorOpen ? (
            <div className="retreat-group-plan__menu" role="menu">
              {settings.seatingPlans.map((plan) => (
                <button
                  type="button"
                  key={plan.id}
                  className="retreat-group-plan__option"
                  data-active={plan.id === activePlan?.id ? 'true' : 'false'}
                  onClick={() => void activatePlan(plan.id)}
                  role="menuitem"
                >
                  <span>{plan.name}</span>
                  <small>{plan.title}</small>
                </button>
              ))}
              {presetMessage ? <span className="retreat-group-plan__message">{presetMessage}</span> : null}
              <a className="retreat-group-plan__admin" href="/admin/seating">관리자에서 편집</a>
            </div>
          ) : null}
        </div>

        <div className="retreat-group-grid" aria-label="조별 배치">
          {rows.map((row, rowIndex) => (
            <div
              className="retreat-group-grid__row"
              data-row-size={row.length}
              key={`row-${rowIndex}`}
            >
              {row.map((group) => {
                const motion = buildCardMotion(group, groupIndex);
                groupIndex += 1;
                return (
                  <article
                    className="retreat-group-card"
                    data-group-number={group.groupNumber}
                    key={group.id}
                  >
                    <div className="retreat-group-card__text">
                      <strong className="retreat-group-card__number">{group.groupNumber}조</strong>
                      {!isDefaultGroupName(group) ? (
                        <span className="retreat-group-card__name">{group.groupName}</span>
                      ) : null}
                      {(group.leaderName || (settings.groupLayout.showMembers && group.memberNames.length > 0)) && (
                        <span className="retreat-group-card__details">
                          {group.leaderName ? `리더 ${group.leaderName}` : group.memberNames.slice(0, 3).join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="retreat-group-card__actor-zone" aria-hidden="true">
                      {group.enabled ? (
                        <RetreatCharacter
                          group={group}
                          animation={motion.animation}
                          playing={playing}
                          flipX={motion.flipX}
                          className="retreat-group-card__actor"
                        />
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
