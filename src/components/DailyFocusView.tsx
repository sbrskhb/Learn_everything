import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  MessageSquare,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { Course, CourseGenerationMode, StudyStats } from '../types';
import type { OutlineWorkbenchStep } from './CourseOutlineModal';
import {
  addDaysToDateString,
  formatChineseDateLabel,
  formatStudyDuration,
  getTodayDateString,
} from '../utils/learningLogic';
import { renderInlineMathWithLatex } from '../utils/markdownMath';
import type { GenerationProgressEvent } from '../utils/streamProgress';

interface DailyFocusViewProps {
  date: string;
  courses: Course[];
  studyStats: StudyStats;
  generatingSlotKey: string | null;
  generatingSlotProgress: GenerationProgressEvent | null;
  onChangeDate: (nextDate: string) => void;
  onBack: (e?: React.MouseEvent) => void;
  onOpenLesson: (courseId: string, dayIndex: number, e?: React.MouseEvent) => void;
  onGenerateSlot: (
    e: React.MouseEvent,
    course: Course,
    dayIndex: number
  ) => void;
  onOpenOutlineModal: (courseId: string, step: OutlineWorkbenchStep) => void;
  onOpenAddCourse: () => void;
}

const MODE_LABELS: Record<CourseGenerationMode, string> = {
  api: 'API 自动生成',
  agent: 'Agent 课件模式',
  chat: 'Chat 课件模式',
};

export const DailyFocusView: React.FC<DailyFocusViewProps> = ({
  date,
  courses,
  studyStats,
  generatingSlotKey,
  generatingSlotProgress,
  onChangeDate,
  onBack,
  onOpenLesson,
  onGenerateSlot,
  onOpenOutlineModal,
  onOpenAddCourse,
}) => {
  const [focusingLessonKey, setFocusingLessonKey] = useState<string | null>(null);
  const focusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setFocusingLessonKey(null);
    return () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
      }
    };
  }, [date]);

  const handleTriggerLessonOpen = (
    courseId: string,
    dayIndex: number,
    e?: React.MouseEvent
  ) => {
    const key = `${courseId}-${dayIndex}`;
    if (focusingLessonKey === key) return;
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
    }
    setFocusingLessonKey(key);
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null;
      onOpenLesson(courseId, dayIndex, e);
    }, 110);
  };

  const todayStr = getTodayDateString();
  const isToday = date === todayStr;
  const { monthDay, weekday, year } = formatChineseDateLabel(date);

  const dayItems = useMemo(() => {
    const items: Array<{ course: Course; slot: Course['dailyPlan'][number] }> = [];
    for (const course of courses) {
      for (const slot of course.dailyPlan) {
        if (slot.date === date) {
          items.push({ course, slot });
        }
      }
    }
    return items;
  }, [courses, date]);

  const readyCount = dayItems.filter((item) => Boolean(item.slot.lesson)).length;
  const dayStudySeconds = Math.max(0, Math.floor(studyStats?.secondsByDate?.[date] || 0));

  const dayAccuracy = useMemo(() => {
    let correct = 0;
    let total = 0;
    for (const { course, slot } of dayItems) {
      const sub = course.exerciseSubmissions?.[slot.date];
      if (sub && sub.total > 0) {
        total += sub.total;
        correct += sub.score;
      }
    }
    if (total === 0) return null;
    return {
      correct,
      total,
      percent: Math.round((correct / total) * 1000) / 10,
    };
  }, [dayItems]);

  const nearestScheduledDate = useMemo(() => {
    const allDates = new Set<string>();
    for (const c of courses) {
      for (const s of c.dailyPlan) {
        if (s.date) allDates.add(s.date);
      }
    }
    const sorted = Array.from(allDates).sort();
    if (sorted.length === 0) return null;
    const nextOrToday = sorted.find((d) => d >= date);
    return nextOrToday || sorted[sorted.length - 1];
  }, [courses, date]);

  return (
    <div className="min-h-screen bg-black text-neutral-100 flex flex-col pb-24">
      {/* Top Bar */}
      <motion.header
        animate={
          focusingLessonKey
            ? { filter: 'blur(9px)', opacity: 0.22, scale: 0.99 }
            : { filter: 'blur(0px)', opacity: 1, scale: 1 }
        }
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        className="sticky top-0 z-30 bg-black/95 backdrop-blur-sm border-b border-neutral-900 px-6 py-4"
      >
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(e) => onBack(e)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-white transition-colors whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>返回总时间轴</span>
            </button>
            <span className="text-neutral-700" aria-hidden="true">
              /
            </span>
            <span className="text-xs font-mono text-neutral-400 uppercase tracking-wider">
              DAILY COURSE FOCUS
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeDate(addDaysToDateString(date, -1))}
              aria-label="前一天"
              className="p-1.5 border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 hover:text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onChangeDate(todayStr)}
              disabled={isToday}
              className="px-2.5 py-1.5 text-xs font-mono border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 hover:text-white disabled:opacity-40 transition-colors"
            >
              回到今日
            </button>
            <button
              type="button"
              onClick={() => onChangeDate(addDaysToDateString(date, 1))}
              aria-label="后一天"
              className="p-1.5 border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 hover:text-white transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 pt-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={date}
            initial={{ opacity: 0, scale: 0.975, filter: 'blur(5px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 1.02, filter: 'blur(5px)' }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: '50% 25%' }}
            className="space-y-8"
          >
        {/* Hero Date Header + Metrics Strip */}
        <motion.section
          animate={
            focusingLessonKey
              ? { filter: 'blur(9px)', opacity: 0.22, scale: 0.99 }
              : { filter: 'blur(0px)', opacity: 1, scale: 1 }
          }
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="border-b border-neutral-900 pb-6 flex flex-col md:flex-row md:items-end justify-between gap-6"
        >
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-xs font-mono text-neutral-500">
              <Calendar className="w-3.5 h-3.5 text-sky-400/90" />
              <span>{date}</span>
              <span aria-hidden="true">·</span>
              <span>{year} 年</span>
              <span aria-hidden="true">·</span>
              <span>{weekday}</span>
              {isToday && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-sky-400 font-semibold">TODAY</span>
                </>
              )}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-white tracking-tight">
              {monthDay} · 当日课程视图
            </h1>
          </div>

          {/* Minimal tabular stats strip (zero pills) */}
          <div className="glow-border grid grid-cols-2 sm:grid-cols-4 gap-5 border border-neutral-900 bg-neutral-950/60 rounded px-4 py-3 text-xs">
            <div>
              <div className="text-[11px] text-neutral-500">当日课程</div>
              <div className="font-mono text-sm font-semibold text-white mt-0.5 tabular-nums">
                {dayItems.length} 讲
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">课件就绪</div>
              <div className="font-mono text-sm font-semibold text-neutral-200 mt-0.5 tabular-nums">
                {readyCount}/{dayItems.length}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">当日学习时长</div>
              <div className="font-mono text-sm font-semibold text-sky-300 mt-0.5 tabular-nums">
                {formatStudyDuration(dayStudySeconds)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">当日答题正确率</div>
              <div className="font-mono text-sm font-semibold text-neutral-200 mt-0.5 tabular-nums">
                {dayAccuracy ? `${dayAccuracy.percent}% (${dayAccuracy.correct}/${dayAccuracy.total})` : '--'}
              </div>
            </div>
          </div>
        </motion.section>

        {/* Daily Courses List */}
        {dayItems.length === 0 ? (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-neutral-900 bg-neutral-950/40 rounded p-8 text-center space-y-4"
          >
            <p className="font-display text-lg text-neutral-200">
              {monthDay} 当日暂无课程安排
            </p>
            <p className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
              你可以使用上方日期切换按钮查看前后几天的课程排期，或新增一门学习课程。
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              {nearestScheduledDate && nearestScheduledDate !== date && (
                <button
                  type="button"
                  onClick={() => onChangeDate(nearestScheduledDate)}
                  className="px-4 py-2 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors"
                >
                  跳转至最近排课日 ({nearestScheduledDate})
                </button>
              )}
              <button
                type="button"
                onClick={onOpenAddCourse}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加新课程</span>
              </button>
            </div>
          </motion.section>
        ) : (
          <section className="space-y-4" aria-label="当日全部排课列表">
            {dayItems.map(({ course, slot }, idx) => {
              const hasLesson = Boolean(slot.lesson);
              const isGeneratingThis = generatingSlotKey === `${course.id}-${slot.dayIndex}`;
              const submission = course.exerciseSubmissions?.[slot.date];
              const mode: CourseGenerationMode = course.generationMode || 'api';
              const hasPdf = course.materials?.some(
                (m) => m.isPdf || m.fileName.toLowerCase().endsWith('.pdf')
              );

              const itemFocusKey = `${course.id}-${slot.dayIndex}`;
              const isFocusedItem = focusingLessonKey === itemFocusKey;
              const isOtherItemBlurred = Boolean(focusingLessonKey && !isFocusedItem);

              return (
                <motion.article
                  key={`${course.id}-${slot.id || slot.dayIndex}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={
                    isOtherItemBlurred
                      ? { opacity: 0.2, y: 0, scale: 0.985, filter: 'blur(9px)' }
                      : isFocusedItem
                        ? { opacity: 1, y: 0, scale: 1.018, filter: 'blur(0px)' }
                        : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }
                  }
                  transition={{
                    delay: focusingLessonKey ? 0 : Math.min(idx * 0.025, 0.1),
                    duration: focusingLessonKey ? 0.16 : 0.18,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className={`glow-border border rounded bg-neutral-950/60 p-5 space-y-4 transition-colors ${
                    isFocusedItem
                      ? 'border-sky-400/70 shadow-[0_0_32px_-12px_rgba(56,189,248,0.4)]'
                      : 'border-neutral-800 hover:border-neutral-600'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-neutral-400">
                        <span className="font-sans font-semibold text-white">
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
                        <span className={hasLesson ? 'text-sky-300' : 'text-neutral-500'}>
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
                        {submission && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-neutral-200">
                              练习 {submission.score}/{submission.total}
                            </span>
                          </>
                        )}
                      </div>

                      <h2
                        onClick={(e) => handleTriggerLessonOpen(course.id, slot.dayIndex, e)}
                        className="font-display text-lg font-semibold text-white hover:text-sky-300 cursor-pointer transition-colors"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(slot.title),
                        }}
                      />

                      <p
                        className="text-xs text-neutral-300 leading-relaxed"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(slot.objective),
                        }}
                      />

                      {slot.keyTopics && slot.keyTopics.length > 0 && (
                        <div className="text-xs text-neutral-500 pt-1">
                          核心知识点：
                          <span
                            className="text-neutral-300"
                            dangerouslySetInnerHTML={{
                              __html: renderInlineMathWithLatex(slot.keyTopics.join(' / ')),
                            }}
                          />
                        </div>
                      )}

                      {course.category === 'english' && slot.assignedWords && (
                        <div className="text-xs text-neutral-400 pt-1 font-mono">
                          今日词汇 ({slot.assignedWords.length})：
                          {slot.assignedWords
                            .slice(0, 8)
                            .map((w) => w.word)
                            .join(', ')}
                          {slot.assignedWords.length > 8 ? ' ...' : ''}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          onOpenOutlineModal(
                            course.id,
                            course.outlineConfirmed
                              ? 'lessons'
                              : hasPdf || course.category === 'english'
                                ? 'split_vocab'
                                : 'outline'
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors"
                      >
                        <ListChecks className="w-3.5 h-3.5" />
                        <span>工作台</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => onGenerateSlot(e, course, slot.dayIndex)}
                        disabled={isGeneratingThis}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${isGeneratingThis ? 'animate-spin' : ''}`}
                        />
                        <span>
                          {isGeneratingThis
                            ? `生成中 ${generatingSlotProgress?.percent ?? 0}%`
                            : hasLesson
                              ? 'API 重新生成'
                              : 'API 生成课件'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => handleTriggerLessonOpen(course.id, slot.dayIndex, e)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors"
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
                </motion.article>
              );
            })}
          </section>
        )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
};
