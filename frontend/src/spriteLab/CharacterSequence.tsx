import { useCallback, useEffect, useRef, useState } from 'react';
import {
  demoCharacters,
  demoSequenceSettings,
  demoSlots,
} from './data';
import { CharacterActor } from './CharacterActor';
import type {
  CharacterDefinition,
  CharacterState,
  SequenceActor,
} from './types';

interface CharacterSequenceProps {
  restartToken: number;
  playing: boolean;
  characters?: CharacterDefinition[];
  maxVisible?: number;
}

function initialActors(
  characters: CharacterDefinition[],
  maxVisible: number,
): SequenceActor[] {
  return characters.slice(0, maxVisible).map((character, index) => ({
    character,
    state: 'offscreen',
    x: -16 - index * 3,
    targetX: demoSlots[index] ?? 50,
    y: index % 2 === 0 ? 76 : 82,
    scale: index % 2 === 0 ? 0.92 : 1,
    showName: false,
  }));
}

export function CharacterSequence({
  restartToken,
  playing,
  characters = demoCharacters,
  maxVisible = demoSequenceSettings.maxVisible,
}: CharacterSequenceProps) {
  const visibleCharacters = characters.slice(0, Math.max(1, maxVisible));
  const [actors, setActors] = useState<SequenceActor[]>(
    () => initialActors(visibleCharacters, maxVisible),
  );
  const actorsRef = useRef<SequenceActor[]>(actors);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    actorsRef.current = actors;
  }, [actors]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const schedule = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((value) => value !== timer);
      callback();
    }, delay);
    timersRef.current.push(timer);
  }, []);

  const startActor = useCallback((index: number) => {
    setActors((current) => current.map((actor, actorIndex) => (
      actorIndex === index
        ? { ...actor, state: 'entering', showName: false }
        : actor
    )));
  }, []);

  useEffect(() => {
    clearTimers();
    const reset = initialActors(visibleCharacters, maxVisible);
    setActors(reset);
    if (playing) {
      schedule(() => startActor(0), demoSequenceSettings.entranceDelayMs);
    }
    return clearTimers;
  }, [
    characters,
    clearTimers,
    maxVisible,
    playing,
    restartToken,
    schedule,
    startActor,
  ]);

  const onStateComplete = useCallback((
    characterId: string,
    completedState: CharacterState,
  ) => {
    const completedIndex = actorsRef.current.findIndex((actor) => actor.character.id === characterId);
    if (completedIndex < 0) return;

    if (completedState === 'entering') {
      setActors((current) => current.map((actor) => {
        if (actor.character.id !== characterId) return actor;
        return {
          ...actor,
          x: actor.targetX,
          state: 'idle',
          showName: true,
        };
      }));
      schedule(() => {
        setActors((current) => current.map((actor, index) => (
          index === completedIndex ? { ...actor, state: 'waving' } : actor
        )));
      }, demoSequenceSettings.waveDelayMs);
      return;
    }

    if (completedState === 'waving') {
      setActors((current) => current.map((actor) => {
        if (actor.character.id !== characterId) return actor;
        return { ...actor, state: 'idle' };
      }));
      schedule(() => {
        setActors((current) => current.map((actor, index) => (
          index === completedIndex ? { ...actor, showName: false } : actor
        )));
        const nextIndex = completedIndex + 1;
        if (nextIndex < actorsRef.current.length) startActor(nextIndex);
      }, demoSequenceSettings.nameVisibleMs);
    }
  }, [schedule, startActor]);

  return (
    <div className="character-sequence" aria-label="다섯 캐릭터 순차 등장 데모">
      {actors.map((actor) => (
        <CharacterActor
          key={actor.character.id}
          character={actor.character}
          initialX={actor.x}
          initialY={actor.y}
          targetX={actor.targetX}
          state={actor.state}
          scale={actor.scale}
          showName={actor.showName}
          onStateComplete={onStateComplete}
        />
      ))}
    </div>
  );
}
