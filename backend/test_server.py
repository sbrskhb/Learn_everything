#!/usr/bin/env python3
"""Unit and HTTP integration tests for backend/server.py."""

from __future__ import annotations

import base64
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from unittest import mock

import backend.server as py_server


class TestPythonBackend(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.courses_root = self.root / "courses"
        self.data_dir = self.root / "data"
        self.courses_root.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)

        self._orig_root = py_server.ROOT_DIR
        self._orig_courses = py_server.COURSES_ROOT
        self._orig_data = py_server.DATA_DIR
        py_server.ROOT_DIR = self.root
        py_server.COURSES_ROOT = self.courses_root
        py_server.DATA_DIR = self.data_dir

        # Seed a test course directory
        self.folder = "线性代数_测试"
        self.course_dir = self.courses_root / self.folder
        for sub in ("sources", "segments", "lessons", "assets"):
            (self.course_dir / sub).mkdir(parents=True, exist_ok=True)
        (self.course_dir / "course.json").write_text(
            json.dumps({"id": "course-1", "name": "线性代数 测试"}, ensure_ascii=False),
            encoding="utf-8",
        )
        (self.course_dir / "outline.json").write_text(
            json.dumps({"courseId": "course-1", "days": []}, ensure_ascii=False),
            encoding="utf-8",
        )
        (self.course_dir / "sources" / "book.pdf").write_bytes(b"%PDF-1.4\n%test\n")
        (self.course_dir / "sources" / "book.pdf.pages.json").write_text("{}", encoding="utf-8")
        (self.course_dir / "sources" / "book.pdf.txt").write_text("text", encoding="utf-8")
        (self.course_dir / "segments" / "region-01.pdf").write_bytes(b"%PDF-1.4\n%seg\n")
        (self.course_dir / "segments" / "region-01.txt").write_text("seg text", encoding="utf-8")
        (self.course_dir / "lessons" / "sec-01.json").write_text('{"title":"L1"}', encoding="utf-8")
        (self.course_dir / "lessons" / "day-01.json").write_text('{"title":"L1"}', encoding="utf-8")
        (self.course_dir / "assets" / "diag.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    def tearDown(self) -> None:
        py_server.ROOT_DIR = self._orig_root
        py_server.COURSES_ROOT = self._orig_courses
        py_server.DATA_DIR = self._orig_data
        self._tmp.cleanup()

    def test_list_and_path_traversal_guard(self) -> None:
        listing = py_server.list_course_files(self.folder)
        rels = {f["relPath"] for f in listing["files"]}
        self.assertIn("sources/book.pdf", rels)
        self.assertIn("segments/region-01.pdf", rels)
        self.assertIn("lessons/sec-01.json", rels)
        self.assertIn("assets/diag.png", rels)

        with self.assertRaises(ValueError):
            py_server.resolve_course_dir("../etc")
        with self.assertRaises(ValueError):
            py_server.resolve_course_file(self.course_dir, "../../secret.txt")

    def test_delete_single_files_and_companions(self) -> None:
        # Protected core files cannot be deleted via file delete
        with self.assertRaises(ValueError):
            py_server.delete_course_file(self.folder, "course.json")
        with self.assertRaises(ValueError):
            py_server.delete_course_file(self.folder, "outline.json")

        # Deleting sec-01.json also cleans day-01.json
        res_lesson = py_server.delete_course_file(self.folder, "lessons/sec-01.json")
        self.assertEqual(set(res_lesson["deleted"]), {"lessons/sec-01.json", "lessons/day-01.json"})
        self.assertFalse((self.course_dir / "lessons" / "sec-01.json").exists())
        self.assertFalse((self.course_dir / "lessons" / "day-01.json").exists())

        # Deleting segment PDF also cleans .txt
        res_seg = py_server.delete_course_file(self.folder, "segments/region-01.pdf")
        self.assertEqual(set(res_seg["deleted"]), {"segments/region-01.pdf", "segments/region-01.txt"})
        self.assertFalse((self.course_dir / "segments" / "region-01.pdf").exists())

        # Deleting source PDF also cleans .pages.json and .txt
        res_src = py_server.delete_course_file(self.folder, "sources/book.pdf")
        self.assertEqual(
            set(res_src["deleted"]),
            {"sources/book.pdf", "sources/book.pdf.pages.json", "sources/book.pdf.txt"},
        )
        self.assertFalse((self.course_dir / "sources" / "book.pdf").exists())

    def test_upload_and_zip_backup_restore(self) -> None:
        up = py_server.upload_course_file(
            self.folder, "sources", "notes?.md", text_content="# Notes\nHello"
        )
        self.assertEqual(up["fileName"], "notes_.md")
        self.assertTrue((self.course_dir / "sources" / "notes_.md").exists())

        zip_bytes = py_server.create_course_backup_zip(self.folder)
        restored = py_server.restore_course_backup_zip(zip_bytes, fallback_name="backup.zip")
        self.assertTrue(restored["ok"])
        self.assertNotEqual(restored["folderName"], self.folder)
        restored_dir = self.courses_root / restored["folderName"]
        self.assertTrue((restored_dir / "sources" / "notes_.md").exists())
        self.assertTrue((restored_dir / "assets" / "diag.png").exists())

        # Reject Zip Slip archive
        bad_buf = io.BytesIO()
        with zipfile.ZipFile(bad_buf, "w") as zf:
            zf.writestr("../../evil.txt", "pwn")
        with self.assertRaises(ValueError):
            py_server.restore_course_backup_zip(bad_buf.getvalue())

    def test_http_server_endpoints_and_folder_delete(self) -> None:
        srv = py_server.create_server("127.0.0.1", 0)
        port = srv.server_address[1]
        thread = threading.Thread(target=srv.serve_forever, daemon=True)
        thread.start()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/py/health") as resp:
                health = json.loads(resp.read().decode("utf-8"))
                self.assertTrue(health["ok"])
                self.assertEqual(health["engine"], "python")

            # Delete asset via HTTP DELETE
            encoded_folder = urllib.parse.quote(self.folder)
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/py/courses/files?folder={encoded_folder}&path=assets%2Fdiag.png",
                method="DELETE",
            )
            with urllib.request.urlopen(req) as resp:
                del_res = json.loads(resp.read().decode("utf-8"))
                self.assertEqual(del_res["deleted"], ["assets/diag.png"])
            self.assertFalse((self.course_dir / "assets" / "diag.png").exists())

            # Delete entire folder via HTTP DELETE
            req_dir = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/py/courses/folder?folder={encoded_folder}",
                method="DELETE",
            )
            with urllib.request.urlopen(req_dir) as resp:
                dir_res = json.loads(resp.read().decode("utf-8"))
                self.assertTrue(dir_res["deleted"])
            self.assertFalse(self.course_dir.exists())
        finally:
            srv.shutdown()
            srv.server_close()

    def test_copy_file_to_os_clipboard(self) -> None:
        # Missing file raises FileNotFoundError
        with self.assertRaises(FileNotFoundError):
            py_server.copy_file_to_os_clipboard(self.folder, "segments/missing.pdf")

        # Path traversal raises ValueError
        with self.assertRaises(ValueError):
            py_server.copy_file_to_os_clipboard(self.folder, "../../etc/passwd")

        # Simulated Windows CF_HDROP success
        with mock.patch("backend.server.platform.system", return_value="Windows"), mock.patch(
            "backend.server._copy_windows_file_clipboard_ctypes"
        ) as mock_ctypes:
            res = py_server.copy_file_to_os_clipboard(self.folder, "segments/region-01.pdf")
            self.assertTrue(res["ok"])
            self.assertTrue(res["copiedToOsClipboard"])
            self.assertEqual(res["method"], "windows_cf_hdrop")
            self.assertEqual(res["fileName"], "region-01.pdf")
            mock_ctypes.assert_called_once()

        # Simulated Windows ctypes fallback to PowerShell STA
        with mock.patch("backend.server.platform.system", return_value="Windows"), mock.patch(
            "backend.server._copy_windows_file_clipboard_ctypes", side_effect=OSError("busy")
        ), mock.patch("backend.server._copy_windows_file_clipboard_powershell") as mock_ps:
            res_ps = py_server.copy_file_to_os_clipboard(self.folder, "segments/region-01.pdf")
            self.assertTrue(res_ps["copiedToOsClipboard"])
            self.assertEqual(res_ps["method"], "windows_powershell_sta")
            mock_ps.assert_called_once()

        # HTTP endpoint test
        srv = py_server.create_server("127.0.0.1", 0)
        port = srv.server_address[1]
        thread = threading.Thread(target=srv.serve_forever, daemon=True)
        thread.start()
        try:
            body = json.dumps({"folder": self.folder, "path": "segments/region-01.pdf"}).encode("utf-8")
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/py/courses/files/copy-clipboard",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                self.assertTrue(data["ok"])
                self.assertEqual(data["relPath"], "segments/region-01.pdf")
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main()
