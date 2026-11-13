import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BookOpen,
  FolderCog,
  FolderOpen,
  FolderSync,
  ListChecks,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AppSettings,
  Course,
  CourseGenerationMode,
  PromptModuleToggles,
} from './types';
import type { PromptPresetItem } from './prompts/promptLibrary';
import {
  buildDateTimeline,
  formatChineseDateLabel,
  getTodayDateString,
} from './utils/learningLogic';
import { AddCourseModal } from './components/AddCourseModal';
import { AgentModeModal } from './components/AgentModeModal';
import {
  CourseOutlineModal,
  type OutlineWorkbenchStep,
} from './components/CourseOutlineModal';
import { DeleteCourseModal } from './components/DeleteCourseModal';
import { LessonView } from './components/LessonView';
import { SettingsModal } from './components/SettingsModal';
import { stripAiCitationArtifacts } from './utils/coursewareParser';
import { renderInlineMathWithLatex } from './utils/markdownMath';

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
  showAdvancedWorkflowDetails: false,
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

export default function App() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [promptPresets, setPromptPresets] = useState<PromptPresetItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanningDisk, setIsScanningDisk] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [selectedCourseFilter, setSelectedCourseFilter] = useState<string>('all');

  const [isAddCourseOpen, setIsAddCourseOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [agentModalCourseId, setAgentModalCourseId] = useState<string | null>(null);
  const [outlineModalState, setOutlineModalState] = useState<{
    courseId: string;
    step: OutlineWorkbenchStep;
  } | null>(null);
  const [deleteTargetCourseId, setDeleteTargetCourseId] = useState<string | null>(null);

  const [activeLessonRef, setActiveLessonRef] = useState<{
    courseId: string;
    dayIndex: number;
  } | null>(null);

  const [generatingSlotKey, setGeneratingSlotKey] = useState<string | null>(null);

  useEffect(() => {
    const fetchInitialState = async () => {
      try {
        const res = await fetch('/api/state');
        if (res.ok) {
          const data = await res.json();
          setCourses(Array.isArray(data.courses) ? data.courses : []);
          if (data.settings) {
            setSettings(data.settings);
          }
          if (Array.isArray(data.promptPresets)) {
            setPromptPresets(data.promptPresets);
          }
        }
      } catch (err) {
        console.error('Failed to load initial state:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchInitialState();
  }, []);

  const filteredCourses = useMemo(() => {
    if (selectedCourseFilter === 'all') return courses;
    return courses.filter((c) => c.id === selectedCourseFilter);
  }, [courses, selectedCourseFilter]);

  const todayStr = useMemo(() => getTodayDateString(), []);

  const timeline = useMemo(
    () => buildDateTimeline(filteredCourses, todayStr),
    [filteredCourses, todayStr]
  );

  const agentModalCourse = useMemo(
    () => courses.find((c) => c.id === agentModalCourseId) || null,
    [courses, agentModalCourseId]
  );

  const outlineModalCourse = useMemo(
    () => courses.find((c) => c.id === outlineModalState?.courseId) || null,
    [courses, outlineModalState]
  );

  const deleteTargetCourse = useMemo(
    () => courses.find((c) => c.id === deleteTargetCourseId) || null,
    [courses, deleteTargetCourseId]
  );

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
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '导入课程备份失败');
      }
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
      if (agentModalCourseId === courseId) {
        setAgentModalCourseId(null);
      }
      if (outlineModalState?.courseId === courseId) {
        setOutlineModalState(null);
      }
      setDeleteTargetCourseId(null);
    }
  };

  const handleGenerateSlotOnTimeline = async (
    e: React.MouseEvent,
    course: Course,
    dayIndex: number
  ) => {
    e.stopPropagation();
    const key = `${course.id}-${dayIndex}`;
    setGeneratingSlotKey(key);
    try {
      const res = await fetch(`/api/courses/${course.id}/days/${dayIndex}/generate`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        handleCourseUpdated(data.course);
      }
    } finally {
      setGeneratingSlotKey(null);
    }
  };

  if (activeLessonRef) {
    const activeCourse = courses.find((c) => c.id === activeLessonRef.courseId);
    const activeSlot = activeCourse?.dailyPlan.find(
      (d) => d.dayIndex === activeLessonRef.dayIndex
    );
    if (activeCourse && activeSlot) {
      return (
        <>
          <LessonView
            course={activeCourse}
            slot={activeSlot}
            onBack={() => setActiveLessonRef(null)}
            onSelectDayIndex={(dayIndex) =>
              setActiveLessonRef({ courseId: activeCourse.id, dayIndex })
            }
            onCourseUpdated={handleCourseUpdated}
            onOpenAgentModal={(c) => setAgentModalCourseId(c.id)}
            onOpenOutlineModal={(c, step) =>
              setOutlineModalState({
                courseId: c.id,
                step: step || 'outline',
              })
            }
          />
          <AgentModeModal
            isOpen={Boolean(agentModalCourse)}
            course={agentModalCourse}
            onClose={() => setAgentModalCourseId(null)}
            onCourseUpdated={handleCourseUpdated}
          />
          <CourseOutlineModal
            isOpen={Boolean(outlineModalCourse)}
            course={outlineModalCourse}
            initialStep={outlineModalState?.step || 'outline'}
            showAdvancedWorkflowDetails={Boolean(settings.showAdvancedWorkflowDetails)}
            onOpenSettings={() => {
              setOutlineModalState(null);
              setIsSettingsOpen(true);
            }}
            onClose={() => setOutlineModalState(null)}
            onCourseUpdated={handleCourseUpdated}
            onOpenLesson={(courseId, dayIndex) => {
              setOutlineModalState(null);
              setActiveLessonRef({ courseId, dayIndex });
            }}
            onOpenAgentModal={(c) => {
              setOutlineModalState(null);
              setAgentModalCourseId(c.id);
            }}
          />
        </>
      );
    }
  }

  return (
    <div className="min-h-screen bg-black text-neutral-100 flex flex-col">
      <header className="sticky top-0 z-30 bg-black/95 border-b border-neutral-900 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setSelectedCourseFilter('all');
            }}
            className="text-base font-semibold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Learn_everything
          </a>

          <nav
            aria-label="课程筛选"
            className="hidden md:flex items-center gap-5 text-xs text-neutral-400 overflow-x-auto"
          >
            <button
              type="button"
              onClick={() => setSelectedCourseFilter('all')}
              className={`transition-colors whitespace-nowrap shrink-0 ${
                selectedCourseFilter === 'all'
                  ? 'text-white underline underline-offset-4'
                  : 'hover:text-neutral-200'
              }`}
            >
              全部日期安排 ({courses.length})
            </button>
            {courses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCourseFilter(c.id)}
                className={`transition-colors whitespace-nowrap shrink-0 truncate max-w-[160px] ${
                  selectedCourseFilter === c.id
                    ? 'text-white underline underline-offset-4'
                    : 'hover:text-neutral-200'
                }`}
              >
                {c.name}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
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
      </header>

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
          <section
            aria-label="已添加课程列表"
            className="mb-8 pb-6 border-b border-neutral-900 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-neutral-500">
                当前课程 ({courses.length})
              </h2>
              {selectedCourseFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setSelectedCourseFilter('all')}
                  className="text-xs text-neutral-400 hover:text-white underline underline-offset-4"
                >
                  显示全部课程
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {courses.map((course) => {
                const generatedCount = course.dailyPlan.filter((d) => Boolean(d.lesson)).length;
                const segmentedCount = course.dailyPlan.filter((d) => Boolean(d.pdfSegment)).length;
                const hasPdf = course.materials?.some(
                  (m) => m.isPdf || m.fileName.toLowerCase().endsWith('.pdf')
                );
                const mode: CourseGenerationMode = course.generationMode || 'api';

                return (
                  <div
                    key={course.id}
                    className={`border rounded p-3.5 flex flex-col justify-between gap-3 transition-colors ${
                      selectedCourseFilter === course.id
                        ? 'border-neutral-600 bg-neutral-950'
                        : 'border-neutral-900 bg-black hover:border-neutral-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className="space-y-1 cursor-pointer flex-1 min-w-0"
                        onClick={() =>
                          setSelectedCourseFilter((prev) =>
                            prev === course.id ? 'all' : course.id
                          )
                        }
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400 font-mono">
                          <span className="text-white font-sans font-medium text-sm truncate">
                            {course.name}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{course.durationDays} 天计划</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            已生成 {generatedCount}/{course.durationDays} 讲
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
                          {hasPdf && ` · 已切分 ${segmentedCount}/${course.durationDays} 节 PDF`}
                        </p>
                        {course.englishConfig && (
                          <p className="text-xs text-neutral-500 font-mono truncate">
                            词库：{course.englishConfig.targetBankName} ({course.englishConfig.totalTargetCount}) − 排除 ({course.englishConfig.excludedCount}) = 待学 {course.englishConfig.effectiveWords.length} 词 · 每日 {course.englishConfig.dailyWordCount || 20} 词
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

                        {(mode === 'agent' || settings.showAdvancedWorkflowDetails) && (
                          <button
                            type="button"
                            onClick={() => setAgentModalCourseId(course.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors whitespace-nowrap"
                          >
                            <FolderSync className="w-3 h-3" />
                            <span>Agent 提示词与同步</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section aria-label="每日学习时间轴" className="relative">
          {isLoading ? (
            <div className="py-12 text-xs text-neutral-500 font-mono">
              正在读取本地学习数据...
            </div>
          ) : (
            <div className="divide-y divide-neutral-900/80">
              {timeline.map((entry) => {
                const { monthDay, weekday, year } = formatChineseDateLabel(entry.date);

                return (
                  <div
                    key={entry.date}
                    className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4 md:gap-8 py-5"
                  >
                    <div className="flex md:flex-col items-baseline justify-between md:justify-start gap-2">
                      <div className="flex items-baseline gap-2">
                        <span
                          className={`text-sm font-mono font-semibold ${
                            entry.isToday ? 'text-white' : 'text-neutral-300'
                          }`}
                        >
                          {monthDay}
                        </span>
                        <span className="text-xs text-neutral-500">{weekday}</span>
                        {entry.isToday && (
                          <span className="text-xs font-mono text-neutral-300 underline underline-offset-4">
                            今日
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-neutral-600">
                        {entry.date} ({year})
                      </span>
                    </div>

                    <div className="space-y-3">
                      {entry.items.length === 0 ? (
                        entry.isToday && courses.length === 0 ? (
                          <div className="border border-neutral-900 rounded p-5 bg-neutral-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                          <div className="text-xs text-neutral-700 py-1 select-none">
                            当日无课程安排
                          </div>
                        )
                      ) : (
                        entry.items.map(({ course, slot }) => {
                          const hasLesson = Boolean(slot.lesson);
                          const isGeneratingThis =
                            generatingSlotKey === `${course.id}-${slot.dayIndex}`;
                          const submission = course.exerciseSubmissions?.[slot.date];
                          const mode: CourseGenerationMode = course.generationMode || 'api';

                          return (
                            <div
                              key={`${course.id}-${slot.id || slot.dayIndex}`}
                              className="border border-neutral-800 hover:border-neutral-600 rounded p-4 bg-black transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveLessonRef({
                                    courseId: course.id,
                                    dayIndex: slot.dayIndex,
                                  })
                                }
                                className="text-left space-y-1.5 flex-1 min-w-0"
                              >
                                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400 font-mono">
                                  <span className="text-neutral-200 font-sans font-medium">
                                    {course.name}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{slot.id}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    第 {slot.dayIndex}/{course.durationDays} 天
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{MODE_LABELS[mode]}</span>
                                  <span aria-hidden="true">·</span>
                                  <span
                                    className={
                                      hasLesson ? 'text-neutral-200' : 'text-neutral-500'
                                    }
                                  >
                                    {hasLesson ? '课件已就绪' : '待生成/导入课件'}
                                  </span>
                                  {slot.pdfSegment && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-neutral-300">
                                        PDF p.{slot.pdfSegment.physicalStartPage}–{slot.pdfSegment.physicalEndPage}
                                      </span>
                                    </>
                                  )}
                                  {course.category === 'english' && slot.assignedWords && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-neutral-300">
                                        今日 {slot.assignedWords.length} 词
                                      </span>
                                    </>
                                  )}
                                  {submission && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-neutral-300">
                                        练习得分 {submission.score}/{submission.total}
                                      </span>
                                    </>
                                  )}
                                </div>

                                <div
                                  className="text-sm font-semibold text-white"
                                  dangerouslySetInnerHTML={{
                                    __html: renderInlineMathWithLatex(slot.title),
                                  }}
                                />

                                <p
                                  className="text-xs text-neutral-400 line-clamp-2"
                                  dangerouslySetInnerHTML={{
                                    __html: renderInlineMathWithLatex(slot.objective),
                                  }}
                                />

                                {slot.prerequisites && slot.prerequisites.length > 0 && (
                                  <div className="text-xs text-neutral-500">
                                    先修：
                                    <span
                                      dangerouslySetInnerHTML={{
                                        __html: renderInlineMathWithLatex(
                                          slot.prerequisites.join(' / ')
                                        ),
                                      }}
                                    />
                                  </div>
                                )}

                                {slot.keyTopics && slot.keyTopics.length > 0 && (
                                  <div className="text-xs text-neutral-500 pt-0.5">
                                    知识点：
                                    <span
                                      dangerouslySetInnerHTML={{
                                        __html: renderInlineMathWithLatex(
                                          slot.keyTopics.join(' / ')
                                        ),
                                      }}
                                    />
                                  </div>
                                )}
                              </button>

                              <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                                <button
                                  type="button"
                                  onClick={(e) =>
                                    handleGenerateSlotOnTimeline(
                                      e,
                                      course,
                                      slot.dayIndex
                                    )
                                  }
                                  disabled={isGeneratingThis}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors whitespace-nowrap disabled:opacity-50"
                                >
                                  <RefreshCw
                                    className={`w-3 h-3 ${
                                      isGeneratingThis ? 'animate-spin' : ''
                                    }`}
                                  />
                                  <span>
                                    {isGeneratingThis
                                      ? 'API 生成中...'
                                      : hasLesson
                                        ? 'API 重新生成'
                                        : 'API 生成课件'}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setActiveLessonRef({
                                      courseId: course.id,
                                      dayIndex: slot.dayIndex,
                                    })
                                  }
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700 rounded transition-colors whitespace-nowrap"
                                >
                                  {hasLesson ? (
                                    <>
                                      <BookOpen className="w-3.5 h-3.5" />
                                      <span>进入学习</span>
                                    </>
                                  ) : (
                                    <>
                                      <MessageSquare className="w-3.5 h-3.5" />
                                      <span>Chat / Agent 生成</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <div className="fixed bottom-6 right-6 z-40">
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          aria-label="设置"
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium bg-black hover:bg-neutral-900 text-neutral-200 hover:text-white border border-neutral-700 rounded shadow-lg transition-colors whitespace-nowrap"
        >
          <SettingsIcon className="w-3.5 h-3.5" />
          <span>设置</span>
        </button>
      </div>

      <AddCourseModal
        isOpen={isAddCourseOpen}
        defaultLearnerLevel={settings.defaultLearnerLevel}
        onClose={() => setIsAddCourseOpen(false)}
        onCourseCreated={handleCourseCreated}
      />

      <AgentModeModal
        isOpen={Boolean(agentModalCourse)}
        course={agentModalCourse}
        onClose={() => setAgentModalCourseId(null)}
        onCourseUpdated={handleCourseUpdated}
      />

      <CourseOutlineModal
        isOpen={Boolean(outlineModalCourse)}
        course={outlineModalCourse}
        initialStep={outlineModalState?.step || 'outline'}
        showAdvancedWorkflowDetails={Boolean(settings.showAdvancedWorkflowDetails)}
        onOpenSettings={() => {
          setOutlineModalState(null);
          setIsSettingsOpen(true);
        }}
        onClose={() => setOutlineModalState(null)}
        onCourseUpdated={handleCourseUpdated}
        onOpenLesson={(courseId, dayIndex) => {
          setOutlineModalState(null);
          setActiveLessonRef({ courseId, dayIndex });
        }}
        onOpenAgentModal={(c) => {
          setOutlineModalState(null);
          setAgentModalCourseId(c.id);
        }}
      />

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
        onClose={() => setIsSettingsOpen(false)}
        onSettingsUpdated={(newSettings, newPresets) => {
          setSettings(newSettings);
          if (newPresets) setPromptPresets(newPresets);
        }}
      />
    </div>
  );
}
