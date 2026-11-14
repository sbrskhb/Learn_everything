import type { Course, LastBrowsingState } from '../types';

export const LAST_BROWSING_STORAGE_KEY = 'learn_everything_last_browsing_state_v1';

export function computeBrowsingViewKey(state: {
  activeLessonRef?: { courseId: string; dayIndex: number } | null;
  focusedDate?: string | null;
  selectedCourseFilter?: string;
}): string {
  if (state.activeLessonRef?.courseId && Number.isFinite(state.activeLessonRef.dayIndex)) {
    return `lesson:${state.activeLessonRef.courseId}:${state.activeLessonRef.dayIndex}`;
  }
  if (state.focusedDate) {
    return `daily:${state.focusedDate}`;
  }
  return `timeline:${state.selectedCourseFilter || 'all'}`;
}

export function sanitizeBrowsingState(raw: any): LastBrowsingState | null {
  if (!raw || typeof raw !== 'object') return null;

  const view: 'timeline' | 'daily' | 'lesson' =
    raw.view === 'lesson' || raw.view === 'daily' || raw.view === 'timeline'
      ? raw.view
      : raw.activeLessonRef
        ? 'lesson'
        : raw.focusedDate
          ? 'daily'
          : 'timeline';

  const selectedCourseFilter =
    typeof raw.selectedCourseFilter === 'string' && raw.selectedCourseFilter.trim()
      ? raw.selectedCourseFilter.trim()
      : 'all';

  const focusedDate =
    typeof raw.focusedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.focusedDate.trim())
      ? raw.focusedDate.trim()
      : null;

  let activeLessonRef: { courseId: string; dayIndex: number } | null = null;
  if (
    raw.activeLessonRef &&
    typeof raw.activeLessonRef === 'object' &&
    typeof raw.activeLessonRef.courseId === 'string' &&
    raw.activeLessonRef.courseId.trim() &&
    Number.isFinite(Number(raw.activeLessonRef.dayIndex))
  ) {
    activeLessonRef = {
      courseId: raw.activeLessonRef.courseId.trim(),
      dayIndex: Math.max(1, Math.round(Number(raw.activeLessonRef.dayIndex))),
    };
  }

  const scrollY = Math.max(0, Math.round(Number(raw.scrollY) || 0));
  const scrollMap: Record<string, number> = {};
  if (raw.scrollMap && typeof raw.scrollMap === 'object') {
    for (const [k, v] of Object.entries(raw.scrollMap)) {
      const num = Number(v);
      if (typeof k === 'string' && k.length < 160 && Number.isFinite(num) && num >= 0) {
        scrollMap[k] = Math.round(num);
      }
    }
  }

  const viewKey = computeBrowsingViewKey({
    activeLessonRef,
    focusedDate,
    selectedCourseFilter,
  });
  if (scrollMap[viewKey] === undefined) {
    scrollMap[viewKey] = scrollY;
  }

  const updatedAt =
    typeof raw.updatedAt === 'string' && raw.updatedAt.trim()
      ? raw.updatedAt.trim()
      : new Date(0).toISOString();

  return {
    view,
    selectedCourseFilter,
    focusedDate,
    activeLessonRef,
    scrollY,
    scrollMap,
    updatedAt,
  };
}

/**
 * Pick the most recent valid browsing state between localStorage and backend disk.
 */
export function selectNewestBrowsingState(
  localRaw: any,
  serverRaw: any
): LastBrowsingState | null {
  const localState = sanitizeBrowsingState(localRaw);
  const serverState = sanitizeBrowsingState(serverRaw);
  if (!localState && !serverState) return null;
  if (!localState) return serverState;
  if (!serverState) return localState;

  const localTime = Date.parse(localState.updatedAt) || 0;
  const serverTime = Date.parse(serverState.updatedAt) || 0;
  const primary = serverTime > localTime ? serverState : localState;
  const secondary = serverTime > localTime ? localState : serverState;

  return {
    ...primary,
    scrollMap: {
      ...(secondary.scrollMap || {}),
      ...(primary.scrollMap || {}),
    },
  };
}

/**
 * Reconcile a saved browsing state against the currently loaded courses list.
 * Falls back gracefully if a referenced course or lesson slot was deleted.
 */
export function reconcileBrowsingStateWithCourses(
  saved: LastBrowsingState | null,
  courses: Course[]
): LastBrowsingState | null {
  if (!saved) return null;

  const courseExists = (id: string) => courses.some((c) => c.id === id);

  const selectedCourseFilter =
    saved.selectedCourseFilter !== 'all' && !courseExists(saved.selectedCourseFilter)
      ? 'all'
      : saved.selectedCourseFilter;

  let activeLessonRef = saved.activeLessonRef;
  if (activeLessonRef) {
    const targetCourse = courses.find((c) => c.id === activeLessonRef!.courseId);
    const slotExists = targetCourse?.dailyPlan.some(
      (d) => d.dayIndex === activeLessonRef!.dayIndex
    );
    if (!targetCourse || !slotExists) {
      activeLessonRef = null;
    }
  }

  const focusedDate = saved.focusedDate;
  const view: 'timeline' | 'daily' | 'lesson' = activeLessonRef
    ? 'lesson'
    : focusedDate
      ? 'daily'
      : 'timeline';

  const viewKey = computeBrowsingViewKey({
    activeLessonRef,
    focusedDate,
    selectedCourseFilter,
  });

  const scrollMap = { ...(saved.scrollMap || {}) };
  const scrollY =
    scrollMap[viewKey] !== undefined
      ? scrollMap[viewKey]
      : view === saved.view
        ? saved.scrollY
        : 0;

  return {
    view,
    selectedCourseFilter,
    focusedDate,
    activeLessonRef,
    scrollY,
    scrollMap,
    updatedAt: saved.updatedAt,
  };
}

export function loadBrowsingStateFromLocalStorage(): LastBrowsingState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_BROWSING_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeBrowsingState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveBrowsingStateToLocalStorage(state: LastBrowsingState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_BROWSING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}
