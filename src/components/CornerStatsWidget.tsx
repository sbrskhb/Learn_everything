import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart2, CheckCircle2, ChevronUp, Clock } from 'lucide-react';
import type { Course, StudyStats } from '../types';
import {
  computeLearningStats,
  formatStudyDuration,
  getTodayDateString,
} from '../utils/learningLogic';

interface CornerStatsWidgetProps {
  courses: Course[];
  studyStats: StudyStats;
  liveSessionSeconds?: number;
  positionClassName?: string;
}

export const CornerStatsWidget: React.FC<CornerStatsWidgetProps> = ({
  courses,
  studyStats,
  liveSessionSeconds = 0,
  positionClassName = 'bottom-6 left-6',
}) => {
  const [expanded, setExpanded] = useState(false);
  const todayStr = getTodayDateString();

  const stats = useMemo(() => {
    const base = computeLearningStats(courses, studyStats, todayStr);
    return {
      ...base,
      totalStudySeconds: base.totalStudySeconds + Math.max(0, liveSessionSeconds),
      todayStudySeconds: base.todayStudySeconds + Math.max(0, liveSessionSeconds),
    };
  }, [courses, studyStats, todayStr, liveSessionSeconds]);

  const accuracyLabel =
    stats.accuracyPercent !== null ? `${stats.accuracyPercent}%` : '--';

  return (
    <div className={`fixed ${positionClassName} z-40 flex flex-col items-start gap-2`}>
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="stats-popover"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="glow-border w-72 obsidian-surface border border-neutral-800 rounded p-4 shadow-2xl space-y-3 text-xs"
            role="region"
            aria-label="学习数据统计详情"
          >
            <div className="flex items-center justify-between border-b border-neutral-900 pb-2">
              <span className="font-display text-xs font-semibold text-white tracking-wide">
                学习数据统计
              </span>
              <span className="font-mono text-[10px] text-neutral-500">
                STUDY OVERVIEW
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="border border-neutral-900 bg-black/70 rounded p-2.5">
                <div className="text-[11px] text-neutral-500">课件累计学习</div>
                <div className="font-mono text-sm font-semibold text-white mt-0.5 tabular-nums">
                  {formatStudyDuration(stats.totalStudySeconds)}
                </div>
              </div>
              <div className="border border-neutral-900 bg-black/70 rounded p-2.5">
                <div className="text-[11px] text-neutral-500">今日课件学习</div>
                <div className="font-mono text-sm font-semibold text-sky-300 mt-0.5 tabular-nums">
                  {formatStudyDuration(stats.todayStudySeconds)}
                </div>
              </div>
              <div className="border border-neutral-900 bg-black/70 rounded p-2.5">
                <div className="text-[11px] text-neutral-500">答题综合正确率</div>
                <div className="font-mono text-sm font-semibold text-white mt-0.5 tabular-nums">
                  {accuracyLabel}
                </div>
                <div className="text-[10px] font-mono text-neutral-500 mt-0.5">
                  {stats.totalQuestionsAnswered > 0
                    ? `${stats.totalQuestionsCorrect}/${stats.totalQuestionsAnswered} 题`
                    : '暂无交卷记录'}
                </div>
              </div>
              <div className="border border-neutral-900 bg-black/70 rounded p-2.5">
                <div className="text-[11px] text-neutral-500">已生成课件</div>
                <div className="font-mono text-sm font-semibold text-neutral-200 mt-0.5 tabular-nums">
                  {stats.completedLessonsCount}/{stats.totalLessonsCount} 讲
                </div>
                <div className="text-[10px] font-mono text-neutral-500 mt-0.5">
                  共 {courses.length} 门课程
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.985 }}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="查看学习时间与答题正确率统计"
        className="glow-border inline-flex items-center gap-3 px-3.5 py-2 text-xs bg-black/95 hover:bg-neutral-900 text-neutral-200 hover:text-white border border-neutral-800 hover:border-neutral-600 rounded shadow-lg transition-colors whitespace-nowrap"
      >
        <BarChart2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
        <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
          <Clock className="w-3 h-3 text-neutral-500" />
          <span className="text-white font-medium">
            {formatStudyDuration(stats.totalStudySeconds)}
          </span>
        </span>
        <span className="text-neutral-700" aria-hidden="true">
          |
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
          <CheckCircle2 className="w-3 h-3 text-neutral-500" />
          <span className="text-neutral-300">正确率</span>
          <span className="text-white font-medium">{accuracyLabel}</span>
        </span>
        <ChevronUp
          className={`w-3.5 h-3.5 text-neutral-500 transition-transform duration-200 ${
            expanded ? 'rotate-180 text-white' : ''
          }`}
        />
      </motion.button>
    </div>
  );
};
