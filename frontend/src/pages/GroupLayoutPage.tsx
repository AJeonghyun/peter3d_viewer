import { useMemo, type CSSProperties } from 'react';
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
  delay: number;
  duration: number;
  travel: number;
}

type GroupLayoutStyle = CSSProperties & Record<`--${string}`, string>;

const ROW_SIZES = [4, 4, 4, 4, 3, 2] as const;
const MOTIONS = ['idle', 'walk', 'wave'] as const satisfies readonly AnimationName[];

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
    delay: seededValue(seed + 13) * -7,
    duration: 6.8 + seededValue(seed + 17) * 3.6,
    travel: 8 + seededValue(seed + 21) * 12,
  };
}

export default function GroupLayoutPage({ preview = false }: GroupLayoutPageProps) {
  const { settings } = useRetreat();
  const groups = useMemo(
    () => [...settings.groups]
      .sort((first, second) => first.groupNumber - second.groupNumber)
      .slice(0, 21),
    [settings.groups],
  );
  const rows = useMemo(() => buildRows(groups), [groups]);
  const playing = settings.animationPlaying && settings.groupLayout.animationEnabled;
  let groupIndex = 0;

  return (
    <main
      className="retreat-group-page"
      data-display-page="group-layout"
      data-preview={preview ? 'true' : 'false'}
      aria-label="21개 조 편성표"
    >
      <section
        className="retreat-group-stage"
        data-background={settings.groupLayout.background}
        aria-labelledby="retreat-group-title"
      >
        <div className="retreat-group-stage__sky" aria-hidden="true" />
        <div className="retreat-group-stage__shore" aria-hidden="true" />

        <header className="retreat-group-stage__header">
          <p>Peter Retreat</p>
          <h1 id="retreat-group-title">{settings.groupLayout.title}</h1>
        </header>

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
                    style={{ '--group-accent': group.accentColor } as GroupLayoutStyle}
                  >
                    <div className="retreat-group-card__text">
                      <span className="retreat-group-card__number">{group.groupName}</span>
                      <strong>{group.displayName}</strong>
                      {(group.leaderName || (settings.groupLayout.showMembers && group.memberNames.length > 0)) && (
                        <span className="retreat-group-card__details">
                          {group.leaderName ? `리더 ${group.leaderName}` : group.memberNames.slice(0, 3).join(', ')}
                        </span>
                      )}
                    </div>
                    <div
                      className="retreat-group-card__actor-zone"
                      style={{
                        '--actor-delay': `${motion.delay}s`,
                        '--actor-duration': `${motion.duration}s`,
                        '--actor-travel': `${motion.travel}px`,
                      } as GroupLayoutStyle}
                      aria-hidden="true"
                    >
                      {group.enabled ? (
                        <div className="retreat-group-card__actor">
                          <RetreatCharacter
                            group={group}
                            animation={motion.animation}
                            playing={playing}
                            flipX={motion.flipX}
                          />
                        </div>
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
