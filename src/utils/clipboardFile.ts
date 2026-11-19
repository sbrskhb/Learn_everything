export interface CopyCourseFileResult {
  ok: boolean;
  copiedToOsClipboard: boolean;
  method?: string;
  fileName?: string;
  relPath?: string;
  absPath?: string;
  downloadUrl?: string;
  reason?: string;
  error?: string;
}

function isIosWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function copyTextViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const field = document.createElement('textarea');
  const focused = document.activeElement;
  const ios = isIosWebKit();

  field.value = text;
  field.setAttribute('aria-hidden', 'true');
  field.tabIndex = -1;
  field.inputMode = 'none';
  if (ios) {
    // iOS Safari frequently rejects selection/execCommand on readOnly elements
    field.contentEditable = 'true';
    field.readOnly = false;
  } else {
    field.readOnly = true;
  }
  field.style.cssText =
    'position:fixed;left:0;top:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;opacity:0.01;font-size:16px;pointer-events:none;z-index:-1;';
  document.body.appendChild(field);
  try {
    field.focus({ preventScroll: true });
    if (ios && typeof document.createRange === 'function' && typeof window !== 'undefined' && window.getSelection) {
      const range = document.createRange();
      range.selectNodeContents(field);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      field.setSelectionRange(0, text.length);
    } else {
      field.select();
      field.setSelectionRange(0, text.length);
    }
    return Boolean(document.execCommand('copy'));
  } catch {
    return false;
  } finally {
    field.remove();
    if (focused && typeof (focused as HTMLElement).focus === 'function') {
      try {
        (focused as HTMLElement).focus({ preventScroll: true });
      } catch {
        // ignore focus restore failure on detached nodes
      }
    }
  }
}

export async function copyPromptText(text: string): Promise<void> {
  const canUseAsyncClipboard =
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.writeText === 'function' &&
    (typeof window === 'undefined' || window.isSecureContext !== false);

  if (canUseAsyncClipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to synchronous execCommand path if Clipboard API rejects
    }
  }

  // In non-secure HTTP LAN contexts (typical on mobile devices), execute synchronously
  // before any await to preserve the user activation gesture.
  if (copyTextViaExecCommand(text)) {
    return;
  }

  throw new Error('无法自动写入剪贴板，请点击展开框中的“一键复制全文”或长按文本框全选复制');
}

function shouldUseBrowserClipboard(): boolean {
  const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return !isLocalHost || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Ask the local Python backend (via Node proxy) to copy a course file
 * directly to the OS file clipboard (Windows CF_HDROP / macOS Finder / Linux uri-list),
 * equivalent to selecting the file in File Explorer and pressing Ctrl+C.
 */
export async function copyCourseFileToClipboard(
  courseId: string,
  relPath: string
): Promise<CopyCourseFileResult> {
  if (shouldUseBrowserClipboard()) {
    return { ok: false, copiedToOsClipboard: false, reason: '此设备无法通过系统剪贴板复制附件，请使用旁边的下载按钮，再从文件中上传。' };
  }
  const res = await fetch(`/api/courses/${courseId}/files/copy-clipboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relPath }),
  });

  const data = (await res.json().catch(() => ({}))) as CopyCourseFileResult;
  if (!res.ok) {
    throw new Error(data.error || `复制文件失败 (HTTP ${res.status})`);
  }

  return data;
}

/**
 * Write any prompt markdown string to `courses/<folder>/prompts/<fileName>.md` and
 * copy that `.md` file directly to the OS file clipboard (Ctrl+V ready in external AI chats).
 */
export async function copyPromptMarkdownFileToClipboard(
  courseId: string,
  fileName: string,
  content: string
): Promise<CopyCourseFileResult> {
  if (shouldUseBrowserClipboard()) {
    await copyPromptText(content);
    return { ok: true, copiedToOsClipboard: false, reason: '已将提示词文本复制到当前设备，可直接粘贴到对话。' };
  }
  const res = await fetch(`/api/courses/${courseId}/prompts/copy-md-clipboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, content }),
  });

  const data = (await res.json().catch(() => ({}))) as CopyCourseFileResult;
  if (!res.ok) {
    throw new Error(data.error || `复制提示词 .md 文件失败 (HTTP ${res.status})`);
  }

  if (!data.copiedToOsClipboard) {
    await copyPromptText(content);
    return { ...data, reason: '已将提示词文本复制到当前设备。' };
  }

  return data;
}
