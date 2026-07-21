import { forwardRef, type HTMLAttributes } from 'react';
import AllCharactersPage from '../pages/AllCharactersPage';
import GroupLayoutPage from '../pages/GroupLayoutPage';
import NoticePage from '../pages/NoticePage';
import { useRetreat } from './RetreatProvider';
import { getEffectiveDisplayMode } from './displayMode';
import type { RetreatPage } from './types';
import '../styles/retreat.css';

interface RetreatDisplayProps extends HTMLAttributes<HTMLDivElement> {
  page?: RetreatPage;
  preview?: boolean;
}

export const RetreatDisplay = forwardRef<HTMLDivElement, RetreatDisplayProps>(
  function RetreatDisplay({ page, preview = false, className = '', ...props }, ref) {
    const { settings } = useRetreat();
    const activePage = page ?? settings.currentPage;
    const displayMode = getEffectiveDisplayMode(settings.transparentBackground);

    return (
      <div
        ref={ref}
        className={`retreat-stage-shell ${className}`.trim()}
        data-preview={preview ? 'true' : 'false'}
        data-obs={displayMode.obsMode ? 'true' : 'false'}
        data-background-mode={displayMode.backgroundMode}
        {...props}
      >
        {activePage === 'group-layout' ? (
          <GroupLayoutPage preview={preview} />
        ) : activePage === 'notice' ? (
          <NoticePage preview={preview} />
        ) : (
          <AllCharactersPage preview={preview} />
        )}
      </div>
    );
  },
);
