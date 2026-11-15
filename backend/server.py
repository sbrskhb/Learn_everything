#!/usr/bin/env python3
"""
Learn_everything Python Local Backend Service
Provides local filesystem operations, safe file/folder deletion (including Windows
read-only handling), ZIP backup & restore, asset persistence, OS folder reveal,
and server-side LLM connectivity checks.

Uses only Python 3 standard library modules so it runs out of the box with zero
pip dependencies on Windows, macOS, and Linux.
"""

from __future__ import annotations

import base64
import io
import json
import mimetypes
import os
import platform
import re
import tempfile
import shutil
import signal
import stat
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT_DIR = Path(os.environ.get("LEARN_EVERYTHING_ROOT") or Path(__file__).resolve().parent.parent).resolve()
COURSES_ROOT = (ROOT_DIR / "courses").resolve()
DATA_DIR = (ROOT_DIR / "data").resolve()
DEFAULT_PORT = int(os.environ.get("PYTHON_BACKEND_PORT") or "3001")

COURSES_ROOT.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

TEXT_EXTENSIONS = {
    ".json",
    ".md",
    ".txt",
    ".csv",
    ".yml",
    ".yaml",
    ".svg",
    ".log",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}


def sanitize_filename(name: str) -> str:
    cleaned = os.path.basename(name.strip())
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", cleaned)
    cleaned = cleaned.strip(". ")
    return cleaned or "unnamed_file"


def sanitize_folder_name(name: str, existing: set[str] | None = None) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name.strip())
    cleaned = re.sub(r"\s+", "_", cleaned).strip(". ")
    if not cleaned:
        cleaned = "course"
    candidate = cleaned
    if existing:
        idx = 2
        while candidate in existing:
            candidate = f"{cleaned}_{idx}"
            idx += 1
    return candidate


def resolve_course_dir(folder_name: str) -> Path:
    if not folder_name or "/" in folder_name or "\\" in folder_name or folder_name in {".", ".."}:
        raise ValueError("非法的课程目录名称")
    target = (COURSES_ROOT / folder_name).resolve()
    try:
        target.relative_to(COURSES_ROOT)
    except ValueError as exc:
        raise ValueError("课程目录路径越界") from exc
    if target == COURSES_ROOT:
        raise ValueError("不允许直接操作 courses 根目录")
    return target


def resolve_course_file(course_dir: Path, rel_path: str) -> Path:
    if not rel_path:
        raise ValueError("缺少文件相对路径")
    normalized = rel_path.replace("\\", "/").lstrip("/")
    target = (course_dir / normalized).resolve()
    try:
        target.relative_to(course_dir)
    except ValueError as exc:
        raise ValueError("文件路径越界，已拒绝访问") from exc
    if target == course_dir:
        raise ValueError("不能将课程根目录作为单个文件操作")
    return target


def _handle_remove_readonly(func: Any, path_str: str, _exc_info: Any) -> None:
    try:
        os.chmod(path_str, stat.S_IWRITE | stat.S_IREAD)
        func(path_str)
    except Exception:
        pass


def safe_rmtree(target: Path) -> None:
    if not target.exists():
        return
    if sys.version_info >= (3, 12):
        shutil.rmtree(target, onexc=lambda fn, p, exc: _handle_remove_readonly(fn, p, exc))
    else:
        shutil.rmtree(target, onerror=_handle_remove_readonly)


def safe_unlink(target: Path) -> bool:
    if not target.exists():
        return False
    if target.is_dir():
        safe_rmtree(target)
        return True
    try:
        target.unlink()
    except PermissionError:
        os.chmod(target, stat.S_IWRITE | stat.S_IREAD)
        target.unlink()
    return True


def classify_course_file(rel_path: str) -> str:
    norm = rel_path.replace("\\", "/")
    if norm.startswith("sources/"):
        return "sources"
    if norm.startswith("segments/"):
        return "segments"
    if norm.startswith("lessons/"):
        return "lessons"
    if norm.startswith("assets/"):
        return "assets"
    return "root"


def list_course_files(folder_name: str) -> dict[str, Any]:
    course_dir = resolve_course_dir(folder_name)
    if not course_dir.exists() or not course_dir.is_dir():
        raise FileNotFoundError(f"课程文件夹不存在: courses/{folder_name}")

    files: list[dict[str, Any]] = []
    total_bytes = 0

    for root, dirs, filenames in os.walk(course_dir):
        dirs.sort()
        filenames.sort()
        for fname in filenames:
            abs_file = Path(root) / fname
            try:
                st = abs_file.stat()
            except OSError:
                continue
            rel = abs_file.relative_to(course_dir).as_posix()
            ext = abs_file.suffix.lower()
            category = classify_course_file(rel)
            size = int(st.st_size)
            total_bytes += size
            mtime = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
            deletable = rel not in {"course.json", "outline.json"}
            files.append(
                {
                    "name": fname,
                    "relPath": rel,
                    "category": category,
                    "size": size,
                    "modifiedAt": mtime,
                    "ext": ext,
                    "isPdf": ext == ".pdf",
                    "isImage": ext in IMAGE_EXTENSIONS,
                    "isJson": ext == ".json",
                    "isText": ext in TEXT_EXTENSIONS,
                    "deletable": deletable,
                }
            )

    return {
        "ok": True,
        "folderName": folder_name,
        "absPath": str(course_dir),
        "relDir": f"courses/{folder_name}",
        "totalFiles": len(files),
        "totalBytes": total_bytes,
        "files": files,
    }


def upload_course_file(
    folder_name: str,
    category: str,
    file_name: str,
    base64_data: str | None = None,
    text_content: str | None = None,
) -> dict[str, Any]:
    course_dir = resolve_course_dir(folder_name)
    if category not in {"sources", "assets", "segments", "lessons"}:
        raise ValueError("仅允许写入 sources / assets / segments / lessons 目录")
    target_dir = course_dir / category
    target_dir.mkdir(parents=True, exist_ok=True)
    safe_name = sanitize_filename(file_name)
    target_file = resolve_course_file(course_dir, f"{category}/{safe_name}")

    if base64_data is not None and base64_data != "":
        raw_payload = base64_data
        if "," in raw_payload and raw_payload.strip().startswith("data:"):
            raw_payload = raw_payload.split(",", 1)[1]
        raw_bytes = base64.b64decode(raw_payload)
        target_file.write_bytes(raw_bytes)
    else:
        target_file.write_text(text_content or "", encoding="utf-8")

    st = target_file.stat()
    return {
        "ok": True,
        "fileName": safe_name,
        "relPath": f"{category}/{safe_name}",
        "absPath": str(target_file),
        "size": int(st.st_size),
    }


def delete_course_file(folder_name: str, rel_path: str) -> dict[str, Any]:
    course_dir = resolve_course_dir(folder_name)
    target = resolve_course_file(course_dir, rel_path)
    norm_rel = target.relative_to(course_dir).as_posix()

    if norm_rel in {"course.json", "outline.json"}:
        raise ValueError("course.json 与 outline.json 为课程核心结构文件；如需删除整门课程请使用“删除课程”。")

    deleted_paths: list[str] = []
    if safe_unlink(target):
        deleted_paths.append(norm_rel)

    # Also clean paired companion files automatically when deleting sources, segments, or lessons
    if norm_rel.startswith("sources/") and not norm_rel.endswith((".pages.json", ".txt")):
        for suffix in (".pages.json", ".txt"):
            comp = course_dir / f"{norm_rel}{suffix}"
            if comp.exists() and safe_unlink(comp):
                deleted_paths.append(f"{norm_rel}{suffix}")
    elif norm_rel.startswith("segments/") and norm_rel.endswith(".pdf"):
        stem_txt = target.with_suffix(".txt")
        if stem_txt.exists() and safe_unlink(stem_txt):
            deleted_paths.append(stem_txt.relative_to(course_dir).as_posix())
    elif norm_rel.startswith("lessons/"):
        # Clean sec-XX / day-XX paired alias if applicable
        base = target.stem
        m_sec = re.match(r"^sec-0*(\d+)$", base, re.IGNORECASE)
        m_day = re.match(r"^day-0*(\d+)$", base, re.IGNORECASE)
        num = int(m_sec.group(1)) if m_sec else (int(m_day.group(1)) if m_day else None)
        if num is not None:
            padded = f"{num:02d}"
            for alias_name in (f"sec-{padded}.json", f"day-{padded}.json"):
                alias_path = course_dir / "lessons" / alias_name
                alias_rel = alias_path.relative_to(course_dir).as_posix()
                if alias_rel != norm_rel and alias_path.exists() and safe_unlink(alias_path):
                    deleted_paths.append(alias_rel)

    return {
        "ok": True,
        "deleted": deleted_paths,
        "requestedPath": norm_rel,
    }


def create_course_backup_zip(folder_name: str) -> bytes:
    course_dir = resolve_course_dir(folder_name)
    if not course_dir.exists() or not course_dir.is_dir():
        raise FileNotFoundError(f"课程文件夹不存在: courses/{folder_name}")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, filenames in os.walk(course_dir):
            dirs.sort()
            filenames.sort()
            for fname in filenames:
                abs_file = Path(root) / fname
                rel = abs_file.relative_to(course_dir).as_posix()
                zf.write(abs_file, arcname=f"{folder_name}/{rel}")
    return buf.getvalue()


def restore_course_backup_zip(zip_bytes: bytes, fallback_name: str = "restored_course") -> dict[str, Any]:
    existing = {d.name for d in COURSES_ROOT.iterdir() if d.is_dir()}

    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        members = [m for m in zf.infolist() if not m.is_dir()]
        if not members:
            raise ValueError("压缩包为空，未包含课程文件")

        # Validate every member against Zip Slip
        clean_entries: list[tuple[zipfile.ZipInfo, list[str]]] = []
        top_dirs: set[str] = set()
        for m in members:
            raw_name = m.filename.replace("\\", "/")
            if raw_name.startswith("/") or ":" in raw_name.split("/")[0]:
                raise ValueError(f"压缩包包含非法绝对路径: {m.filename}")
            parts = [p for p in raw_name.split("/") if p not in {"", "."}]
            if any(p == ".." for p in parts):
                raise ValueError(f"压缩包包含越界路径: {m.filename}")
            if not parts:
                continue
            top_dirs.add(parts[0])
            clean_entries.append((m, parts))

        strip_top = len(top_dirs) == 1 and any(len(parts) > 1 for _, parts in clean_entries)
        raw_base = next(iter(top_dirs)) if strip_top else Path(fallback_name).stem
        folder_name = sanitize_folder_name(raw_base, existing=existing)
        target_dir = resolve_course_dir(folder_name)
        target_dir.mkdir(parents=True, exist_ok=True)

        extracted_count = 0
        for m, parts in clean_entries:
            rel_parts = parts[1:] if strip_top else parts
            if not rel_parts:
                continue
            dest = (target_dir / "/".join(rel_parts)).resolve()
            dest.relative_to(target_dir)
            dest.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(m, "r") as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)
            extracted_count += 1

    # Ensure standard subdirectories & clean archived flag + folderName metadata
    for sub in ("sources", "segments", "lessons", "assets"):
        (target_dir / sub).mkdir(parents=True, exist_ok=True)

    course_json_path = target_dir / "course.json"
    course_id = ""
    course_name = folder_name
    if course_json_path.exists():
        try:
            cfg = json.loads(course_json_path.read_text(encoding="utf-8"))
            cfg.pop("archived", None)
            cfg["folderName"] = folder_name
            cfg["courseDirPath"] = f"courses/{folder_name}"
            if not cfg.get("id"):
                cfg["id"] = f"course-{int(time.time() * 1000)}"
            course_id = str(cfg["id"])
            course_name = str(cfg.get("name") or folder_name)
            course_json_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    return {
        "ok": True,
        "folderName": folder_name,
        "courseId": course_id,
        "courseName": course_name,
        "extractedFiles": extracted_count,
        "relDir": f"courses/{folder_name}",
    }


def open_folder_in_os(folder_name: str) -> dict[str, Any]:
    course_dir = resolve_course_dir(folder_name)
    if not course_dir.exists():
        raise FileNotFoundError(f"课程文件夹不存在: courses/{folder_name}")
    sys_name = platform.system()
    abs_str = str(course_dir)

    try:
        if sys_name == "Windows":
            os.startfile(abs_str)  # type: ignore[attr-defined]
            return {"ok": True, "opened": True, "absPath": abs_str}
        if sys_name == "Darwin":
            subprocess.Popen(["open", abs_str])
            return {"ok": True, "opened": True, "absPath": abs_str}
        if os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
            subprocess.Popen(["xdg-open", abs_str])
            return {"ok": True, "opened": True, "absPath": abs_str}
        return {
            "ok": True,
            "opened": False,
            "absPath": abs_str,
            "reason": "当前运行在无桌面图形界面的服务器环境中，已返回本地绝对路径供查阅。",
        }
    except Exception as exc:
        return {
            "ok": True,
            "opened": False,
            "absPath": abs_str,
            "reason": f"未能拉起系统文件管理器: {exc}",
        }


def _copy_windows_file_clipboard_ctypes(abs_path: str) -> None:
    import ctypes
    from ctypes import wintypes

    CF_HDROP = 15
    GMEM_MOVEABLE = 0x0002
    GMEM_ZEROINIT = 0x0040

    dropfiles_header = struct.pack("<IiiII", 20, 0, 0, 0, 1)
    files_data = (abs_path + "\0\0").encode("utf-16le")
    payload = dropfiles_header + files_data

    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    user32 = ctypes.windll.user32  # type: ignore[attr-defined]

    kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel32.GlobalAlloc.restype = ctypes.c_void_p
    kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    kernel32.GlobalUnlock.restype = wintypes.BOOL
    kernel32.GlobalFree.argtypes = [ctypes.c_void_p]
    kernel32.GlobalFree.restype = ctypes.c_void_p

    user32.OpenClipboard.argtypes = [wintypes.HWND]
    user32.OpenClipboard.restype = wintypes.BOOL
    user32.EmptyClipboard.argtypes = []
    user32.EmptyClipboard.restype = wintypes.BOOL
    user32.SetClipboardData.argtypes = [wintypes.UINT, ctypes.c_void_p]
    user32.SetClipboardData.restype = ctypes.c_void_p
    user32.CloseClipboard.argtypes = []
    user32.CloseClipboard.restype = wintypes.BOOL

    h_global = kernel32.GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, len(payload))
    if not h_global:
        raise OSError("GlobalAlloc failed")

    ptr = kernel32.GlobalLock(h_global)
    if not ptr:
        kernel32.GlobalFree(h_global)
        raise OSError("GlobalLock failed")
    try:
        ctypes.memmove(ptr, payload, len(payload))
    finally:
        kernel32.GlobalUnlock(h_global)

    opened = False
    for _ in range(5):
        if user32.OpenClipboard(None):
            opened = True
            break
        time.sleep(0.05)

    if not opened:
        kernel32.GlobalFree(h_global)
        raise OSError("OpenClipboard failed")

    try:
        if not user32.EmptyClipboard():
            kernel32.GlobalFree(h_global)
            raise OSError("EmptyClipboard failed")
        if not user32.SetClipboardData(CF_HDROP, h_global):
            kernel32.GlobalFree(h_global)
            raise OSError("SetClipboardData(CF_HDROP) failed")
    finally:
        user32.CloseClipboard()


def _copy_windows_file_clipboard_powershell(abs_path: str) -> None:
    ps_script = (
        "Add-Type -AssemblyName System.Windows.Forms; "
        "$col = New-Object System.Collections.Specialized.StringCollection; "
        "[void]$col.Add($env:LEARN_COPY_FILE_PATH); "
        "[System.Windows.Forms.Clipboard]::SetFileDropList($col)"
    )
    encoded_cmd = base64.b64encode(ps_script.encode("utf-16le")).decode("ascii")
    env = dict(os.environ)
    env["LEARN_COPY_FILE_PATH"] = abs_path
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encoded_cmd],
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"PowerShell exit {proc.returncode}")


def copy_file_to_os_clipboard(folder_name: str, rel_path: str) -> dict[str, Any]:
    course_dir = resolve_course_dir(folder_name)
    norm_input = rel_path.replace("\\", "/").lstrip("/")
    target = resolve_course_file(course_dir, rel_path)
    norm_rel = target.relative_to(course_dir).as_posix()

    if (not target.exists() or not target.is_file()) and norm_input.startswith("segments/"):
        temp_base = (Path(tempfile.gettempdir()) / "learn_everything_segments" / folder_name).resolve()
        sub_rel = norm_input[len("segments/"):]
        temp_candidate = (temp_base / sub_rel).resolve()
        if temp_candidate.is_relative_to(temp_base) and temp_candidate.exists() and temp_candidate.is_file():
            target = temp_candidate

    if not target.exists() or not target.is_file():
        raise FileNotFoundError(f"文件不存在: {rel_path}")

    abs_str = str(target)
    sys_name = platform.system()

    if sys_name == "Windows":
        try:
            _copy_windows_file_clipboard_ctypes(abs_str)
            return {
                "ok": True,
                "copiedToOsClipboard": True,
                "method": "windows_cf_hdrop",
                "fileName": target.name,
                "relPath": norm_rel,
                "absPath": abs_str,
            }
        except Exception as ctypes_err:
            try:
                _copy_windows_file_clipboard_powershell(abs_str)
                return {
                    "ok": True,
                    "copiedToOsClipboard": True,
                    "method": "windows_powershell_sta",
                    "fileName": target.name,
                    "relPath": norm_rel,
                    "absPath": abs_str,
                }
            except Exception as ps_err:
                return {
                    "ok": True,
                    "copiedToOsClipboard": False,
                    "method": "windows_failed",
                    "fileName": target.name,
                    "relPath": norm_rel,
                    "absPath": abs_str,
                    "reason": f"写入 Windows 文件剪贴板失败: {ctypes_err}; {ps_err}",
                }

    if sys_name == "Darwin":
        try:
            proc = subprocess.run(
                [
                    "osascript",
                    "-e",
                    "on run argv",
                    "-e",
                    "set the clipboard to (POSIX file (item 1 of argv))",
                    "-e",
                    "end run",
                    abs_str,
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if proc.returncode == 0:
                return {
                    "ok": True,
                    "copiedToOsClipboard": True,
                    "method": "macos_osascript",
                    "fileName": target.name,
                    "relPath": norm_rel,
                    "absPath": abs_str,
                }
            raise RuntimeError(proc.stderr.strip() or f"osascript exit {proc.returncode}")
        except Exception as exc:
            return {
                "ok": True,
                "copiedToOsClipboard": False,
                "method": "macos_failed",
                "fileName": target.name,
                "relPath": norm_rel,
                "absPath": abs_str,
                "reason": f"写入 macOS 文件剪贴板失败: {exc}",
            }

    if os.environ.get("WAYLAND_DISPLAY") and shutil.which("wl-copy"):
        try:
            uri = target.as_uri() + "\n"
            proc = subprocess.run(
                ["wl-copy", "-t", "text/uri-list"],
                input=uri.encode("utf-8"),
                capture_output=True,
                timeout=8,
            )
            if proc.returncode == 0:
                return {
                    "ok": True,
                    "copiedToOsClipboard": True,
                    "method": "linux_wl_copy",
                    "fileName": target.name,
                    "relPath": norm_rel,
                    "absPath": abs_str,
                }
        except Exception:
            pass

    if os.environ.get("DISPLAY") and shutil.which("xclip"):
        try:
            uri = target.as_uri() + "\n"
            proc = subprocess.run(
                ["xclip", "-selection", "clipboard", "-t", "text/uri-list"],
                input=uri.encode("utf-8"),
                capture_output=True,
                timeout=8,
            )
            if proc.returncode == 0:
                return {
                    "ok": True,
                    "copiedToOsClipboard": True,
                    "method": "linux_xclip",
                    "fileName": target.name,
                    "relPath": norm_rel,
                    "absPath": abs_str,
                }
        except Exception:
            pass

    return {
        "ok": True,
        "copiedToOsClipboard": False,
        "method": "headless_unsupported",
        "fileName": target.name,
        "relPath": norm_rel,
        "absPath": abs_str,
        "reason": "当前服务运行在无桌面剪贴板的服务器环境中；在 Windows/macOS 本地运行时可直接写入系统文件剪贴板以 Ctrl+V 粘贴。",
    }


def test_llm_connectivity(payload: dict[str, Any]) -> dict[str, Any]:
    provider_mode = payload.get("providerMode") or "builtin_gemini"
    api_base_url = str(payload.get("apiBaseUrl") or "https://api.openai.com/v1").strip().rstrip("/")
    model_name = str(payload.get("modelName") or "").strip()
    api_key = str(payload.get("apiKey") or "").strip()

    if not api_key:
        settings_file = DATA_DIR / "settings.json"
        if settings_file.exists():
            try:
                stored = json.loads(settings_file.read_text(encoding="utf-8"))
                api_key = str(stored.get("customApiKey") or "").strip()
            except Exception:
                pass

    started = time.monotonic()
    if provider_mode == "builtin_gemini":
        gemini_key = os.environ.get("GEMINI_API_KEY") or api_key
        if not gemini_key or gemini_key == "MY_GEMINI_API_KEY":
            return {"ok": False, "error": "未配置 GEMINI_API_KEY 或自定义 API Key"}
        target_model = model_name if model_name.startswith("gemini-") else "gemini-3.8-flash"
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{urllib.parse.quote(target_model)}:generateContent?key={urllib.parse.quote(gemini_key)}"
        )
        req_body = json.dumps(
            {
                "contents": [{"parts": [{"text": "Reply OK"}]}],
                "generationConfig": {"maxOutputTokens": 8},
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=req_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                latency_ms = int((time.monotonic() - started) * 1000)
                return {
                    "ok": 200 <= resp.status < 300,
                    "status": resp.status,
                    "provider": "gemini",
                    "model": target_model,
                    "latencyMs": latency_ms,
                    "message": f"Gemini 接口连通正常 ({target_model}, {latency_ms}ms)",
                }
        except urllib.error.HTTPError as err:
            body_text = err.read().decode("utf-8", errors="ignore")[:240]
            return {"ok": False, "status": err.code, "error": f"Gemini 返回 HTTP {err.code}: {body_text}"}
        except Exception as exc:
            return {"ok": False, "error": f"连接 Gemini 失败: {exc}"}

    # OpenAI-compatible mode
    if not api_key:
        api_key = os.environ.get("OPENAI_API_KEY") or ""
    if not api_key:
        return {"ok": False, "error": "未配置 OpenAI 兼容接口的 API Key"}

    endpoint = api_base_url if api_base_url.endswith("/chat/completions") else f"{api_base_url}/chat/completions"
    target_model = model_name or "gpt-4o-mini"
    req_body = json.dumps(
        {
            "model": target_model,
            "messages": [{"role": "user", "content": "Reply OK"}],
            "max_tokens": 8,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=req_body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            latency_ms = int((time.monotonic() - started) * 1000)
            return {
                "ok": 200 <= resp.status < 300,
                "status": resp.status,
                "provider": "openai_compatible",
                "model": target_model,
                "latencyMs": latency_ms,
                "message": f"OpenAI 兼容接口连通正常 ({target_model}, {latency_ms}ms)",
            }
    except urllib.error.HTTPError as err:
        body_text = err.read().decode("utf-8", errors="ignore")[:240]
        return {"ok": False, "status": err.code, "error": f"接口返回 HTTP {err.code}: {body_text}"}
    except Exception as exc:
        return {"ok": False, "error": f"连接接口失败: {exc}"}


class PythonBackendHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        # Concise server logs without noisy stack traces
        sys.stderr.write(f"[python-backend] {self.address_string()} - {format % args}\n")

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Connection", "close")
        self.close_connection = True

    def _send_json(self, status: int, data: Any) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _send_bytes(
        self,
        status: int,
        data: bytes,
        content_type: str,
        disposition: str | None = None,
    ) -> None:
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if disposition:
            self.send_header("Content-Disposition", disposition)
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        parsed = json.loads(raw.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else {}

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        path_only = parsed.path.rstrip("/")

        try:
            if path_only == "/api/py/health":
                in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "engine": "python",
                        "pythonVersion": platform.python_version(),
                        "pythonExecutable": sys.executable,
                        "inVenv": in_venv,
                        "platform": platform.system(),
                        "rootDir": str(ROOT_DIR),
                        "coursesRoot": str(COURSES_ROOT),
                    },
                )
                return

            if path_only == "/api/py/courses/files":
                folder = (query.get("folder") or [""])[0]
                self._send_json(200, list_course_files(folder))
                return

            if path_only == "/api/py/courses/files/download":
                folder = (query.get("folder") or [""])[0]
                rel_path = (query.get("path") or [""])[0]
                download_flag = (query.get("download") or ["0"])[0] == "1"
                course_dir = resolve_course_dir(folder)
                target = resolve_course_file(course_dir, rel_path)
                if not target.exists() or not target.is_file():
                    self._send_json(404, {"error": f"文件不存在: {rel_path}"})
                    return
                mime, _ = mimetypes.guess_type(target.name)
                if target.suffix.lower() in {".md", ".txt", ".json", ".csv"} and not mime:
                    mime = "text/plain; charset=utf-8"
                content_type = mime or "application/octet-stream"
                if content_type.startswith("text/") and "charset=" not in content_type:
                    content_type += "; charset=utf-8"
                encoded_name = urllib.parse.quote(target.name)
                disp_type = "attachment" if download_flag else "inline"
                disposition = f'{disp_type}; filename="{encoded_name}"; filename*=UTF-8\'\'{encoded_name}'
                self._send_bytes(200, target.read_bytes(), content_type, disposition)
                return

            if path_only == "/api/py/courses/backup":
                folder = (query.get("folder") or [""])[0]
                zip_bytes = create_course_backup_zip(folder)
                encoded_name = urllib.parse.quote(f"{folder}.zip")
                disposition = f'attachment; filename="{encoded_name}"; filename*=UTF-8\'\'{encoded_name}'
                self._send_bytes(200, zip_bytes, "application/zip", disposition)
                return

            self._send_json(404, {"error": f"未知 Python 后端接口: {path_only}"})
        except FileNotFoundError as exc:
            self._send_json(404, {"error": str(exc)})
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception as exc:
            self._send_json(500, {"error": f"Python 后端处理失败: {exc}"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path_only = parsed.path.rstrip("/")

        try:
            body = self._read_json_body()

            if path_only == "/api/py/courses/files/upload":
                res = upload_course_file(
                    folder_name=str(body.get("folder") or ""),
                    category=str(body.get("category") or "sources"),
                    file_name=str(body.get("fileName") or ""),
                    base64_data=body.get("base64Data"),
                    text_content=body.get("textContent"),
                )
                self._send_json(200, res)
                return

            if path_only == "/api/py/courses/restore":
                b64 = str(body.get("base64Zip") or "")
                if "," in b64 and b64.strip().startswith("data:"):
                    b64 = b64.split(",", 1)[1]
                if not b64:
                    raise ValueError("缺少 ZIP 备份数据")
                zip_bytes = base64.b64decode(b64)
                res = restore_course_backup_zip(
                    zip_bytes, fallback_name=str(body.get("fileName") or "restored_course")
                )
                self._send_json(200, res)
                return

            if path_only == "/api/py/courses/open-folder":
                folder = str(body.get("folder") or "")
                self._send_json(200, open_folder_in_os(folder))
                return

            if path_only == "/api/py/courses/files/copy-clipboard":
                folder = str(body.get("folder") or "")
                rel_path = str(body.get("path") or "")
                self._send_json(200, copy_file_to_os_clipboard(folder, rel_path))
                return

            if path_only == "/api/py/settings/test-llm":
                result = test_llm_connectivity(body)
                self._send_json(200 if result.get("ok") else 400, result)
                return

            self._send_json(404, {"error": f"未知 Python 后端接口: {path_only}"})
        except zipfile.BadZipFile:
            self._send_json(400, {"error": "无效的 ZIP 备份压缩包"})
        except FileNotFoundError as exc:
            self._send_json(404, {"error": str(exc)})
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception as exc:
            self._send_json(500, {"error": f"Python 后端处理失败: {exc}"})

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        path_only = parsed.path.rstrip("/")

        try:
            if path_only == "/api/py/courses/files":
                folder = (query.get("folder") or [""])[0]
                rel_path = (query.get("path") or [""])[0]
                self._send_json(200, delete_course_file(folder, rel_path))
                return

            if path_only == "/api/py/courses/folder":
                folder = (query.get("folder") or [""])[0]
                course_dir = resolve_course_dir(folder)
                existed = course_dir.exists()
                safe_rmtree(course_dir)
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "folderName": folder,
                        "existed": existed,
                        "deleted": not course_dir.exists(),
                    },
                )
                return

            self._send_json(404, {"error": f"未知 Python 后端接口: {path_only}"})
        except FileNotFoundError as exc:
            self._send_json(404, {"error": str(exc)})
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception as exc:
            self._send_json(500, {"error": f"Python 后端删除失败: {exc}"})


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request: Any, client_address: Any) -> None:
        exc_type, _, _ = sys.exc_info()
        if exc_type is not None and issubclass(
            exc_type, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)
        ):
            # Harmless client disconnect / Windows keep-alive socket reset (WinError 10054)
            return
        super().handle_error(request, client_address)


def create_server(host: str = "127.0.0.1", port: int = DEFAULT_PORT) -> ThreadingHTTPServer:
    return QuietThreadingHTTPServer((host, port), PythonBackendHandler)


def main() -> None:
    host = os.environ.get("PYTHON_BACKEND_HOST") or "127.0.0.1"
    port = int(os.environ.get("PYTHON_BACKEND_PORT") or DEFAULT_PORT)
    server = create_server(host=host, port=port)

    def _shutdown_handler(_signum: int, _frame: Any) -> None:
        server.shutdown()
        server.server_close()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown_handler)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _shutdown_handler)

    print(f"Learn_everything Python backend listening on http://{host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
