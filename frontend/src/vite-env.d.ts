/// <reference types="vite/client" />

interface Window {
  __peterWorldDebug?: {
    snapshot: () => unknown;
  };
}
