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

/**
 * Ask the local Python backend (via Node proxy) to copy a course file
 * directly to the OS file clipboard (Windows CF_HDROP / macOS Finder / Linux uri-list),
 * equivalent to selecting the file in File Explorer and pressing Ctrl+C.
 */
export async function copyCourseFileToClipboard(
  courseId: string,
  relPath: string
): Promise<CopyCourseFileResult> {
  const res = await fetch(`/api/courses/${courseId}/files/copy-clipboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relPath }),
  });

  const data = (await res.json().catch(() => ({}))) as CopyCourseFileResult;
  if (!res.ok) {
    throw new Error(data.error || `复制文件失败 (HTTP ${res.status})`);
  }

  // In remote/headless environments where OS clipboard isn't reachable, copy local path as a convenience
  if (!data.copiedToOsClipboard && data.absPath && typeof navigator !== 'undefined') {
    navigator.clipboard?.writeText(data.absPath).catch(() => {
      // ignore clipboard permission errors in headless tests
    });
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
  const res = await fetch(`/api/courses/${courseId}/prompts/copy-md-clipboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, content }),
  });

  const data = (await res.json().catch(() => ({}))) as CopyCourseFileResult;
  if (!res.ok) {
    throw new Error(data.error || `复制提示词 .md 文件失败 (HTTP ${res.status})`);
  }

  if (!data.copiedToOsClipboard && content && typeof navigator !== 'undefined') {
    navigator.clipboard?.writeText(content).catch(() => {
      // ignore clipboard permission errors
    });
  }

  return data;
}
