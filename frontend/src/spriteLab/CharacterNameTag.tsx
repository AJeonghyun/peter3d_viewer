import type { CharacterDefinition } from './types';

interface CharacterNameTagProps {
  character: CharacterDefinition;
  visible: boolean;
}

export function CharacterNameTag({ character, visible }: CharacterNameTagProps) {
  return (
    <div className="character-name" data-visible={visible ? 'true' : 'false'} aria-hidden={!visible}>
      <strong>{character.name}</strong>
      <span>{character.group}</span>
    </div>
  );
}
