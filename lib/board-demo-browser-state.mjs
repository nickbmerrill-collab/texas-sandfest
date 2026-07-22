export const BOARD_DEMO_SESSION_GENERATION_KEY = "sandfest_board_demo_session_generation_v1";
export const BOARD_DEMO_LOCAL_GENERATION_KEY = "sandfest_board_demo_local_generation_v1";

function synchronizeStorageGeneration(storage, markerKey, generation, keys) {
  if (!storage) return false;
  try {
    if (storage.getItem(markerKey) === generation) return false;
    for (const key of keys) storage.removeItem(key);
    storage.setItem(markerKey, generation);
    return true;
  } catch {
    return false;
  }
}

export function synchronizeBoardDemoBrowserState({
  generation = "",
  sessionStorage,
  localStorage,
  sessionKeys = [],
  localKeys = []
} = {}) {
  const cleanGeneration = String(generation || "").trim();
  if (!cleanGeneration) return { sessionReset: false, localReset: false };
  return {
    sessionReset: synchronizeStorageGeneration(sessionStorage, BOARD_DEMO_SESSION_GENERATION_KEY, cleanGeneration, sessionKeys),
    localReset: synchronizeStorageGeneration(localStorage, BOARD_DEMO_LOCAL_GENERATION_KEY, cleanGeneration, localKeys)
  };
}
