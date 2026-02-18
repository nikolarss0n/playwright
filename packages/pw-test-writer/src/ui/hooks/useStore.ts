import { useSyncExternalStore } from 'react';
import { store, type AppState } from '../store.js';

export function useStore<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(
    store.subscribe.bind(store),
    () => selector(store.getState()),
  );
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    store.subscribe.bind(store),
    () => store.getState(),
  );
}
