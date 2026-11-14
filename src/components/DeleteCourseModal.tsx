import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Trash2, X } from 'lucide-react';
import type { Course } from '../types';

interface DeleteCourseModalProps {
  isOpen: boolean;
  course: Course | null;
  onClose: () => void;
  onConfirmDelete: (courseId: string, deleteLocalFolder: boolean) => Promise<void>;
}

export const DeleteCourseModal: React.FC<DeleteCourseModalProps> = ({
  isOpen,
  course,
  onClose,
  onConfirmDelete,
}) => {
  return (
    <AnimatePresence>
      {isOpen && course && (
        <DeleteCourseModalInner
          key={course.id}
          course={course}
          onClose={onClose}
          onConfirmDelete={onConfirmDelete}
        />
      )}
    </AnimatePresence>
  );
};

const DeleteCourseModalInner: React.FC<{
  course: Course;
  onClose: () => void;
  onConfirmDelete: (courseId: string, deleteLocalFolder: boolean) => Promise<void>;
}> = ({ course, onClose, onConfirmDelete }) => {
  const [deleteLocalFolder, setDeleteLocalFolder] = useState<boolean>(true);
  const [isDeleting, setIsDeleting] = useState(false);

  const folderPath = course.courseDirPath || `courses/${course.folderName || course.id}`;

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirmDelete(course.id, deleteLocalFolder);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
        <motion.div
          key="delete-course-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-course-dialog-title"
        >
          <motion.div
            key="delete-course-panel"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="glow-border w-full max-w-md bg-black border border-neutral-800 rounded-md p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h2 id="delete-course-dialog-title" className="font-display text-base font-semibold text-white">
                确认删除课程《{course.name}》
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            aria-label="关闭删除确认窗口"
            className="p-1 text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs text-neutral-300 leading-relaxed">
          <p>
            该课程的数据与资料保存在本地独立文件夹{' '}
            <code className="text-white font-mono bg-neutral-900 px-1.5 py-0.5 rounded">
              {folderPath}/
            </code>{' '}
            中（包含 <code className="font-mono">course.json</code>、
            <code className="font-mono">outline.json</code>、
            <code className="font-mono">sources/</code>、
            <code className="font-mono">segments/</code> 与{' '}
            <code className="font-mono">lessons/</code>）。
          </p>

          <label className="flex items-start gap-2.5 p-3 border border-neutral-800 rounded bg-neutral-950 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteLocalFolder}
              onChange={(e) => setDeleteLocalFolder(e.target.checked)}
              className="mt-0.5 accent-white"
            />
            <div className="space-y-1">
              <div className="font-medium text-white">
                同时彻底删除本地课程文件夹 ({folderPath}/)
              </div>
              <div className="text-neutral-500">
                {deleteLocalFolder
                  ? '将从磁盘彻底删除该课程的配置文件、原始资料、切分 PDF 及所有已生成课件。'
                  : '取消勾选后，仅从当前学习列表中移除，本地文件夹及文件仍保留在磁盘中以备备份或迁移恢复。'}
              </div>
            </div>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-neutral-900">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-xs font-medium text-neutral-300 hover:text-white border border-neutral-800 rounded transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>
              {isDeleting
                ? '正在处理...'
                : deleteLocalFolder
                  ? '确认删除课程及本地文件夹'
                  : '仅从列表移除（保留本地文件夹）'}
            </span>
          </button>
        </div>
          </motion.div>
        </motion.div>
  );
};
