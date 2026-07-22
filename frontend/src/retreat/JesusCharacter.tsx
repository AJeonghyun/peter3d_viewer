import { memo, type HTMLAttributes } from 'react';
import { AtlasSpriteAnimator } from './AtlasSpriteAnimator';
import { RETREAT_POSES, type RetreatPoseId } from './scenePoses';

const JESUS_MASTER_URL = '/assets/retreat/jesus-retreat-master-v1.png';
const JESUS_MASTER_CONTRACT = {
  id: 'fixed-jesus-master-edit-v1',
  version: 1,
  layout: '8x4',
  rows: 4,
  columns: 8,
  frame_count: 32,
  display_scale: 1,
} as const;

interface JesusCharacterProps extends HTMLAttributes<HTMLDivElement> {
  poseId: RetreatPoseId;
  playing?: boolean;
  flipX?: boolean;
  className?: string;
  label?: string;
}

function JesusCharacterComponent({
  poseId,
  playing = true,
  flipX = false,
  className = '',
  label = '예수님',
  ...elementProps
}: JesusCharacterProps) {
  const pose = RETREAT_POSES[poseId];
  return (
    <div {...elementProps} className={`jesus-retreat-character ${className}`.trim()}>
      <AtlasSpriteAnimator
        spriteUrl={JESUS_MASTER_URL}
        animation={pose.animation}
        frameSequence={pose.currentFrames}
        playing={playing}
        flipX={flipX}
        contract={JESUS_MASTER_CONTRACT}
        label={`${label} · ${pose.label}`}
      />
    </div>
  );
}

export const JesusCharacter = memo(JesusCharacterComponent);
