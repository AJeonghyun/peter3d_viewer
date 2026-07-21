/// <reference types="vite/client" />

interface Window {
  __peterShowcaseDebug?: {
    snapshot: () => {
      activeTeamIds: number[];
    };
  };
}

interface Window {
  __peterWorldDebug?: {
    snapshot: () => unknown;
  };
}
