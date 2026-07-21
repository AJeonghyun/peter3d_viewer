import { useCallback, useEffect, useState } from 'react';
import { AnimationControls } from '../spriteLab/AnimationControls';
import { CharacterActor } from '../spriteLab/CharacterActor';
import { CharacterSequence } from '../spriteLab/CharacterSequence';
import { demoCharacters } from '../spriteLab/data';
import { canStartState, stateAfterCompletion } from '../spriteLab/stateMachine';
import type { CharacterState } from '../spriteLab/types';
import '../styles/sprite-lab.css';

function controlsEnabledByQuery() {
  return new URLSearchParams(window.location.search).get('controls') !== 'false';
}

export default function SpriteLabPage() {
  const [background, setBackground] = useState<'morning' | 'night'>('morning');
  const [controlsVisible, setControlsVisible] = useState(controlsEnabledByQuery);
  const [controlsToggleEnabled, setControlsToggleEnabled] = useState(controlsEnabledByQuery);
  const [sequenceMode, setSequenceMode] = useState(false);
  const [sequenceToken, setSequenceToken] = useState(0);
  const [state, setState] = useState<CharacterState>('idle');
  const [x, setX] = useState(50);
  const [targetX, setTargetX] = useState(50);

  useEffect(() => {
    document.title = '베드로 스프라이트 애니메이션';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'c') {
        setControlsToggleEnabled(true);
        setControlsVisible((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const requestState = useCallback((requested: CharacterState) => {
    setSequenceMode(false);
    setState((current) => canStartState(current, requested) ? requested : current);
  }, []);

  const requestMove = useCallback((
    requested: 'walking' | 'running',
    direction: -1 | 1,
  ) => {
    setSequenceMode(false);
    setTargetX(Math.max(12, Math.min(88, x + direction * 24)));
    setState((current) => canStartState(current, requested) ? requested : current);
  }, [x]);

  const handleComplete = useCallback((
    _characterId: string,
    completedState: CharacterState,
  ) => {
    if (completedState === 'walking' || completedState === 'running' || completedState === 'entering') {
      setX(targetX);
    }
    setState(stateAfterCompletion(completedState));
  }, [targetX]);

  const enter = useCallback(() => {
    setSequenceMode(false);
    setX(-14);
    setTargetX(50);
    setState('entering');
  }, []);

  const exit = useCallback(() => {
    setSequenceMode(false);
    setTargetX(x < 50 ? -16 : 116);
    setState('exiting');
  }, [x]);

  const reset = useCallback(() => {
    setSequenceMode(false);
    setX(50);
    setTargetX(50);
    setState('idle');
  }, []);

  const playSequence = useCallback(() => {
    setSequenceMode(true);
    setSequenceToken((current) => current + 1);
  }, []);

  return (
    <main className="sprite-lab">
      <section
        className="sprite-stage"
        data-background={background}
        aria-label={`갈릴리 ${background === 'morning' ? '아침' : '밤'} 애니메이션 무대`}
      >
        <div className="sprite-stage__sky" />
        <div className="sprite-stage__hills sprite-stage__hills--back" />
        <div className="sprite-stage__hills sprite-stage__hills--front" />
        <div className="sprite-stage__lake" />
        <div className="sprite-stage__shore" />
        <div className="sprite-stage__boat" aria-hidden="true">
          <span />
        </div>
        <div className="sprite-stage__net" aria-hidden="true" />
        <div className="sprite-stage__actors">
          {sequenceMode ? (
            <CharacterSequence restartToken={sequenceToken} playing />
          ) : state !== 'offscreen' ? (
            <CharacterActor
              character={demoCharacters[0]}
              initialX={x}
              targetX={targetX}
              state={state}
              showName
              onStateComplete={handleComplete}
            />
          ) : null}
        </div>
        <button
          type="button"
          className="sprite-stage__controls-toggle"
          data-visible={!controlsVisible && controlsToggleEnabled ? 'true' : 'false'}
          onClick={() => setControlsVisible(true)}
        >
          컨트롤 열기
        </button>
      </section>
      <AnimationControls
        visible={controlsVisible}
        state={state}
        background={background}
        sequenceMode={sequenceMode}
        onState={requestState}
        onMove={requestMove}
        onEnter={enter}
        onExit={exit}
        onReset={reset}
        onBackground={setBackground}
        onSequence={playSequence}
        onHide={() => {
          setControlsToggleEnabled(true);
          setControlsVisible(false);
        }}
      />
    </main>
  );
}
