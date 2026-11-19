import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Archive,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Calendar,
  Clock,
  FolderCog,
  FolderOpen,
  FolderSync,
  ListChecks,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  AppSettings,
  Course,
  CourseGenerationMode,
  LastBrowsingState,
  PromptModuleToggles,
  StudyStats,
} from './types';
import type { PromptPresetItem } from './prompts/promptLibrary';
import {
  buildDateTimeline,
  formatChineseDateLabel,
  getEvaluatedSectionMinutes,
  getSlotExerciseSubmission,
  getTodayDateString,
  resolveSlotPdfSegments,
} from './utils/learningLogic';
import {
  computeBrowsingViewKey,
  loadBrowsingStateFromLocalStorage,
  reconcileBrowsingStateWithCourses,
  saveBrowsingStateToLocalStorage,
  selectNewestBrowsingState,
} from './utils/browsingState';
import { AddCourseModal } from './components/AddCourseModal';
import { BrandShowcaseModal } from './components/BrandShowcaseModal';
import type { OutlineWorkbenchStep } from './components/CourseOutlineModal';
import { DailyFocusView } from './components/DailyFocusView';
import { DeleteCourseModal } from './components/DeleteCourseModal';
import { SettingsModal } from './components/SettingsModal';
import { WelcomeModal } from './components/WelcomeModal';
import { readApiJson } from './utils/fileExtractor';
import { renderInlineMathWithLatex } from './utils/markdownMath';

const LessonView = React.lazy(() => import('./components/LessonView').then(({ LessonView }) => ({ default: LessonView })));
const CourseOutlineModal = React.lazy(() => import('./components/CourseOutlineModal').then(({ CourseOutlineModal }) => ({ default: CourseOutlineModal })));

const DEFAULT_MODULES: PromptModuleToggles = {
  problemIntroduction: true,
  intuitionToDefinition: true,
  knowledgeConnection: true,
  continuousDerivation: true,
  confusionComparison: true,
  stagedDiagrams: true,
  workedExamples: true,
  heuristicQuestions: true,
  progressiveExercises: true,
  reverseExplanationCheck: true,
  noCodeForNonCS: true,
};

const DEFAULT_SETTINGS: AppSettings = {
  providerMode: 'builtin_gemini',
  apiBaseUrl: 'https://api.openai.com/v1',
  modelName: 'gemini-3.8-flash',
  hasCustomApiKey: false,
  hasBuiltinGeminiKey: true,
  defaultLearnerLevel: 'intermediate',
  defaultLearnerBaseline: 'partial_base',
  defaultCustomLearnerBaseline: '',
  defaultLearningDepth: 'master_textbook',
  defaultCustomLearningDepth: '',
  showAdvancedWorkflowDetails: false,
  showContentCategoryBadges: false,
  promptModules: DEFAULT_MODULES,
  syllabusSystemPrompt: '',
  courseSystemPrompt: '',
  englishSystemPrompt: '',
  customTeachingSupplement: '',
};

const MODE_LABELS: Record<CourseGenerationMode, string> = {
  api: 'API 自动生成',
  agent: 'Agent 课件模式',
  chat: 'Chat 课件模式',
};

const WELCOME_STORAGE_KEY = 'learn_everything_welcomed_v1';
const DEFAULT_MODE_STORAGE_KEY = 'learn_everything_default_mode_v1';
const OUTLINE_MODAL_STORAGE_KEY = 'learn_everything_outline_modal_state_v1';

type OutlineModalState = {
  courseId: string;
  step: OutlineWorkbenchStep;
  dayIndex?: number;
};

const VALID_OUTLINE_STEPS: ReadonlySet<OutlineWorkbenchStep> = new Set([
  'outline',
  'split_vocab',
  'lessons',
  'files',
]);

function loadOutlineModalStateFromLocalStorage(): OutlineModalState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(OUTLINE_MODAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.courseId !== 'string' ||
      !parsed.courseId.trim() ||
      !VALID_OUTLINE_STEPS.has(parsed.step)
    ) {
      return null;
    }
    const dayIndex =
      parsed.dayIndex !== undefined &&
      parsed.dayIndex !== null &&
      Number.isFinite(Number(parsed.dayIndex)) &&
      Number(parsed.dayIndex) >= 1
        ? Math.round(Number(parsed.dayIndex))
        : undefined;
    return {
      courseId: parsed.courseId.trim(),
      step: parsed.step as OutlineWorkbenchStep,
      ...(dayIndex !== undefined ? { dayIndex } : {}),
    };
  } catch {
    return null;
  }
}

function saveOutlineModalStateToLocalStorage(state: OutlineModalState | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!state) {
      window.localStorage.removeItem(OUTLINE_MODAL_STORAGE_KEY);
    } else {
      window.localStorage.setItem(OUTLINE_MODAL_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // ignore storage quota errors
  }
}

const EMPTY_STUDY_STATS: StudyStats = {
  totalSeconds: 0,
  secondsByDate: {},
  secondsByCourse: {},
};

export default function App() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [promptPresets, setPromptPresets] = useState<PromptPresetItem[]>([]);
  const [studyStats, setStudyStats] = useState<StudyStats>(EMPTY_STUDY_STATS);
  const [liveStudySeconds, setLiveStudySeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isScanningDisk, setIsScanningDisk] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const initialBrowsingRef = useRef<LastBrowsingState | null>(
    loadBrowsingStateFromLocalStorage()
  );

  const [selectedCourseFilter, setSelectedCourseFilter] = useState<string>(
    () => initialBrowsingRef.current?.selectedCourseFilter || 'all'
  );
  const [focusedDate, setFocusedDate] = useState<string | null>(
    () => initialBrowsingRef.current?.focusedDate || null
  );

  const [preferredMode, setPreferredMode] = useState<CourseGenerationMode>(() => {
    try {
      const saved = window.localStorage.getItem(DEFAULT_MODE_STORAGE_KEY);
      if (saved === 'api' || saved === 'agent' || saved === 'chat') return saved;
    } catch {
      // ignore storage unavailability
    }
    return 'chat';
  });
  const [isWelcomeOpen, setIsWelcomeOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(WELCOME_STORAGE_KEY) !== '1';
    } catch {
      return false;
    }
  });

  const [isAddCourseOpen, setIsAddCourseOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBrandShowcaseOpen, setIsBrandShowcaseOpen] = useState(false);
  const [outlineModalState, setOutlineModalState] = useState<OutlineModalState | null>(() =>
    loadOutlineModalStateFromLocalStorage()
  );
  useEffect(() => {
    saveOutlineModalStateToLocalStorage(outlineModalState);
  }, [outlineModalState]);
  const [deleteTargetCourseId, setDeleteTargetCourseId] = useState<string | null>(null);
  const [scheduleCourseId, setScheduleCourseId] = useState<string | null>(null);
  const [isAllCoursesModalOpen, setIsAllCoursesModalOpen] = useState(false);

  useEffect(() => {
    if (!scheduleCourseId) return;
    const closeSchedule = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setScheduleCourseId(null);
    };
    window.addEventListener('keydown', closeSchedule);
    return () => window.removeEventListener('keydown', closeSchedule);
  }, [scheduleCourseId]);


  const [activeLessonRef, setActiveLessonRef] = useState<{
    courseId: string;
    dayIndex: number;
  } | null>(() => initialBrowsingRef.current?.activeLessonRef || null);

  const [lastBrowsingState, setLastBrowsingState] = useState<LastBrowsingState | null>(
    () => initialBrowsingRef.current
  );
  const scrollMapRef = useRef<Record<string, number>>({
    ...(initialBrowsingRef.current?.scrollMap || {}),
  });
  const isRestoringScrollRef = useRef<boolean>(true);
  const syncBrowsingTimerRef = useRef<number | null>(null);
  const latestBrowsingPayloadRef = useRef<LastBrowsingState | null>(
    initialBrowsingRef.current
  );

  const [viewTransition, setViewTransition] = useState<{
    direction: 'zoom-in' | 'zoom-out';
    origin: string;
  }>({ direction: 'zoom-in', origin: '50% 42%' });
  const [focusTarget, setFocusTarget] = useState<{
    kind: 'date' | 'lesson';
    key: string;
  } | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const mainHeaderRef = useRef<HTMLElement | null>(null);
  const todayRowRef = useRef<HTMLDivElement | null>(null);
  const userScrolledTimelineRef = useRef<boolean>(false);
  const lastAnchoredKeyRef = useRef<string>('');

  useEffect(() => {
    return () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
      }
    };
  }, []);

  // Lightweight global cursor proximity glow for .glow-border elements
  useEffect(() => {
    let rafId = 0;
    let lastX = -9999;
    let lastY = -9999;
    const RADIUS = 220;

    const updateGlows = () => {
      rafId = 0;
      const targets = document.querySelectorAll<HTMLElement>('.glow-border');
      for (let i = 0; i < targets.length; i++) {
        const el = targets[i];
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const dx =
          lastX < rect.left ? rect.left - lastX : lastX > rect.right ? lastX - rect.right : 0;
        const dy =
          lastY < rect.top ? rect.top - lastY : lastY > rect.bottom ? lastY - rect.bottom : 0;
        const near = dx * dx + dy * dy <= RADIUS * RADIUS;
        if (near) {
          el.style.setProperty('--gx', `${(lastX - rect.left).toFixed(1)}px`);
          el.style.setProperty('--gy', `${(lastY - rect.top).toFixed(1)}px`);
          el.style.setProperty('--go', '1');
        } else if (el.style.getPropertyValue('--go') === '1') {
          el.style.setProperty('--go', '0');
        }
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!rafId) {
        rafId = window.requestAnimationFrame(updateGlows);
      }
    };

    const handlePointerLeave = () => {
      lastX = -9999;
      lastY = -9999;
      const targets = document.querySelectorAll<HTMLElement>('.glow-border');
      for (let i = 0; i < targets.length; i++) {
        if (targets[i].style.getPropertyValue('--go') === '1') {
          targets[i].style.setProperty('--go', '0');
        }
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerleave', handlePointerLeave);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const captureZoomOrigin = (e?: React.MouseEvent): string => {
    if (!e?.currentTarget || typeof window === 'undefined' || !window.innerWidth || !window.innerHeight) {
      return '50% 42%';
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const xPct = Math.max(15, Math.min(85, ((rect.left + rect.width / 2) / window.innerWidth) * 100));
    const yPct = Math.max(15, Math.min(85, ((rect.top + rect.height / 2) / window.innerHeight) * 100));
    return `${xPct.toFixed(1)}% ${yPct.toFixed(1)}%`;
  };

  const navigateToDailyFocus = (date: string, e?: React.MouseEvent) => {
    if (focusTarget?.kind === 'date' && focusTarget.key === date) return;
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
    }
    const origin = captureZoomOrigin(e);
    setViewTransition({ direction: 'zoom-in', origin });
    setFocusTarget({ kind: 'date', key: date });
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null;
      setFocusTarget(null);
      setFocusedDate(date);
      setActiveLessonRef(null);
    }, 110);
  };

  const navigateToLesson = (
    courseId: string,
    dayIndex: number,
    e?: React.MouseEvent,
    immediate = false,
    source: 'timeline' | 'daily' | 'keep' = 'keep'
  ) => {
    const lessonKey = `${courseId}-${dayIndex}`;
    const origin = captureZoomOrigin(e);
    setViewTransition({ direction: 'zoom-in', origin });

    if (immediate) {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
      }
      setFocusTarget(null);
      if (source === 'timeline') setFocusedDate(null);
      setActiveLessonRef({ courseId, dayIndex });
      return;
    }

    if (focusTarget?.kind === 'lesson' && focusTarget.key === lessonKey) return;
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
    }
    setFocusTarget({ kind: 'lesson', key: lessonKey });
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null;
      setFocusTarget(null);
      if (source === 'timeline') setFocusedDate(null);
      setActiveLessonRef({ courseId, dayIndex });
    }, 110);
  };

  const navigateBackFromLesson = (e?: React.MouseEvent) => {
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
    }
    setFocusTarget(null);
    setViewTransition({
      direction: 'zoom-out',
      origin: e ? captureZoomOrigin(e) : '50% 42%',
    });
    setActiveLessonRef(null);
  };

  const navigateBackToTimeline = (e?: React.MouseEvent) => {
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
    }
    setFocusTarget(null);
    setViewTransition({
      direction: 'zoom-out',
      origin: e ? captureZoomOrigin(e) : '50% 42%',
    });
    setFocusedDate(null);
    setActiveLessonRef(null);
  };

  useEffect(() => {
    const fetchInitialState = async () => {
      try {
        const res = await fetch('/api/state');
        if (!res.ok) throw new Error('读取学习数据失败');
        if (res.ok) {
          const data = await res.json();
          const loadedCourses: Course[] = Array.isArray(data.courses) ? data.courses : [];
          setCourses(loadedCourses);
          setOutlineModalState((prev) =>
            prev && loadedCourses.some((c) => c.id === prev.courseId) ? prev : null
          );
          if (data.settings) {
            setSettings(data.settings);
          }
          if (Array.isArray(data.promptPresets)) {
            setPromptPresets(data.promptPresets);
          }
          if (data.studyStats) {
            setStudyStats(data.studyStats);
          }

          // Merge localStorage + server disk browsing state and reconcile against loaded courses
          const localSaved = loadBrowsingStateFromLocalStorage();
          const mergedSaved = selectNewestBrowsingState(
            localSaved,
            data.lastBrowsingState
          );
          const reconciled = reconcileBrowsingStateWithCourses(
            mergedSaved,
            loadedCourses
          );
          if (reconciled) {
            scrollMapRef.current = {
              ...scrollMapRef.current,
              ...(reconciled.scrollMap || {}),
            };
            setSelectedCourseFilter(reconciled.selectedCourseFilter);
            setFocusedDate(reconciled.focusedDate);
            setActiveLessonRef(reconciled.activeLessonRef);
            setLastBrowsingState(reconciled);
            latestBrowsingPayloadRef.current = reconciled;
            saveBrowsingStateToLocalStorage(reconciled);
          }
        }
      } catch (err) {
        console.error('Failed to load initial state:', err);
        setLoadError(true);
      } finally {
        setIsLoading(false);
      }
    };
    fetchInitialState();
  }, []);

  const handleCloseWelcome = (chosenMode: CourseGenerationMode, openCreateCourse: boolean) => {
    setPreferredMode(chosenMode);
    setIsWelcomeOpen(false);
    try {
      window.localStorage.setItem(WELCOME_STORAGE_KEY, '1');
      window.localStorage.setItem(DEFAULT_MODE_STORAGE_KEY, chosenMode);
    } catch {
      // ignore storage unavailability
    }
    if (openCreateCourse) {
      setIsAddCourseOpen(true);
    }
  };

  const filteredCourses = useMemo(() => {
    if (selectedCourseFilter === 'all') return courses;
    return courses.filter((c) => c.id === selectedCourseFilter);
  }, [courses, selectedCourseFilter]);

  const todayStr = useMemo(() => getTodayDateString(), []);

  const timeline = useMemo(
    () => buildDateTimeline(filteredCourses, todayStr),
    [filteredCourses, todayStr]
  );



  const outlineModalCourse = useMemo(
    () => courses.find((c) => c.id === outlineModalState?.courseId) || null,
    [courses, outlineModalState]
  );

  const deleteTargetCourse = useMemo(
    () => courses.find((c) => c.id === deleteTargetCourseId) || null,
    [courses, deleteTargetCourseId]
  );

  const scheduleCourse = useMemo(
    () => courses.find((c) => c.id === scheduleCourseId) || null,
    [courses, scheduleCourseId]
  );

  const scheduleCourseDays = useMemo(() => {
    if (!scheduleCourse) return [];
    const byDate = new Map<string, typeof scheduleCourse.dailyPlan>();
    for (const slot of scheduleCourse.dailyPlan) {
      const key = slot.date || scheduleCourse.startDate || todayStr;
      const list = byDate.get(key) || [];
      list.push(slot);
      byDate.set(key, list);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, slots], idx) => ({
        dayNumber: idx + 1,
        date,
        isToday: date === todayStr,
        slots: [...slots].sort((a, b) => a.dayIndex - b.dayIndex),
      }));
  }, [scheduleCourse, todayStr]);

  const handleCourseCreated = (newCourse: Course) => {
    setCourses((prev) => [newCourse, ...prev]);
    const hasPdf = newCourse.materials?.some(
      (m) => m.isPdf || m.fileName.toLowerCase().endsWith('.pdf')
    );
    // Step 1: Region split & local PDF slicing (or English vocab allocation) before Step 2 outline generation
    setOutlineModalState({
      courseId: newCourse.id,
      step: hasPdf || newCourse.category === 'english' ? 'split_vocab' : 'outline',
    });
  };

  const handleCourseUpdated = (updated: Course) => {
    setCourses((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleScanDiskCourses = async () => {
    setIsScanningDisk(true);
    try {
      const res = await fetch('/api/courses/scan-disk', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.courses)) {
          setCourses(data.courses);
        }
      }
    } catch {
      // ignore
    } finally {
      setIsScanningDisk(false);
    }
  };

  const handleRestoreBackupZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsRestoringBackup(true);
    setBackupFeedback(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64Zip = btoa(binary);

      const res = await fetch('/api/courses/restore-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, base64Zip }),
      });
      const data = await readApiJson<any>(res);
      if (Array.isArray(data.courses)) {
        setCourses(data.courses);
      }
      setBackupFeedback({
        ok: true,
        message: `已成功从备份恢复课程文件夹：courses/${data.restored?.folder || file.name}`,
      });
    } catch (err: any) {
      setBackupFeedback({
        ok: false,
        message: err?.message || '导入课程 ZIP 备份失败',
      });
    } finally {
      setIsRestoringBackup(false);
      e.target.value = '';
    }
  };

  const handleSwitchCourseMode = async (
    courseId: string,
    generationMode: CourseGenerationMode
  ) => {
    try {
      const res = await fetch(`/api/courses/${courseId}/mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationMode }),
      });
      if (res.ok) {
        const data = await res.json();
        handleCourseUpdated(data.course);
      }
    } catch {
      // ignore
    }
  };

  const handleConfirmDeleteCourse = async (courseId: string, deleteFolder: boolean) => {
    const res = await fetch(
      `/api/courses/${courseId}?deleteFolder=${deleteFolder ? 'true' : 'false'}`,
      { method: 'DELETE' }
    );
    if (res.ok) {
      setCourses((prev) => prev.filter((c) => c.id !== courseId));
      if (selectedCourseFilter === courseId) {
        setSelectedCourseFilter('all');
      }
      if (activeLessonRef?.courseId === courseId) {
        setActiveLessonRef(null);
      }

      if (outlineModalState?.courseId === courseId) {
        setOutlineModalState(null);
      }
      setDeleteTargetCourseId(null);
    }
  };

  const activeLessonCourse = activeLessonRef
    ? courses.find((c) => c.id === activeLessonRef.courseId) || null
    : null;
  const activeLessonSlot = activeLessonCourse?.dailyPlan.find(
    (d) => d.dayIndex === activeLessonRef?.dayIndex
  );
  const isShowingLesson = Boolean(activeLessonCourse && activeLessonSlot);
  const isShowingDailyFocus = !isShowingLesson && Boolean(focusedDate);
  const isTimelineVisible =
    !isLoading &&
    !isWelcomeOpen &&
    !isShowingLesson &&
    !isShowingDailyFocus &&
    timeline.length > 0;

  const currentViewKey = useMemo(
    () =>
      computeBrowsingViewKey({
        activeLessonRef: isShowingLesson ? activeLessonRef : null,
        focusedDate: !isShowingLesson && isShowingDailyFocus ? focusedDate : null,
        selectedCourseFilter,
      }),
    [isShowingLesson, activeLessonRef, isShowingDailyFocus, focusedDate, selectedCourseFilter]
  );

  const persistBrowsingState = useCallback(
    (scrollYValue: number, immediateServerSync = false) => {
      const cleanY = Math.max(0, Math.round(scrollYValue));
      scrollMapRef.current[currentViewKey] = cleanY;
      const nextState: LastBrowsingState = {
        view: isShowingLesson ? 'lesson' : isShowingDailyFocus ? 'daily' : 'timeline',
        selectedCourseFilter,
        focusedDate: isShowingLesson || isShowingDailyFocus ? focusedDate : null,
        activeLessonRef: isShowingLesson ? activeLessonRef : null,
        scrollY: cleanY,
        scrollMap: { ...scrollMapRef.current },
        updatedAt: new Date().toISOString(),
      };
      latestBrowsingPayloadRef.current = nextState;
      setLastBrowsingState(nextState);
      saveBrowsingStateToLocalStorage(nextState);

      if (syncBrowsingTimerRef.current !== null) {
        window.clearTimeout(syncBrowsingTimerRef.current);
        syncBrowsingTimerRef.current = null;
      }

      const sendToServer = () => {
        const payload = latestBrowsingPayloadRef.current;
        if (!payload) return;
        fetch('/api/browsing-state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {
          // ignore network errors
        });
      };

      if (immediateServerSync) {
        sendToServer();
      } else {
        syncBrowsingTimerRef.current = window.setTimeout(sendToServer, 320);
      }
    },
    [
      currentViewKey,
      isShowingLesson,
      isShowingDailyFocus,
      selectedCourseFilter,
      focusedDate,
      activeLessonRef,
    ]
  );

  const scrollToTodayRow = useCallback(
    (behavior: ScrollBehavior = 'auto', saveAfterScroll = false) => {
      if (!todayRowRef.current) return;
      const headerHeight = mainHeaderRef.current?.getBoundingClientRect().height || 66;
      const targetTop = Math.max(
        0,
        todayRowRef.current.getBoundingClientRect().top + window.scrollY - headerHeight - 6
      );
      window.scrollTo({ top: targetTop, behavior });
      if (saveAfterScroll) {
        window.setTimeout(() => {
          persistBrowsingState(window.scrollY, true);
        }, behavior === 'smooth' ? 320 : 40);
      }
    },
    [persistBrowsingState]
  );

  // Restore scroll position for the active view (or scroll to today on timeline if never visited before)
  useEffect(() => {
    if (isLoading || isWelcomeOpen) return;

    isRestoringScrollRef.current = true;
    const savedY = scrollMapRef.current[currentViewKey];
    const hasSavedScroll = typeof savedY === 'number' && Number.isFinite(savedY);

    let rafId = 0;
    let timer1: number | null = null;
    let timer2: number | null = null;
    let timer3: number | null = null;

    if (isShowingLesson || isShowingDailyFocus) {
      const targetY = hasSavedScroll ? Math.max(0, savedY) : 0;
      persistBrowsingState(targetY, false);
      window.scrollTo({ top: targetY, behavior: 'auto' });
      rafId = window.requestAnimationFrame(() => {
        window.scrollTo({ top: targetY, behavior: 'auto' });
      });
      timer1 = window.setTimeout(() => {
        window.scrollTo({ top: targetY, behavior: 'auto' });
      }, 110);
      timer2 = window.setTimeout(() => {
        window.scrollTo({ top: targetY, behavior: 'auto' });
      }, 210);
      timer3 = window.setTimeout(() => {
        window.scrollTo({ top: targetY, behavior: 'auto' });
        isRestoringScrollRef.current = false;
        persistBrowsingState(targetY, false);
      }, 340);
    } else if (isTimelineVisible) {
      const markUserScrolled = () => {
        userScrolledTimelineRef.current = true;
      };
      window.addEventListener('wheel', markUserScrolled, { passive: true });
      window.addEventListener('touchstart', markUserScrolled, { passive: true });

      if (hasSavedScroll) {
        userScrolledTimelineRef.current = true;
        const targetY = Math.max(0, savedY);
        persistBrowsingState(targetY, false);
        window.scrollTo({ top: targetY, behavior: 'auto' });
        rafId = window.requestAnimationFrame(() => {
          window.scrollTo({ top: targetY, behavior: 'auto' });
        });
        timer1 = window.setTimeout(() => {
          window.scrollTo({ top: targetY, behavior: 'auto' });
        }, 110);
        timer2 = window.setTimeout(() => {
          window.scrollTo({ top: targetY, behavior: 'auto' });
        }, 210);
        timer3 = window.setTimeout(() => {
          window.scrollTo({ top: targetY, behavior: 'auto' });
          isRestoringScrollRef.current = false;
          persistBrowsingState(targetY, false);
        }, 340);
      } else {
        const anchorKey = `${todayStr}|${selectedCourseFilter}|${courses.length}|${timeline.length}`;
        if (lastAnchoredKeyRef.current !== anchorKey) {
          lastAnchoredKeyRef.current = anchorKey;
          userScrolledTimelineRef.current = false;
          rafId = window.requestAnimationFrame(() => {
            if (!userScrolledTimelineRef.current) {
              scrollToTodayRow('auto');
            }
            timer1 = window.setTimeout(() => {
              if (!userScrolledTimelineRef.current) {
                scrollToTodayRow('auto');
              }
            }, 140);
            timer2 = window.setTimeout(() => {
              if (!userScrolledTimelineRef.current) {
                scrollToTodayRow('auto');
              }
              isRestoringScrollRef.current = false;
              persistBrowsingState(window.scrollY, false);
            }, 320);
          });
        } else {
          timer2 = window.setTimeout(() => {
            isRestoringScrollRef.current = false;
            persistBrowsingState(window.scrollY, false);
          }, 180);
        }
      }

      return () => {
        window.removeEventListener('wheel', markUserScrolled);
        window.removeEventListener('touchstart', markUserScrolled);
        if (rafId) window.cancelAnimationFrame(rafId);
        if (timer1 !== null) window.clearTimeout(timer1);
        if (timer2 !== null) window.clearTimeout(timer2);
        if (timer3 !== null) window.clearTimeout(timer3);
      };
    } else {
      isRestoringScrollRef.current = false;
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (timer1 !== null) window.clearTimeout(timer1);
      if (timer2 !== null) window.clearTimeout(timer2);
      if (timer3 !== null) window.clearTimeout(timer3);
    };
  }, [
    isLoading,
    isWelcomeOpen,
    currentViewKey,
    isShowingLesson,
    isShowingDailyFocus,
    isTimelineVisible,
    todayStr,
    selectedCourseFilter,
    courses.length,
    timeline.length,
    scrollToTodayRow,
    persistBrowsingState,
  ]);

  // Continuously record user scroll position in the active view
  useEffect(() => {
    if (isLoading || isWelcomeOpen) return;

    let scrollRaf = 0;
    const handleScroll = () => {
      if (isRestoringScrollRef.current || focusTarget !== null) return;
      if (scrollRaf) return;
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = 0;
        if (isRestoringScrollRef.current || focusTarget !== null) return;
        persistBrowsingState(window.scrollY, false);
      });
    };

    const handlePageHide = () => {
      if (focusTarget === null) {
        const y = isRestoringScrollRef.current
          ? (scrollMapRef.current[currentViewKey] ?? window.scrollY)
          : window.scrollY;
        persistBrowsingState(y, true);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('pagehide', handlePageHide);
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
    };
  }, [isLoading, isWelcomeOpen, focusTarget, persistBrowsingState]);

  const lessonScreenVariants = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const } },
    exit: { opacity: 0, y: 4, transition: { duration: 0.12 } },
  };

  const rootScreenVariants = {
    initial: (vt: { direction: 'zoom-in' | 'zoom-out' }) =>
      vt.direction === 'zoom-in'
        ? { opacity: 0, scale: 0.975 }
        : { opacity: 0, scale: 1.015 },
    animate: (vt: { direction: 'zoom-in' | 'zoom-out' }) => ({
      opacity: 1,
      scale: 1,
      transition: {
        duration: vt.direction === 'zoom-in' ? 0.2 : 0.18,
        ease: [0.16, 1, 0.3, 1] as const,
      },
      transitionEnd: {
        transform: 'none',
      },
    }),
    exit: (vt: { direction: 'zoom-in' | 'zoom-out' }) =>
      vt.direction === 'zoom-in'
        ? {
            opacity: 0,
            scale: 1.02,
            transition: { duration: 0.15, ease: [0.22, 1, 0.36, 1] as const },
          }
        : {
            opacity: 0,
            scale: 0.98,
            transition: { duration: 0.14, ease: [0.22, 1, 0.36, 1] as const },
          },
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-black text-neutral-100 flex flex-col overflow-x-clip">
        {!isWelcomeOpen && (
          <AnimatePresence mode="wait" custom={viewTransition}>
          {isShowingLesson && activeLessonCourse && activeLessonSlot ? (
            <motion.div
              key={`lesson-view-${activeLessonCourse.id}`}
              custom={viewTransition}
              variants={lessonScreenVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ transformOrigin: viewTransition.origin }}
              className="flex-1 flex flex-col"
            >
              <React.Suspense fallback={<div className="grid min-h-[100dvh] place-items-center bg-black"><p role="status" className="app-loading font-mono text-sm text-sky-300">正在加载课件…</p></div>}>
<LessonView
                course={activeLessonCourse}
                slot={activeLessonSlot}
                backLabel={focusedDate ? '返回当日详细页' : '返回时间轴'}
                onBack={navigateBackFromLesson}
                onSelectDayIndex={(dayIndex) =>
                  setActiveLessonRef({ courseId: activeLessonCourse.id, dayIndex })
                }
                onCourseUpdated={handleCourseUpdated}
                showLessonTools={Boolean(settings.showLessonTools)}
                showContentCategoryBadges={Boolean(settings.showContentCategoryBadges)}
                onOpenOutlineModal={(c, step) =>
                  setOutlineModalState({
                    courseId: c.id,
                    step: step || 'outline',
                  })
                }
                onLiveStudySecondsChange={setLiveStudySeconds}
                onStudyStatsUpdated={setStudyStats}
              />
</React.Suspense>
            </motion.div>
          ) : isShowingDailyFocus && focusedDate ? (
            <motion.div
              key="daily-focus-view"
              custom={viewTransition}
              variants={rootScreenVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ transformOrigin: viewTransition.origin }}
              className="flex-1 flex flex-col"
            >
              <DailyFocusView
                date={focusedDate}
                courses={filteredCourses}
                studyStats={studyStats}
                onChangeDate={(nextDate) => setFocusedDate(nextDate)}
                onBack={navigateBackToTimeline}
                onOpenLesson={(courseId, dayIndex, e) =>
                  navigateToLesson(courseId, dayIndex, e, true, 'daily')
                }
                onOpenOutlineModal={(courseId, step) =>
                  setOutlineModalState({ courseId, step })
                }
                onOpenAddCourse={() => setIsAddCourseOpen(true)}
              />
            </motion.div>
          ) : (
            <motion.div
              key="main-timeline-view"
              custom={viewTransition}
              variants={rootScreenVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ transformOrigin: viewTransition.origin }}
              className="flex-1 flex flex-col"
            >
            <motion.header
              ref={mainHeaderRef}
              animate={
                focusTarget
                  ? { opacity: 0.28, scale: 0.995 }
                  : { opacity: 1, scale: 1 }
              }
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="sticky top-0 z-30 bg-black/95 backdrop-blur-sm border-b border-neutral-900 px-4 sm:px-6 py-3 sm:py-4"
            >
              <div className="max-w-5xl mx-auto flex flex-wrap md:flex-nowrap items-center justify-between gap-x-3 gap-y-2 md:gap-6">
                <button
                  type="button"
                  onClick={() => setIsBrandShowcaseOpen(true)}
                  title="查看 Learn_everything 品牌与致谢"
                  className="inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 hover:text-sky-300 transition-colors cursor-pointer group"
                >
                  <svg
                    viewBox="0 0 28 28"
                    className="w-5 h-5 shrink-0 text-sky-400 group-hover:scale-110 transition-transform"
                    aria-hidden="true"
                  >
                    <circle
                      cx="14"
                      cy="14"
                      r="11.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeDasharray="4 2.5"
                      opacity="0.7"
                    />
                    <polygon
                      points="14,6 20.5,14 14,22 7.5,14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <circle cx="14" cy="14" r="2.2" fill="currentColor" />
                  </svg>
                  <span>Learn_everything</span>
                </button>

                <nav
                  aria-label="课程筛选"
                  className="flex items-center gap-2 sm:gap-3 text-xs text-neutral-400 overflow-x-auto max-w-full order-last md:order-none w-full md:w-auto"
                >
                  <button
                    type="button"
                    data-testid="view-all-courses-btn"
                    onClick={() => setIsAllCoursesModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-800 hover:border-sky-500/60 bg-neutral-950 text-neutral-200 hover:text-white font-medium transition-colors whitespace-nowrap shrink-0"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-sky-400" />
                    <span>查看全部课程 ({courses.length})</span>
                  </button>
                  {selectedCourseFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setSelectedCourseFilter('all')}
                      className="px-2.5 py-1.5 rounded-md border border-sky-500/40 bg-sky-950/30 text-sky-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
                    >
                      显示全部日期
                    </button>
                  )}
                </nav>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    data-testid="scroll-to-today-btn"
                    onClick={() => scrollToTodayRow('smooth', true)}
                    title="定位到今日课程（第一行）"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-neutral-800 hover:border-sky-400/60 text-neutral-300 hover:text-white rounded transition-colors whitespace-nowrap"
                  >
                    <Calendar className="w-3.5 h-3.5 text-sky-400" />
                    <span className="hidden sm:inline">回到今天</span>
                  </button>

                  <label
                    title="从导出的 .zip 课程备份恢复到本地 courses/ 文件夹"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">
                      {isRestoringBackup ? '恢复中...' : '导入备份 (.zip)'}
                    </span>
                    <input
                      type="file"
                      accept=".zip,application/zip"
                      disabled={isRestoringBackup}
                      onChange={handleRestoreBackupZip}
                      className="sr-only"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleScanDiskCourses}
                    disabled={isScanningDisk}
                    title="从本地 courses/ 文件夹扫描或恢复课程"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">
                      {isScanningDisk ? '扫描中...' : '同步本地文件夹'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsAddCourseOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>添加课程</span>
                  </button>
                </div>
              </div>
            </motion.header>

            <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 pb-24">
        {backupFeedback && (
          <div
            className={`mb-6 flex items-center justify-between gap-3 text-xs rounded px-4 py-2.5 border ${
              backupFeedback.ok
                ? 'border-neutral-700 bg-neutral-950 text-neutral-200'
                : 'border-red-900/60 bg-red-950/30 text-red-400'
            }`}
          >
            <span>{backupFeedback.message}</span>
            <button
              type="button"
              onClick={() => setBackupFeedback(null)}
              className="text-neutral-500 hover:text-white"
            >
              关闭
            </button>
          </div>
        )}
        {courses.length > 0 && (
          <motion.section
            animate={
              focusTarget
                ? { opacity: 0.28, scale: 0.995 }
                : { opacity: 1, scale: 1 }
            }
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            aria-label="已添加课程列表"
            className="mb-8 pb-6 border-b border-neutral-900 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-neutral-200">
                  当前课程 ({courses.length})
                </h2>
                <button
                  type="button"
                  onClick={() => setIsAllCoursesModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-neutral-700 hover:border-sky-500/60 bg-neutral-950 text-neutral-200 hover:text-white rounded-md transition-colors"
                >
                  <BookOpen className="w-3.5 h-3.5 text-sky-400" />
                  <span>查看全部课程</span>
                </button>
              </div>
              {selectedCourseFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setSelectedCourseFilter('all')}
                  className="text-xs text-sky-400 hover:text-sky-300 underline underline-offset-4"
                >
                  取消单课筛选，显示全部日程
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {courses.slice(0, 4).map((course, cIdx) => {
                const generatedCount = course.dailyPlan.filter((d) => Boolean(d.lesson)).length;
                const totalSections = course.dailyPlan.length;
                const splitRegions = course.pdfSplitPlan || [];
                const totalRegions = splitRegions.length;
                const slicedRegionsCount = splitRegions.filter(
                  (r) => r.status === 'sliced' || Boolean(r.segmentRelPath || r.segmentFileName)
                ).length;
                const coveredRegionSet = new Set<string>();
                for (const d of course.dailyPlan) {
                  for (const seg of resolveSlotPdfSegments(d, splitRegions)) {
                    coveredRegionSet.add(seg.sectionId);
                  }
                }
                const boundSectionsCount = course.dailyPlan.filter(
                  (d) =>
                    resolveSlotPdfSegments(d, splitRegions).length > 0 || Boolean(d.pdfSegment)
                ).length;
                const hasPdf = course.materials?.some(
                  (m) => m.isPdf || m.fileName.toLowerCase().endsWith('.pdf')
                );
                const pdfStatusText = hasPdf
                  ? totalRegions > 0
                    ? ` · 已切分 ${slicedRegionsCount}/${totalRegions} 个 PDF 区域${
                        totalSections > 0
                          ? `（已覆盖 ${coveredRegionSet.size}/${totalRegions} 个 · ${boundSectionsCount}/${totalSections} 讲）`
                          : ''
                      }`
                    : totalSections > 0
                      ? ` · 已关联 ${boundSectionsCount}/${totalSections} 讲 PDF`
                      : ' · 待切分 PDF 区域'
                  : '';
                const mode: CourseGenerationMode = course.generationMode || 'api';

                return (
                  <motion.div
                    key={course.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(cIdx * 0.02, 0.1),
                      duration: 0.18,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className={`glow-border border rounded p-3.5 flex flex-col justify-between gap-3 transition-colors ${
                      selectedCourseFilter === course.id
                        ? 'border-neutral-600 bg-neutral-950'
                        : 'border-neutral-900 bg-black hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className="space-y-1 cursor-pointer flex-1 min-w-0 group"
                        onClick={() => setScheduleCourseId(course.id)}
                        title={`点击按天查看《${course.name}》学习日程`}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400 font-mono">
                          <span className="text-white group-hover:text-sky-300 font-sans font-medium text-sm truncate transition-colors">
                            {course.name}
                          </span>
                          <span className="text-[11px] text-sky-400/80 opacity-80 group-hover:opacity-100">
                            按天日程 →
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{course.durationDays} 天计划</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {totalSections > 0
                              ? `已生成 ${generatedCount}/${totalSections} 讲`
                              : '待生成大纲'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              course.outlineConfirmed ? 'text-neutral-200' : 'text-neutral-500'
                            }
                          >
                            {course.outlineConfirmed ? '目录已确认' : '待确认目录'}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 truncate">
                          目标：{course.goal}
                        </p>
                        <p className="text-xs text-neutral-600 font-mono truncate">
                          存储目录：{course.courseDirPath || `courses/${course.folderName}/`}
                          {pdfStatusText}
                        </p>
                        {course.englishConfig && (
                          <p className="text-xs text-neutral-500 font-mono truncate">
                            词库：{course.englishConfig.targetBankName} ({course.englishConfig.totalTargetCount}) − 排除 ({course.englishConfig.excludedCount}) = 待学 {course.englishConfig.effectiveWords.length} 词 · 每节 {course.englishConfig.dailyWordCount || 20} 词
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setDeleteTargetCourseId(course.id)}
                        aria-label={`删除课程 ${course.name}`}
                        className="p-1.5 text-neutral-500 hover:text-red-400 transition-colors shrink-0"
                        title="删除该课程"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-900 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-neutral-500">生成方式：</span>
                        <select
                          aria-label={`${course.name} 课件生成方式`}
                          value={mode}
                          onChange={(e) =>
                            handleSwitchCourseMode(
                              course.id,
                              e.target.value as CourseGenerationMode
                            )
                          }
                          className="bg-black border border-neutral-800 hover:border-neutral-600 rounded px-2 py-1 text-xs text-neutral-200 focus:outline-none"
                        >
                          <option value="api">API 自动生成</option>
                          <option value="agent">Agent 课件模式</option>
                          <option value="chat">Chat 课件模式</option>
                        </select>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setOutlineModalState({
                              courseId: course.id,
                              step: course.outlineConfirmed
                                ? 'lessons'
                                : hasPdf || course.category === 'english'
                                  ? 'split_vocab'
                                  : 'outline',
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 bg-neutral-950 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap"
                        >
                          <ListChecks className="w-3 h-3" />
                          <span>
                            {course.outlineConfirmed
                              ? '课程工作台 (逐节 / 切分 / 大纲)'
                              : '切分区域与大纲设置'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setOutlineModalState({
                              courseId: course.id,
                              step: 'files',
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors whitespace-nowrap"
                        >
                          <FolderCog className="w-3 h-3" />
                          <span>文件管理</span>
                        </button>

                        <a
                          href={`/api/courses/${course.id}/backup`}
                          download={`${course.folderName || course.name}-backup.zip`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors whitespace-nowrap"
                        >
                          <Archive className="w-3 h-3" />
                          <span>导出备份</span>
                        </a>


                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.section>
        )}

        <section aria-label="每日学习时间轴" className="relative pb-[68vh]">
          {loadError ? (
            <button type="button" onClick={() => window.location.reload()}>读取学习数据失败，点击重试</button>
          ) : isLoading ? (
            <div role="status" className="app-loading py-12 text-xs text-neutral-500 font-mono">
              正在读取本地学习数据…
            </div>
          ) : (
            <div className="divide-y divide-neutral-900/80">
              {timeline.map((entry, idx) => {
                const { monthDay, weekday, year } = formatChineseDateLabel(entry.date);
                const isDateFocused =
                  focusTarget?.kind === 'date' && focusTarget.key === entry.date;
                const rowContainsFocusedLesson =
                  focusTarget?.kind === 'lesson' &&
                  entry.items.some(
                    ({ course, slot }) =>
                      `${course.id}-${slot.dayIndex}` === focusTarget.key
                  );
                const isRowBlurred = Boolean(
                  focusTarget && !isDateFocused && !rowContainsFocusedLesson
                );
                const totalSections = entry.items.length;
                const readySections = entry.items.filter(({ slot }) =>
                  Boolean(slot.lesson)
                ).length;
                const completedSections = entry.items.filter(({ course, slot }) =>
                  Boolean(getSlotExerciseSubmission(course, slot))
                ).length;
                const completionPercent =
                  totalSections > 0
                    ? Math.round((completedSections / totalSections) * 100)
                    : 0;
                const evaluatedDayMinutes = entry.items.reduce(
                  (sum, { slot }) => sum + (getEvaluatedSectionMinutes(slot) || 0),
                  0
                );
                const unassessedCount = entry.items.filter(
                  ({ slot }) => getEvaluatedSectionMinutes(slot) === undefined
                ).length;

                return (
                  <motion.div
                    key={entry.date}
                    ref={entry.isToday ? todayRowRef : undefined}
                    data-today-row={entry.isToday ? 'true' : undefined}
                    initial={{ opacity: 0, y: 8 }}
                    animate={
                      isRowBlurred
                        ? { opacity: 0.25, y: 0, scale: 0.99 }
                        : isDateFocused
                          ? { opacity: 1, y: 0, scale: 1.01 }
                          : { opacity: 1, y: 0, scale: 1 }
                    }
                    transition={{
                      delay: focusTarget ? 0 : Math.min(idx * 0.015, 0.12),
                      duration: 0.16,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className={`grid grid-cols-1 md:grid-cols-[190px_1fr] gap-3 md:gap-6 py-4 items-stretch ${
                      entry.isToday
                        ? 'scroll-mt-20 border-l-2 border-l-sky-400/80 pl-3 -ml-3'
                        : ''
                    }`}
                  >
                    <motion.button
                      type="button"
                      animate={
                        focusTarget?.kind === 'lesson' && rowContainsFocusedLesson
                          ? { opacity: 0.25 }
                          : { opacity: 1 }
                      }
                      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                      onClick={(e) => navigateToDailyFocus(entry.date, e)}
                      title={`点击进入 ${entry.date} 当日详细页`}
                      className={`glow-border group text-left flex md:flex-col items-center md:items-start justify-between md:justify-center gap-1.5 rounded-lg px-3.5 py-3 border transition-all duration-150 cursor-pointer md:h-full ${
                        isDateFocused
                          ? 'border-sky-400/75 bg-sky-950/25 shadow-[0_0_24px_-12px_rgba(56,189,248,0.45)]'
                          : entry.isToday
                            ? 'border-sky-500/50 bg-sky-950/15 hover:border-sky-400/75 hover:bg-sky-950/25 shadow-[0_0_20px_-12px_rgba(56,189,248,0.35)]'
                            : 'border-neutral-900 bg-neutral-950/45 hover:border-neutral-700 hover:bg-neutral-900/60'
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span
                          className={`font-display text-lg font-bold tracking-tight transition-colors group-hover:text-sky-300 ${
                            entry.isToday ? 'text-white' : 'text-neutral-100'
                          }`}
                        >
                          {monthDay}
                        </span>
                        <span className="text-xs text-neutral-400">{weekday}</span>
                        {entry.isToday && (
                          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/40 text-sky-300">
                            今日
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-neutral-500 group-hover:text-neutral-300 transition-colors">
                        <span className="font-mono">
                          {entry.date} ({year})
                        </span>
                        <ArrowUpRight className="w-3.5 h-3.5 opacity-55 group-hover:opacity-100 text-sky-400 transition-opacity" />
                      </div>
                      {entry.isToday &&
                        idx > 0 &&
                        timeline.slice(0, idx).some((d) => d.items.length > 0) && (
                        <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-mono text-neutral-600 pt-0.5">
                          <ArrowUp className="w-3 h-3" />
                          <span>向上滚动查看先前课程</span>
                        </span>
                      )}
                    </motion.button>

                    <div className="flex">
                      {totalSections === 0 ? (
                        entry.isToday && courses.length === 0 ? (
                          <div className="w-full border border-neutral-900 rounded-lg p-5 bg-neutral-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <p className="text-sm text-neutral-200">
                                暂无课程安排
                              </p>
                              <p className="text-xs text-neutral-500">
                                点击右上角“添加课程”，提交学习资料与目标期限：1. 由 LLM 确定 PDF 划分区域并本地脚本切割（或英语词库分配）；2. 由 LLM 基于切分区域生成并确认课程大纲；3. 按目录逐节生成课件。
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setIsAddCourseOpen(true)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>添加第一门课程</span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center text-xs text-neutral-700 py-1 select-none">
                            当日无课程安排
                          </div>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => navigateToDailyFocus(entry.date, e)}
                          title={`点击进入 ${entry.date} 当日详细页`}
                          className={`glow-border group w-full h-full text-left rounded-lg border px-4 py-3.5 transition-all duration-150 cursor-pointer flex flex-col justify-between gap-3 ${
                            isDateFocused
                              ? 'border-sky-400/75 bg-sky-950/20 shadow-[0_0_24px_-12px_rgba(56,189,248,0.4)]'
                              : entry.isToday
                                ? 'border-sky-500/45 bg-neutral-950/85 hover:border-sky-400/75 hover:bg-sky-950/15 shadow-[0_0_20px_-14px_rgba(56,189,248,0.35)]'
                                : 'border-neutral-800/90 bg-neutral-950/65 hover:border-neutral-600 hover:bg-neutral-900/65'
                          }`}
                        >
                          <div className="grid grid-cols-3 gap-3 sm:gap-6 items-start">
                            <div className="min-w-0 space-y-1">
                              <div className="text-[11px] text-neutral-500">
                                当日课程
                              </div>
                              <div className="text-sm sm:text-base font-semibold text-neutral-100 font-mono tabular-nums">
                                {totalSections} 节
                              </div>
                              <div className="text-[11px] font-mono text-neutral-500 tabular-nums">
                                课件就绪 {readySections}/{totalSections}
                              </div>
                            </div>

                            <div className="min-w-0 space-y-1">
                              <div className="text-[11px] text-neutral-500">
                                预计时长
                              </div>
                              <div className="text-sm sm:text-base font-semibold text-neutral-100 font-mono tabular-nums">
                                {evaluatedDayMinutes > 0
                                  ? `${evaluatedDayMinutes} 分钟`
                                  : '待评估'}
                              </div>
                              <div className="text-[11px] font-mono text-neutral-500 truncate">
                                {unassessedCount > 0
                                  ? evaluatedDayMinutes > 0
                                    ? `另有 ${unassessedCount} 节待评估`
                                    : `${unassessedCount} 节待评估学时`
                                  : '已全部评估'}
                              </div>
                            </div>

                            <div className="min-w-0 space-y-1">
                              <div className="text-[11px] text-neutral-500">
                                已完成小节
                              </div>
                              <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
                                <span
                                  className={`text-sm sm:text-base font-semibold ${
                                    completedSections === totalSections
                                      ? 'text-emerald-400'
                                      : completedSections > 0
                                        ? 'text-sky-300'
                                        : 'text-neutral-100'
                                  }`}
                                >
                                  {completedSections}/{totalSections}
                                </span>
                                <span className="text-[11px] text-neutral-400">
                                  {completionPercent}%
                                </span>
                              </div>
                              <div className="inline-flex items-center gap-1 text-[11px] font-mono text-neutral-500 group-hover:text-sky-300 transition-colors">
                                <span>详情</span>
                                <ArrowUpRight className="w-3 h-3 opacity-70 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </div>
                          </div>

                          <div
                            className="h-1 w-full rounded-full bg-neutral-900 overflow-hidden"
                            role="progressbar"
                            aria-valuenow={completionPercent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${entry.date} 实际学习完成进度 ${completionPercent}%`}
                          >
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                completedSections === totalSections
                                  ? 'bg-emerald-400'
                                  : completedSections > 0
                                    ? 'bg-sky-400'
                                    : 'bg-transparent'
                              }`}
                              style={{ width: `${completionPercent}%` }}
                            />
                          </div>
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>
      </main>
            </motion.div>
          )}
        </AnimatePresence>
        )}

        {/* Corner Settings Button (Bottom-Right, includes Learning Statistics) */}
        {!isWelcomeOpen && (
          <motion.div
            animate={
              focusTarget
                ? { opacity: 0.25 }
                : { opacity: 1 }
            }
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className={`fixed ${isShowingLesson ? 'bottom-20 right-6' : 'bottom-6 right-6'} z-40`}
          >
            <button
              type="button"
              data-testid="open-settings-btn"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="设置与学习统计"
              className="glow-border inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-black/95 hover:bg-neutral-900 text-neutral-200 hover:text-white border border-neutral-800 hover:border-neutral-600 rounded shadow-lg transition-colors whitespace-nowrap"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              <span>设置</span>
            </button>
          </motion.div>
        )}

        <WelcomeModal
          isOpen={isWelcomeOpen}
          initialMode={preferredMode}
          onClose={handleCloseWelcome}
        />

        <AddCourseModal
          isOpen={isAddCourseOpen}
          defaultLearnerLevel={settings.defaultLearnerLevel}
          defaultLearnerBaseline={settings.defaultLearnerBaseline}
          defaultCustomLearnerBaseline={settings.defaultCustomLearnerBaseline}
          defaultLearningDepth={settings.defaultLearningDepth}
          defaultCustomLearningDepth={settings.defaultCustomLearningDepth}
          defaultGenerationMode={preferredMode}
          onClose={() => setIsAddCourseOpen(false)}
          onCourseCreated={handleCourseCreated}
        />



        <React.Suspense fallback={<p role="status" className="app-loading">正在加载…</p>}>
<CourseOutlineModal
          isOpen={Boolean(outlineModalCourse)}
          course={outlineModalCourse}
          initialStep={outlineModalState?.step || 'outline'}
          initialDayIndex={outlineModalState?.dayIndex}
          showAdvancedWorkflowDetails={Boolean(settings.showAdvancedWorkflowDetails)}
          onOpenSettings={() => {
            setOutlineModalState(null);
            setIsSettingsOpen(true);
          }}
          onClose={() => setOutlineModalState(null)}
          onCourseUpdated={handleCourseUpdated}
          onOpenLesson={(courseId, dayIndex) => {
            setOutlineModalState(null);
            navigateToLesson(courseId, dayIndex, undefined, true);
          }}
          onStepOrDayChange={(step, dayIndex) =>
            setOutlineModalState((prev) =>
              prev
                ? prev.step === step && prev.dayIndex === dayIndex
                  ? prev
                  : { ...prev, step, dayIndex }
                : prev
            )
          }

        />
</React.Suspense>

        <DeleteCourseModal
          isOpen={Boolean(deleteTargetCourse)}
          course={deleteTargetCourse}
          onClose={() => setDeleteTargetCourseId(null)}
          onConfirmDelete={handleConfirmDeleteCourse}
        />

        <SettingsModal
          isOpen={isSettingsOpen}
          settings={settings}
          promptPresets={promptPresets}
          courses={courses}
          studyStats={studyStats}
          liveSessionSeconds={isShowingLesson ? liveStudySeconds : 0}
          lastBrowsingState={lastBrowsingState}
          onClose={() => setIsSettingsOpen(false)}
          onOpenWelcome={() => setIsWelcomeOpen(true)}
          onSettingsUpdated={(newSettings, newPresets) => {
            setSettings(newSettings);
            if (newPresets) setPromptPresets(newPresets);
          }}
        />

        <BrandShowcaseModal
          isOpen={isBrandShowcaseOpen}
          onClose={() => setIsBrandShowcaseOpen(false)}
        />

        {/* 全部课程总览模态框（更大、更清晰的卡片与操作入口） */}
        {isAllCoursesModalOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
            onClick={() => setIsAllCoursesModalOpen(false)}
          >
            <div
              className="w-full max-w-5xl max-h-[86vh] bg-[#07090d] border border-neutral-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-neutral-900 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-sky-400" />
                    <span>全部课程总览 ({courses.length})</span>
                  </h2>
                  <p className="text-xs text-neutral-400">
                    点击任意课程即可按天查看完整学习日程，或筛选主时间轴与进入工作台
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAllCoursesModalOpen(false);
                      setIsAddCourseOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded-md transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>添加课程</span>
                  </button>
                  <button
                    type="button"
                    aria-label="关闭全部课程总览"
                    onClick={() => setIsAllCoursesModalOpen(false)}
                    className="p-1.5 text-neutral-400 hover:text-white rounded-md hover:bg-neutral-900 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {courses.length === 0 ? (
                  <div className="py-16 text-center space-y-3">
                    <p className="text-sm text-neutral-300">当前还没有任何课程</p>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAllCoursesModalOpen(false);
                        setIsAddCourseOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded-md"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>添加第一门课程</span>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {courses.map((course) => {
                      const totalSections = course.dailyPlan.length;
                      const generatedCount = course.dailyPlan.filter((d) => Boolean(d.lesson)).length;
                      const completedCount = course.dailyPlan.filter((d) =>
                        Boolean(getSlotExerciseSubmission(course, d))
                      ).length;
                      const completedPct =
                        totalSections > 0 ? Math.round((completedCount / totalSections) * 100) : 0;
                      const readyPct =
                        totalSections > 0 ? Math.round((generatedCount / totalSections) * 100) : 0;
                      const dates = course.dailyPlan.map((d) => d.date).filter(Boolean).sort();
                      const dateRange =
                        dates.length > 0
                          ? `${dates[0]} ~ ${dates[dates.length - 1]}`
                          : `${course.startDate} 起（${course.durationDays} 天）`;

                      return (
                        <div
                          key={course.id}
                          onClick={() => {
                            setIsAllCoursesModalOpen(false);
                            setScheduleCourseId(course.id);
                          }}
                          className="group cursor-pointer border border-neutral-800 hover:border-sky-500/60 bg-black/70 hover:bg-neutral-950 rounded-xl p-5 space-y-4 transition-all"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <h3 className="text-base font-semibold text-white group-hover:text-sky-300 truncate transition-colors">
                                {course.name}
                              </h3>
                              <p className="text-xs text-neutral-400 line-clamp-2">{course.goal}</p>
                            </div>
                            <span className="shrink-0 text-[11px] font-mono px-2 py-0.5 rounded border border-neutral-800 bg-neutral-950 text-neutral-300">
                              {course.durationDays} 天计划
                            </span>
                          </div>

                          <div className="space-y-2 text-xs font-mono text-neutral-400">
                            <div className="flex items-center justify-between">
                              <span>日程范围：{dateRange}</span>
                              <span>
                                已学完 {completedCount}/{totalSections} · 已就绪 {generatedCount}/{totalSections}
                              </span>
                            </div>
                            <div className="h-1.5 w-full bg-neutral-900 rounded-full overflow-hidden flex">
                              <div
                                className="h-full bg-emerald-400 transition-all"
                                style={{ width: `${completedPct}%` }}
                                title={`已学完 ${completedPct}%`}
                              />
                              <div
                                className="h-full bg-sky-500/50 transition-all"
                                style={{ width: `${Math.max(0, readyPct - completedPct)}%` }}
                                title={`已就绪未学完 ${Math.max(0, readyPct - completedPct)}%`}
                              />
                            </div>
                          </div>

                          <div
                            className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-900"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setIsAllCoursesModalOpen(false);
                                setScheduleCourseId(course.id);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-sky-500/15 border border-sky-500/40 hover:border-sky-400 text-sky-200 rounded-md transition-colors"
                            >
                              <Calendar className="w-3.5 h-3.5" />
                              <span>按天查看日程</span>
                            </button>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCourseFilter(course.id);
                                  setIsAllCoursesModalOpen(false);
                                }}
                                className="px-2.5 py-1.5 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded-md transition-colors"
                              >
                                筛选时间轴
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsAllCoursesModalOpen(false);
                                  setOutlineModalState({
                                    courseId: course.id,
                                    step: course.outlineConfirmed ? 'lessons' : 'outline',
                                  });
                                }}
                                className="px-2.5 py-1.5 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded-md transition-colors"
                              >
                                课程工作台
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 单门课程按天查看日程模态框 */}
        {scheduleCourse && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
            onClick={() => setScheduleCourseId(null)}
          >
            <div
              data-testid="course-schedule-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="course-schedule-title"
              className="w-full max-w-4xl max-h-[88vh] bg-[#07090d] border border-neutral-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-neutral-900 flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="course-schedule-title" className="text-base font-semibold text-white truncate">
                      {scheduleCourse.name} · 按天日程
                    </h2>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded border border-sky-500/40 bg-sky-950/30 text-sky-300">
                      {scheduleCourse.durationDays} 天计划 · {scheduleCourse.dailyPlan.length} 节
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 truncate">{scheduleCourse.goal}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCourseFilter(scheduleCourse.id);
                      setScheduleCourseId(null);
                    }}
                    className="px-3 py-1.5 text-xs border border-neutral-700 hover:border-sky-500/60 text-neutral-200 hover:text-white rounded-md transition-colors"
                  >
                    只看此课时间轴
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = scheduleCourse.id;
                      const targetStep: OutlineWorkbenchStep = scheduleCourse.outlineConfirmed
                        ? 'lessons'
                        : 'outline';
                      setScheduleCourseId(null);
                      setOutlineModalState({ courseId: targetId, step: targetStep });
                    }}
                    className="px-3 py-1.5 text-xs bg-white text-black hover:bg-neutral-200 font-medium rounded-md transition-colors"
                  >
                    打开课程工作台
                  </button>
                  <button
                    type="button"
                    aria-label="关闭课程日程"
                    onClick={() => setScheduleCourseId(null)}
                    className="p-1.5 text-neutral-400 hover:text-white rounded-md hover:bg-neutral-900 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {courses.length > 1 && (
                <div className="px-6 py-2.5 border-b border-neutral-900/80 flex items-center gap-2 overflow-x-auto bg-black/40">
                  <span className="text-[11px] text-neutral-500 shrink-0">切换课程：</span>
                  {courses.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setScheduleCourseId(c.id)}
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                        c.id === scheduleCourse.id
                          ? 'border-sky-500/60 bg-sky-950/30 text-sky-200'
                          : 'border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-600'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}

              <div key={scheduleCourse.id} className="lesson-workbench-enter flex-1 overflow-y-auto p-6 space-y-4">
                {scheduleCourseDays.length === 0 ? (
                  <div className="py-12 text-center space-y-3 border border-dashed border-neutral-800 rounded-lg">
                    <p className="text-sm text-neutral-300">尚未确认目录与按天排期</p>
                    <button
                      type="button"
                      onClick={() => {
                        const targetId = scheduleCourse.id;
                        setScheduleCourseId(null);
                        setOutlineModalState({ courseId: targetId, step: 'outline' });
                      }}
                      className="px-3.5 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded-md"
                    >
                      前往生成并确认大纲
                    </button>
                  </div>
                ) : (
                  scheduleCourseDays.map((dayGroup) => {
                    const { monthDay, weekday } = formatChineseDateLabel(dayGroup.date);
                    const totalMins = dayGroup.slots.reduce(
                      (acc, s) => acc + (getEvaluatedSectionMinutes(s) || 0),
                      0
                    );
                    const doneCount = dayGroup.slots.filter((s) =>
                      Boolean(getSlotExerciseSubmission(scheduleCourse, s))
                    ).length;

                    return (
                      <div
                        key={dayGroup.date}
                        className={`rounded-lg border p-4 space-y-3 ${
                          dayGroup.isToday
                            ? 'border-sky-500/50 bg-sky-950/15'
                            : 'border-neutral-900 bg-black/50'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className="font-mono text-xs px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300">
                              第 {dayGroup.dayNumber} 天
                            </span>
                            <span className="text-sm font-semibold text-white">
                              {monthDay} · {weekday}
                            </span>
                            <span className="text-xs font-mono text-neutral-500">
                              {dayGroup.date}
                            </span>
                            {dayGroup.isToday && (
                              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/40 text-sky-300">
                                今日
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs font-mono text-neutral-400">
                            {totalMins > 0 && (
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-3 h-3 text-neutral-500" />
                                {totalMins} 分钟
                              </span>
                            )}
                            <span>
                              完成 {doneCount}/{dayGroup.slots.length} 节
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {dayGroup.slots.map((slot) => {
                            const hasLesson = Boolean(slot.lesson);
                            const isDone = Boolean(getSlotExerciseSubmission(scheduleCourse, slot));
                            const mins = getEvaluatedSectionMinutes(slot);
                            return (
                              <button
                                type="button"
                                key={`${slot.id}-${slot.dayIndex}`}
                                onClick={(event) => {
                                  const courseId = scheduleCourse.id;
                                  setScheduleCourseId(null);
                                  if (hasLesson) {
                                    navigateToLesson(courseId, slot.dayIndex, event, true);
                                  } else {
                                    setOutlineModalState({ courseId, step: 'lessons', dayIndex: slot.dayIndex });
                                  }
                                }}
                                className="block w-full min-w-0 text-left px-3.5 py-2.5 rounded-md border border-neutral-900 bg-neutral-950/60 hover:border-sky-500/60 focus-visible:outline-2 focus-visible:outline-sky-400 transition-colors"
                              >
                                <span className="block space-y-0.5 min-w-0">
                                  <span className="flex flex-wrap items-center gap-2">
                                    <span className="text-[11px] font-mono text-neutral-500">
                                      {slot.id || `sec-${String(slot.dayIndex).padStart(2, '0')}`}
                                    </span>
                                    <span
                                      className="text-xs sm:text-sm font-medium text-neutral-100 truncate [&>p]:m-0"
                                      dangerouslySetInnerHTML={{
                                        __html: renderInlineMathWithLatex(slot.title || ''),
                                      }}
                                    />
                                    {isDone ? (
                                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-700/60 text-emerald-300">
                                        已学完
                                      </span>
                                    ) : hasLesson ? (
                                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-950/50 border border-sky-700/50 text-sky-300">
                                        课件就绪
                                      </span>
                                    ) : slot.stage1Draft ? (
                                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-700/50 text-amber-300">
                                        阶段一已存
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-500">
                                        待生成
                                      </span>
                                    )}
                                    {mins !== undefined && (
                                      <span className="text-[11px] font-mono text-neutral-500">
                                        约 {mins} 分钟
                                      </span>
                                    )}
                                  </span>
                                  {slot.objective && (
                                    <span
                                      className="block text-xs text-neutral-500 truncate [&>p]:m-0"
                                      dangerouslySetInnerHTML={{
                                        __html: renderInlineMathWithLatex(slot.objective),
                                      }}
                                    />
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </MotionConfig>
  );
}
