import type { CharacterState } from './types';

interface AnimationControlsProps {
  visible: boolean;
  state: CharacterState;
  background: 'morning' | 'night';
  sequenceMode: boolean;
  onState: (state: CharacterState) => void;
  onMove: (state: 'walking' | 'running', direction: -1 | 1) => void;
  onEnter: () => void;
  onExit: () => void;
  onReset: () => void;
  onBackground: (background: 'morning' | 'night') => void;
  onSequence: () => void;
  onHide: () => void;
}

const ACTIONS: Array<{ label: string; state: CharacterState }> = [
  { label: '정지', state: 'idle' },
  { label: '손 흔들기', state: 'waving' },
  { label: '점프', state: 'jumping' },
  { label: '기도하기', state: 'praying' },
  { label: '무릎 꿇기', state: 'kneeling' },
  { label: '가리키기', state: 'pointing' },
];

export function AnimationControls({
  visible,
  state,
  background,
  sequenceMode,
  onState,
  onMove,
  onEnter,
  onExit,
  onReset,
  onBackground,
  onSequence,
  onHide,
}: AnimationControlsProps) {
  if (!visible) return null;

  return (
    <aside className="animation-controls" aria-label="개발용 애니메이션 컨트롤">
      <div className="animation-controls__header">
        <div>
          <strong>스프라이트 제어</strong>
          <span>{sequenceMode ? '순차 등장 재생 중' : `현재 상태: ${state}`}</span>
        </div>
        <button type="button" onClick={onHide}>패널 숨기기</button>
      </div>
      <div className="animation-controls__groups">
        <div className="animation-controls__group">
          {ACTIONS.map((action) => (
            <button
              key={action.state}
              type="button"
              data-active={!sequenceMode && state === action.state ? 'true' : 'false'}
              onClick={() => onState(action.state)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="animation-controls__group">
          <button type="button" onClick={() => onMove('walking', -1)}>왼쪽 걷기</button>
          <button type="button" onClick={() => onMove('walking', 1)}>오른쪽 걷기</button>
          <button type="button" onClick={() => onMove('running', -1)}>왼쪽 뛰기</button>
          <button type="button" onClick={() => onMove('running', 1)}>오른쪽 뛰기</button>
          <button type="button" onClick={onEnter}>입장</button>
          <button type="button" onClick={onExit}>퇴장</button>
          <button type="button" onClick={onReset}>다시 시작</button>
        </div>
        <div className="animation-controls__group">
          <button
            type="button"
            data-active={background === 'morning' ? 'true' : 'false'}
            onClick={() => onBackground('morning')}
          >
            아침 배경
          </button>
          <button
            type="button"
            data-active={background === 'night' ? 'true' : 'false'}
            onClick={() => onBackground('night')}
          >
            밤 배경
          </button>
          <button
            type="button"
            data-active={sequenceMode ? 'true' : 'false'}
            onClick={onSequence}
          >
            순차 등장 데모
          </button>
        </div>
      </div>
    </aside>
  );
}
