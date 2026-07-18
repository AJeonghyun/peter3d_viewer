import { useEffect, useRef, useState } from 'react';
import type { AnimationDefinition } from './types';

interface SpriteAnimationOptions {
  definition: AnimationDefinition;
  animationKey: string;
  playing: boolean;
  visible: boolean;
  speedMultiplier: number;
  onAnimationEnd?: () => void;
}

export function useSpriteAnimation({
  definition,
  animationKey,
  playing,
  visible,
  speedMultiplier,
  onAnimationEnd,
}: SpriteAnimationOptions) {
  const [frameIndex, setFrameIndex] = useState(0);
  const elapsedRef = useRef(0);
  const completedRef = useRef(false);
  const renderedFrameRef = useRef(0);
  const callbackRef = useRef(onAnimationEnd);
  callbackRef.current = onAnimationEnd;

  useEffect(() => {
    elapsedRef.current = 0;
    completedRef.current = false;
    renderedFrameRef.current = 0;
    setFrameIndex(0);
  }, [animationKey]);

  useEffect(() => {
    if (!playing || !visible || definition.frames.length === 0) return undefined;
    if (definition.loop && definition.frames.length === 1) return undefined;

    const multiplier = Math.max(0.1, speedMultiplier);
    const frameDuration = 1000 / Math.max(1, definition.fps * multiplier);
    const oneShotDuration = (definition.durationMs
      ?? Math.max(frameDuration * definition.frames.length, 600)) / multiplier;
    let animationFrame = 0;
    let previousTimestamp: number | null = null;

    const update = (timestamp: number) => {
      if (previousTimestamp === null) previousTimestamp = timestamp;
      elapsedRef.current += Math.min(timestamp - previousTimestamp, 100);
      previousTimestamp = timestamp;

      if (!definition.loop && elapsedRef.current >= oneShotDuration) {
        const finalFrame = definition.holdLastFrame ? definition.frames.length - 1 : 0;
        if (renderedFrameRef.current !== finalFrame) {
          renderedFrameRef.current = finalFrame;
          setFrameIndex(finalFrame);
        }
        if (!completedRef.current) {
          completedRef.current = true;
          callbackRef.current?.();
        }
        return;
      }

      const rawIndex = Math.floor(elapsedRef.current / frameDuration);
      const nextFrame = definition.loop
        ? rawIndex % definition.frames.length
        : Math.min(rawIndex, definition.frames.length - 1);
      if (renderedFrameRef.current !== nextFrame) {
        renderedFrameRef.current = nextFrame;
        setFrameIndex(nextFrame);
      }
      animationFrame = window.requestAnimationFrame(update);
    };

    animationFrame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [definition, playing, speedMultiplier, visible]);

  return frameIndex;
}
