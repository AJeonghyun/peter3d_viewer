export type DisplayBackgroundMode = 'default' | 'transparent' | 'embedded';

export interface DisplayMode {
  obsMode: boolean;
  backgroundMode: DisplayBackgroundMode;
}

const BACKGROUND_MODES = new Set<DisplayBackgroundMode>([
  'default',
  'transparent',
  'embedded',
]);

function currentSearch() {
  return typeof window === 'undefined' ? '' : window.location.search;
}

export function getDisplayMode(search = currentSearch()): DisplayMode {
  const params = new URLSearchParams(search);
  const obsMode = params.get('obs') === '1';
  const requestedBackground = params.get('background') as DisplayBackgroundMode | null;
  const backgroundMode = requestedBackground && BACKGROUND_MODES.has(requestedBackground)
    ? requestedBackground
    : obsMode
      ? 'transparent'
      : 'default';

  return { obsMode, backgroundMode };
}

export function getEffectiveDisplayMode(
  transparentBackground: boolean,
  search = currentSearch(),
): DisplayMode {
  const params = new URLSearchParams(search);
  const queryMode = getDisplayMode(search);

  if (params.has('obs') || params.has('background') || !transparentBackground) {
    return queryMode;
  }

  return { obsMode: true, backgroundMode: 'transparent' };
}

export function buildObsDisplayUrl(path: string, origin = window.location.origin) {
  const url = new URL(path, origin);
  url.searchParams.set('obs', '1');
  return url.toString();
}

// OBS's embedded Chromium predates container-query units. The display stage
// fills the whole viewport there, so vw/vh are exact substitutes for cqw/cqh.
const supportsContainerUnits =
  typeof CSS !== 'undefined'
  && typeof CSS.supports === 'function'
  && CSS.supports('width: 1cqw');

export const STAGE_UNIT_X = supportsContainerUnits ? 'cqw' : 'vw';
export const STAGE_UNIT_Y = supportsContainerUnits ? 'cqh' : 'vh';
