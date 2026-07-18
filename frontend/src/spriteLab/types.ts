export type AnimationName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'wave'
  | 'jump'
  | 'pray'
  | 'kneel'
  | 'point';

export type CharacterState =
  | 'offscreen'
  | 'entering'
  | 'walking'
  | 'running'
  | 'idle'
  | 'waving'
  | 'jumping'
  | 'praying'
  | 'kneeling'
  | 'pointing'
  | 'exiting';

export interface AnimationDefinition {
  sprite: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  holdLastFrame?: boolean;
  durationMs?: number;
}

export interface CharacterDefinition {
  id: string;
  name: string;
  group: string;
  animations: Record<AnimationName, AnimationDefinition>;
}

export interface SequenceActor {
  character: CharacterDefinition;
  state: CharacterState;
  x: number;
  targetX: number;
  y: number;
  scale: number;
  showName: boolean;
}

export interface SequenceStep {
  characterId: string;
  action:
    | 'enter'
    | 'walkTo'
    | 'idle'
    | 'wave'
    | 'pray'
    | 'showName'
    | 'hideName'
    | 'exit';
  targetX?: number;
  durationMs?: number;
}
