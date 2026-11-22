import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen,
  Check,
  Download,
  Edit3,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { VocabBank, VocabItem } from '../types';
import {
  assignStableVocabIds,
  deduplicateVocabList,
  parseVocabularyInput,
} from '../utils/learningLogic';

interface VocabBankManagerModalProps {
  isOpen: boolean;
  vocabBanks: VocabBank[];
  onClose: () => void;
  onVocabBanksChanged: (banks: VocabBank[]) => void;
}

export const VocabBankManagerModal: React.FC<VocabBankManagerModalProps> = ({
  isOpen,
  vocabBanks,
  onClose,
  onVocabBanksChanged,
}) => {
  const [selectedBankId, setSelectedBankId] = useState<string>('__new__');
  const [bankName, setBankName] = useState('');
  const [bankDescription, setBankDescription] = useState('');
  const [importText, setImportText] = useState('');

  // Quick single-word add
  const [newWordText, setNewWordText] = useState('');
  const [newWordPhonetic, setNewWordPhonetic] = useState('');
  const [newWordMeaning, setNewWordMeaning] = useState('');

  // Inline word editing & filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [editWordVal, setEditWordVal] = useState('');
  const [editPhoneticVal, setEditPhoneticVal] = useState('');
  const [editMeaningVal, setEditMeaningVal] = useState('');

  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const wasOpenRef = useRef(false);
  const bankNameInputRef = useRef<HTMLInputElement | null>(null);

  const focusBankNameInput = () => {
    requestAnimationFrame(() => {
      bankNameInputRef.current?.focus();
    });
  };

  const formatVocabApiError = (res: Response, data: any, fallback: string): string => {
    const raw = typeof data?.error === 'string' ? data.error : '';
    if (res.status === 404 && (!raw || raw.includes('未找到接口'))) {
      return '未找到词库接口（本地后端服务尚未重启以加载新接口，请重启本地服务后刷新页面重试）';
    }
    return raw || fallback;
  };

  const selectedBank = useMemo(
    () => vocabBanks.find((b) => b.id === selectedBankId) || null,
    [vocabBanks, selectedBankId]
  );

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      setFeedback(null);
      if (vocabBanks.length > 0) {
        setSelectedBankId(vocabBanks[0].id);
      } else {
        setSelectedBankId('__new__');
        setBankName('');
        setBankDescription('');
        setImportText('');
        focusBankNameInput();
      }
    }
  }, [isOpen, vocabBanks]);

  useEffect(() => {
    if (!isOpen || selectedBankId === '__new__') return;
    if (!selectedBank) {
      if (vocabBanks.length > 0) {
        setSelectedBankId(vocabBanks[0].id);
      } else {
        setSelectedBankId('__new__');
        setBankName('');
        setBankDescription('');
        setImportText('');
        focusBankNameInput();
      }
    }
  }, [isOpen, selectedBankId, selectedBank, vocabBanks]);

  useEffect(() => {
    if (selectedBank) {
      setBankName(selectedBank.name);
      setBankDescription(selectedBank.description || '');
      setEditingWordId(null);
      setImportText('');
    }
  }, [selectedBank?.id]);

  const parsedImportPreview = useMemo(() => {
    if (!importText.trim()) return [];
    return deduplicateVocabList(parseVocabularyInput(importText));
  }, [importText]);

  const filteredWords = useMemo(() => {
    if (!selectedBank) return [];
    const q = searchQuery.trim().toLowerCase();
    const list = assignStableVocabIds(selectedBank.words || []);
    if (!q) return list;
    return list.filter(
      (w) =>
        w.word.toLowerCase().includes(q) ||
        w.meaning.toLowerCase().includes(q) ||
        (w.id || '').toLowerCase().includes(q)
    );
  }, [selectedBank, searchQuery]);

  const handleStartNewBank = () => {
    const alreadyNew = selectedBankId === '__new__';
    setSelectedBankId('__new__');
    setBankName('');
    setBankDescription('');
    setImportText('');
    setEditingWordId(null);
    setFeedback(
      alreadyNew
        ? {
            ok: true,
            text: '当前已在新建词库模式：请在右侧填写「词库名称」并点击右下角「创建并保存到本地」。',
          }
        : null
    );
    focusBankNameInput();
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setImportText((prev) => (prev.trim() ? `${prev.trim()}\n${content}` : content));
      if (selectedBankId === '__new__' && !bankName.trim()) {
        setBankName(file.name.replace(/\.(txt|csv|tsv|json|md)$/i, ''));
      }
      setFeedback({ ok: true, text: `已读取文件「${file.name}」，请确认预览后保存或导入。` });
    } catch {
      setFeedback({ ok: false, text: '读取文本文件失败' });
    } finally {
      e.target.value = '';
    }
  };

  const handleCreateBank = async () => {
    if (!bankName.trim()) {
      setFeedback({ ok: false, text: '请输入词库名称' });
      return;
    }
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/vocab-banks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: bankName.trim(),
          description: bankDescription.trim(),
          rawText: importText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatVocabApiError(res, data, '创建词库失败'));
      onVocabBanksChanged(data.vocabBanks || []);
      if (data.vocabBank?.id) {
        setSelectedBankId(data.vocabBank.id);
      }
      setImportText('');
      setFeedback({
        ok: true,
        text: `已创建词库「${data.vocabBank?.name}」（去重后 ${data.vocabBank?.words?.length || 0} 词）`,
      });
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || '创建词库失败' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveBankMeta = async () => {
    if (!selectedBank) return;
    if (!bankName.trim()) {
      setFeedback({ ok: false, text: '词库名称不能为空' });
      return;
    }
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/vocab-banks/${encodeURIComponent(selectedBank.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: bankName.trim(),
          description: bankDescription.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatVocabApiError(res, data, '更新词库信息失败'));
      onVocabBanksChanged(data.vocabBanks || []);
      setFeedback({ ok: true, text: '已保存词库名称与配置' });
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || '保存失败' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleAppendImportToBank = async () => {
    if (!selectedBank || !importText.trim()) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const beforeCount = selectedBank.words.length;
      const res = await fetch(`/api/vocab-banks/${encodeURIComponent(selectedBank.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appendRawText: importText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatVocabApiError(res, data, '导入词汇失败'));
      onVocabBanksChanged(data.vocabBanks || []);
      const afterCount = data.vocabBank?.words?.length || 0;
      const added = Math.max(0, afterCount - beforeCount);
      setImportText('');
      setFeedback({
        ok: true,
        text: `已去重导入：新增 ${added} 词，当前共 ${afterCount} 词。`,
      });
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || '导入失败' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleAddSingleWord = async () => {
    if (!selectedBank || !newWordText.trim()) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/vocab-banks/${encodeURIComponent(selectedBank.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appendWords: [
            {
              word: newWordText.trim(),
              phonetic: newWordPhonetic.trim() || undefined,
              meaning: newWordMeaning.trim() || '待结合语境学习',
            },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatVocabApiError(res, data, '添加词条失败'));
      onVocabBanksChanged(data.vocabBanks || []);
      setNewWordText('');
      setNewWordPhonetic('');
      setNewWordMeaning('');
      setFeedback({ ok: true, text: '已添加并去重更新词库' });
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || '添加失败' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleUpdateWordList = async (nextWords: VocabItem[], successMsg: string) => {
    if (!selectedBank) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/vocab-banks/${encodeURIComponent(selectedBank.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: nextWords }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatVocabApiError(res, data, '更新词条失败'));
      onVocabBanksChanged(data.vocabBanks || []);
      setEditingWordId(null);
      setFeedback({ ok: true, text: successMsg });
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || '更新失败' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteBank = async (bankId: string) => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/vocab-banks/${encodeURIComponent(bankId)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatVocabApiError(res, data, '删除词库失败'));
      const remaining: VocabBank[] = data.vocabBanks || [];
      onVocabBanksChanged(remaining);
      if (selectedBankId === bankId) {
        setSelectedBankId(remaining[0]?.id || '__new__');
      }
      setFeedback({ ok: true, text: '已删除本地词库' });
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || '删除失败' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleExportBank = async (format: 'txt' | 'csv' | 'json') => {
    if (!selectedBank) return;
    try {
      const res = await fetch(
        `/api/vocab-banks/${encodeURIComponent(selectedBank.id)}/export?format=${format}`
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(formatVocabApiError(res, errData, '导出词库失败'));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedBank.name}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setFeedback({ ok: true, text: `已导出为 ${format.toUpperCase()} 格式` });
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || '导出失败' });
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vocab-manager-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="w-full max-w-5xl bg-black border border-neutral-800 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <BookOpen className="w-4 h-4 text-neutral-300" />
                <div>
                  <h2 id="vocab-manager-title" className="text-sm font-semibold text-white">
                    本地自定义词库管理
                  </h2>
                  <p className="text-xs text-neutral-500">
                    支持创建、文本/CSV/JSON 导入去重、词条编辑、本地持久化保存与导出复用
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭词库管理弹窗"
                className="p-1.5 text-neutral-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {feedback && (
              <div
                className={`px-5 py-2 text-xs border-b flex items-center justify-between ${
                  feedback.ok
                    ? 'bg-neutral-950 border-neutral-800 text-neutral-200'
                    : 'bg-red-950/30 border-red-900/60 text-red-400'
                }`}
              >
                <span>{feedback.text}</span>
                <button
                  type="button"
                  onClick={() => setFeedback(null)}
                  className="text-neutral-500 hover:text-white"
                >
                  关闭
                </button>
              </div>
            )}

            {/* Main 2-column content */}
            <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
              {/* Left bank list */}
              <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-neutral-800 bg-neutral-950/60 flex flex-col min-h-0 max-h-60 md:max-h-none">
                <div className="p-3 border-b border-neutral-900 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-neutral-400">
                    已保存词库 ({vocabBanks.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleStartNewBank}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>新建词库</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                  {selectedBankId === '__new__' && (
                    <div
                      onClick={focusBankNameInput}
                      className="px-3 py-2.5 rounded border border-white bg-neutral-900 text-white text-xs cursor-pointer transition-colors"
                    >
                      <div className="font-medium flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {bankName.trim() ? `新建：${bankName.trim()}` : '新建词库（编辑中）'}
                        </span>
                      </div>
                      <div className="text-[11px] text-neutral-400 mt-0.5">
                        请在右侧填写名称并点击「创建并保存到本地」
                      </div>
                    </div>
                  )}

                  {vocabBanks.length === 0 ? (
                    <div className="p-4 text-xs text-neutral-500 text-center">
                      暂无本地词库，请在右侧新建或导入文本词库。
                    </div>
                  ) : (
                    vocabBanks.map((bank) => {
                      const active = selectedBankId === bank.id;
                      return (
                        <div
                          key={bank.id}
                          className={`group flex items-center justify-between gap-2 px-3 py-2.5 rounded border text-xs cursor-pointer transition-colors ${
                            active
                              ? 'bg-neutral-900 border-white text-white'
                              : 'bg-black border-neutral-800/80 text-neutral-300 hover:border-neutral-700'
                          }`}
                          onClick={() => {
                            setSelectedBankId(bank.id);
                            setFeedback(null);
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{bank.name}</div>
                            <div className="text-[11px] text-neutral-500 flex items-center gap-2 mt-0.5">
                              <span className="font-mono">{bank.words.length} 词</span>
                              {bank.description && (
                                <span className="truncate">{bank.description}</span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBank(bank.id);
                            }}
                            title="删除该词库"
                            aria-label={`删除词库 ${bank.name}`}
                            className="p-1 text-neutral-500 hover:text-red-400 opacity-70 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right editor pane */}
              <div className="md:col-span-8 p-5 overflow-y-auto space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-neutral-900">
                  <span className="text-xs font-medium text-white">
                    {selectedBank ? `编辑词库：${selectedBank.name}` : '新建本地词库'}
                  </span>
                  <span className="text-[11px] text-neutral-500">
                    {selectedBank
                      ? '修改名称、导入词条或编辑词表后会立即保存到本地'
                      : '填写词库名称并可选导入词表，点击右下角「创建并保存到本地」'}
                  </span>
                </div>

                {/* Metadata row */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-6">
                    <label className="block text-xs text-neutral-400 mb-1">词库名称</label>
                    <input
                      ref={bankNameInputRef}
                      type="text"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder="例如：考研核心词汇 / JLPT N3 高频词"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-neutral-500"
                    />
                  </div>
                  <div className="sm:col-span-6">
                    <label className="block text-xs text-neutral-400 mb-1">
                      备注说明（可选）
                    </label>
                    <input
                      type="text"
                      value={bankDescription}
                      onChange={(e) => setBankDescription(e.target.value)}
                      placeholder="用途、考试或来源说明"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-neutral-500"
                    />
                  </div>
                </div>

                {selectedBank && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-neutral-900">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSaveBankMeta}
                        disabled={isBusy}
                        className="px-3 py-1.5 text-xs font-medium bg-neutral-900 border border-neutral-700 hover:border-white text-white rounded transition-colors disabled:opacity-50"
                      >
                        保存词库信息
                      </button>
                      <span className="text-xs text-neutral-500 font-mono">
                        共 {selectedBank.words.length} 个稳定 ID 词条
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-neutral-500 mr-1">导出：</span>
                      {(['txt', 'csv', 'json'] as const).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => handleExportBank(fmt)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors"
                        >
                          <Download className="w-3 h-3" />
                          <span>{fmt.toUpperCase()}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Import / Append section */}
                <div className="border border-neutral-800 rounded p-3.5 bg-neutral-950/60 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-neutral-200">
                      {selectedBank ? '批量导入并去重追加词条' : '导入或粘贴初始词表'}
                    </span>
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white rounded cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      <span>上传 TXT / CSV / TSV / JSON</span>
                      <input
                        type="file"
                        accept=".txt,.csv,.tsv,.json,.md"
                        onChange={handleUploadFile}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  <textarea
                    rows={selectedBank ? 3 : 6}
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={`支持常见格式（自动去重并分配稳定 ID）：\n每行一个单词或短语：abandon\t抛弃，放弃\nCSV / TSV：take off, 起飞，脱下\n词典行或 JSON 数组：[{"word":"mitigate","meaning":"减轻"}]`}
                    className="w-full bg-black border border-neutral-800 rounded p-2.5 text-xs font-mono text-neutral-200 focus:outline-none focus:border-neutral-500"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-neutral-400">
                      {parsedImportPreview.length > 0
                        ? `预览解析出 ${parsedImportPreview.length} 个去重词条`
                        : '可先不填词表创建空词库，或粘贴多行文本后导入'}
                    </span>

                    {selectedBank ? (
                      <button
                        type="button"
                        onClick={handleAppendImportToBank}
                        disabled={isBusy || parsedImportPreview.length === 0}
                        className="px-3 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-40"
                      >
                        去重追加到当前词库
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleCreateBank}
                        disabled={isBusy || !bankName.trim()}
                        className="px-3.5 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-40"
                      >
                        创建并保存到本地
                      </button>
                    )}
                  </div>
                </div>

                {/* Single word add & list (when editing existing bank) */}
                {selectedBank && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end bg-neutral-950/40 p-3 rounded border border-neutral-800/80">
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] text-neutral-400 mb-1">词条 / 短语</label>
                        <input
                          type="text"
                          value={newWordText}
                          onChange={(e) => setNewWordText(e.target.value)}
                          placeholder="如 carry out"
                          className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-neutral-500"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] text-neutral-400 mb-1">音标 / 读音</label>
                        <input
                          type="text"
                          value={newWordPhonetic}
                          onChange={(e) => setNewWordPhonetic(e.target.value)}
                          placeholder="可选"
                          className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-neutral-500"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] text-neutral-400 mb-1">中文释义</label>
                        <input
                          type="text"
                          value={newWordMeaning}
                          onChange={(e) => setNewWordMeaning(e.target.value)}
                          placeholder="执行，开展"
                          className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-neutral-500"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <button
                          type="button"
                          onClick={handleAddSingleWord}
                          disabled={isBusy || !newWordText.trim()}
                          className="w-full px-2.5 py-1.5 text-xs font-medium bg-neutral-900 border border-neutral-700 hover:border-white text-white rounded transition-colors disabled:opacity-40"
                        >
                          添加词条
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="搜索词条、ID 或释义..."
                          className="w-full bg-neutral-950 border border-neutral-800 rounded pl-8 pr-3 py-1 text-xs text-white focus:outline-none focus:border-neutral-500"
                        />
                      </div>
                      <span className="text-[11px] text-neutral-500 font-mono">
                        显示 {filteredWords.length} / {selectedBank.words.length}
                      </span>
                    </div>

                    <div className="border border-neutral-800 rounded max-h-64 overflow-y-auto divide-y divide-neutral-900">
                      {filteredWords.length === 0 ? (
                        <div className="p-4 text-xs text-neutral-500 text-center">
                          没有匹配的词条
                        </div>
                      ) : (
                        filteredWords.map((item) => {
                          const isEditing = editingWordId === item.id;
                          return (
                            <div
                              key={item.id || item.word}
                              className="px-3 py-2 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 text-xs hover:bg-neutral-950/60"
                            >
                              {isEditing ? (
                                <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2">
                                  <input
                                    type="text"
                                    value={editWordVal}
                                    onChange={(e) => setEditWordVal(e.target.value)}
                                    className="sm:col-span-4 bg-black border border-neutral-700 rounded px-2 py-1 text-xs text-white"
                                  />
                                  <input
                                    type="text"
                                    value={editPhoneticVal}
                                    onChange={(e) => setEditPhoneticVal(e.target.value)}
                                    placeholder="音标/读音"
                                    className="sm:col-span-3 bg-black border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300"
                                  />
                                  <input
                                    type="text"
                                    value={editMeaningVal}
                                    onChange={(e) => setEditMeaningVal(e.target.value)}
                                    className="sm:col-span-5 bg-black border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200"
                                  />
                                </div>
                              ) : (
                                <div className="flex-1 min-w-0 flex items-baseline gap-2.5">
                                  <span className="text-[10px] font-mono text-neutral-500 shrink-0">
                                    {item.id}
                                  </span>
                                  <span className="font-medium text-white shrink-0">
                                    {item.word}
                                  </span>
                                  {item.phonetic && (
                                    <span className="text-[11px] text-neutral-500 font-mono shrink-0">
                                      {item.phonetic}
                                    </span>
                                  )}
                                  <span className="text-neutral-300 truncate">{item.meaning}</span>
                                </div>
                              )}

                              <div className="flex items-center gap-1 shrink-0">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextWords = selectedBank.words.map((w) =>
                                          w.id === item.id
                                            ? {
                                                ...w,
                                                word: editWordVal.trim() || w.word,
                                                phonetic: editPhoneticVal.trim() || undefined,
                                                meaning: editMeaningVal.trim() || w.meaning,
                                              }
                                            : w
                                        );
                                        handleUpdateWordList(nextWords, `已更新词条「${editWordVal.trim() || item.word}」`);
                                      }}
                                      aria-label="保存词条修改"
                                      className="p-1 text-emerald-400 hover:text-emerald-300"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingWordId(null)}
                                      aria-label="取消修改"
                                      className="p-1 text-neutral-500 hover:text-white"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingWordId(item.id || null);
                                        setEditWordVal(item.word);
                                        setEditPhoneticVal(item.phonetic || '');
                                        setEditMeaningVal(item.meaning);
                                      }}
                                      aria-label={`编辑词条 ${item.word}`}
                                      className="p-1 text-neutral-500 hover:text-white"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextWords = selectedBank.words.filter(
                                          (w) => w.id !== item.id
                                        );
                                        handleUpdateWordList(nextWords, `已删除词条「${item.word}」`);
                                      }}
                                      aria-label={`删除词条 ${item.word}`}
                                      className="p-1 text-neutral-500 hover:text-red-400"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
