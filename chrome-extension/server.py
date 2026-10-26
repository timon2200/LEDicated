#!/usr/bin/env python3
"""
YouTube Plus Local Companion Server v1.4
High-speed local media processing powered by yt-dlp, ffmpeg, and node.
Features:
- 100% Native macOS Quick Look (Finder spacebar) & QuickTime Player compatibility
- Automatic hardware-accelerated transcoding (Apple VideoToolbox H.264 + AAC) if YouTube only provides VP9/AV1/Opus
- Direct downloads to ~/Downloads folder
Runs on http://127.0.0.1:5000
"""

import os
import sys
import json
import time
import shutil
import pathlib
import threading
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = 5000
DOWNLOADS_DIR = os.path.expanduser("~/Downloads")

def find_binary(name):
    path = shutil.which(name)
    if path:
        return path
    common_paths = [
        f"/opt/homebrew/bin/{name}",
        f"/usr/local/bin/{name}",
        f"/usr/bin/{name}",
        f"{os.path.expanduser('~')}/.nvm/versions/node/current/bin/{name}",
        f"{os.path.expanduser('~')}/.local/bin/{name}"
    ]
    for p in common_paths:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return name

YTDLP_BIN = find_binary("yt-dlp")
FFMPEG_BIN = find_binary("ffmpeg")
FFPROBE_BIN = find_binary("ffprobe")
NODE_BIN = find_binary("node")

active_jobs = {}
jobs_lock = threading.Lock()

def clean_video_url(url):
    if not url:
        return ""
    if "youtu.be/" in url:
        vid = url.split("youtu.be/")[1].split("?")[0].split("&")[0]
        return f"https://www.youtube.com/watch?v={vid}"
    if "watch?v=" in url:
        vid = url.split("watch?v=")[1].split("&")[0]
        return f"https://www.youtube.com/watch?v={vid}"
    if "/shorts/" in url:
        vid = url.split("/shorts/")[1].split("?")[0].split("&")[0]
        return f"https://www.youtube.com/watch?v={vid}"
    return url.split("&")[0]

def get_file_codecs(file_path):
    if not os.path.isfile(file_path):
        return None, None
    try:
        cmd_v = [FFPROBE_BIN, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1", file_path]
        cmd_a = [FFPROBE_BIN, "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1", file_path]
        v = subprocess.run(cmd_v, capture_output=True, text=True, timeout=5).stdout.strip().lower()
        a = subprocess.run(cmd_a, capture_output=True, text=True, timeout=5).stdout.strip().lower()
        return v or None, a or None
    except Exception:
        return None, None

def ensure_apple_quicklook_compatible(file_path, job_id=None):
    """
    Ensures that the output video file is 100% compatible with macOS Quick Look (Finder spacebar)
    and QuickTime Player (H.264 / HEVC video + AAC audio + faststart).
    If YouTube only provided VP9, AV1, Opus, or another codec, automatically converts it using
    Apple VideoToolbox hardware acceleration.
    """
    if not os.path.isfile(file_path) or not file_path.endswith('.mp4'):
        return

    v_codec, a_codec = get_file_codecs(file_path)
    if not v_codec:
        return

    APPLE_COMPATIBLE_VIDEO = ["h264", "hevc", "prores"]
    APPLE_COMPATIBLE_AUDIO = ["aac", "alac", "mp3"]

    needs_v_transcode = v_codec not in APPLE_COMPATIBLE_VIDEO
    needs_a_transcode = a_codec and a_codec not in APPLE_COMPATIBLE_AUDIO

    if not needs_v_transcode and not needs_a_transcode:
        return

    if job_id:
        with jobs_lock:
            if job_id in active_jobs:
                active_jobs[job_id]["status"] = "converting"

    tmp_out = file_path + ".ql_temp.mp4"

    # Try Apple hardware accelerated VideoToolbox first, fallback to libx264
    v_args = ["-c:v", "h264_videotoolbox", "-q:v", "65"] if needs_v_transcode else ["-c:v", "copy"]
    a_args = ["-c:a", "aac", "-b:a", "192k"] if needs_a_transcode else ["-c:a", "copy"]

    cmd = [FFMPEG_BIN, "-y", "-i", file_path] + v_args + a_args + ["-movflags", "+faststart", tmp_out]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if res.returncode == 0 and os.path.isfile(tmp_out) and os.path.getsize(tmp_out) > 0:
            os.replace(tmp_out, file_path)
            return
    except Exception:
        pass

    # Fallback to software libx264
    if needs_v_transcode:
        v_args_fallback = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]
        cmd_fallback = [FFMPEG_BIN, "-y", "-i", file_path] + v_args_fallback + a_args + ["-movflags", "+faststart", tmp_out]
        try:
            res2 = subprocess.run(cmd_fallback, capture_output=True, text=True, timeout=300)
            if res2.returncode == 0 and os.path.isfile(tmp_out) and os.path.getsize(tmp_out) > 0:
                os.replace(tmp_out, file_path)
        except Exception:
            pass

    if os.path.isfile(tmp_out):
        try: os.remove(tmp_out)
        except Exception: pass


def run_download_task(job_id, raw_url, media_type, quality, custom_title):
    url = clean_video_url(raw_url)

    with jobs_lock:
        active_jobs[job_id] = {
            "id": job_id,
            "url": url,
            "type": media_type,
            "quality": quality,
            "status": "downloading",
            "progress": 0,
            "filename": None,
            "error": None,
            "started_at": time.time()
        }

    output_template = os.path.join(DOWNLOADS_DIR, "%(title).150B.%(ext)s")

    cmd = [
        YTDLP_BIN,
        "--newline",
        "--no-playlist",
        "--force-overwrites",
        "--no-mtime",
        "--ffmpeg-location", FFMPEG_BIN,
        "-o", output_template
    ]

    if os.path.exists(NODE_BIN):
        cmd.extend(["--js-runtimes", f"node:{NODE_BIN}"])

    if media_type == "mp3":
        bitrate = quality if quality in ["320", "256", "192", "128"] else "320"
        cmd.extend([
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", f"{bitrate}k",
            "--embed-thumbnail",
            "--add-metadata"
        ])
    else:
        # MP4 Video: Try native H.264 + AAC first
        q_limit = quality if quality in ["2160", "1440", "1080", "720", "480", "360"] else "1080"
        cmd.extend([
            "-S", f"res:{q_limit},vcodec:h264,acodec:m4a",
            "--merge-output-format", "mp4",
            "--postprocessor-args", "ffmpeg:-movflags +faststart"
        ])

    cmd.append(url)

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        final_filename = None
        full_dest_path = None
        last_lines = []

        for line in process.stdout:
            line_str = line.strip()
            if line_str:
                last_lines.append(line_str)
                if len(last_lines) > 10:
                    last_lines.pop(0)

            # Parse progress percentage
            if "[download]" in line_str and "%" in line_str:
                parts = line_str.split()
                for p in parts:
                    if p.endswith("%"):
                        try:
                            pct = float(p.replace("%", ""))
                            with jobs_lock:
                                if job_id in active_jobs:
                                    active_jobs[job_id]["progress"] = pct
                        except ValueError:
                            pass

            if "[Merger] Merging formats into" in line_str or "[ExtractAudio] Destination:" in line_str or "[download] Destination:" in line_str:
                raw_path = line_str.split(":", 1)[-1].strip().strip('"')
                final_filename = os.path.basename(raw_path)
                full_dest_path = os.path.join(DOWNLOADS_DIR, final_filename)

        process.wait()
        if process.returncode == 0:
            # Check and convert to Apple Quick Look compatibility if needed (for VP9/AV1/Opus)
            if media_type == "mp4" and full_dest_path and os.path.isfile(full_dest_path):
                ensure_apple_quicklook_compatible(full_dest_path, job_id)

            with jobs_lock:
                active_jobs[job_id]["status"] = "finished"
                active_jobs[job_id]["progress"] = 100
                active_jobs[job_id]["filename"] = final_filename or "Downloaded Media.mp4"
        else:
            err_msg = "Download error"
            for l in reversed(last_lines):
                if "ERROR:" in l:
                    err_msg = l.replace("ERROR:", "").strip()
                    break
            with jobs_lock:
                active_jobs[job_id]["status"] = "error"
                active_jobs[job_id]["error"] = err_msg

    except Exception as e:
        with jobs_lock:
            active_jobs[job_id]["status"] = "error"
            active_jobs[job_id]["error"] = str(e)


class CompanionHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Accept')

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self._send_cors()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ["/health", "/status", "/"]:
            with jobs_lock:
                recent = list(active_jobs.values())[-10:]
            self._send_json(200, {
                "status": "online",
                "ytdlp": bool(shutil.which(YTDLP_BIN) or os.path.exists(YTDLP_BIN)),
                "ffmpeg": bool(shutil.which(FFMPEG_BIN) or os.path.exists(FFMPEG_BIN)),
                "node": bool(shutil.which(NODE_BIN) or os.path.exists(NODE_BIN)),
                "downloads_dir": DOWNLOADS_DIR,
                "version": "1.4.0",
                "recent_jobs": recent
            })
            return

        if path.startswith("/job/"):
            job_id = path.replace("/job/", "").strip()
            with jobs_lock:
                job = active_jobs.get(job_id)
            if job:
                self._send_json(200, {"success": True, "job": job})
            else:
                self._send_json(404, {"success": False, "error": "Job not found"})
            return

        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}

        if path == "/download":
            url = payload.get("url") or payload.get("videoUrl")
            media_type = payload.get("type", "mp4")
            quality = payload.get("quality", "1080")
            title = payload.get("title")

            if not url:
                self._send_json(400, {"success": False, "error": "URL is required"})
                return

            job_id = f"job_{int(time.time() * 1000)}"
            t = threading.Thread(
                target=run_download_task,
                args=(job_id, url, media_type, quality, title),
                daemon=True
            )
            t.start()

            self._send_json(200, {
                "success": True,
                "jobId": job_id,
                "status": "downloading",
                "message": f"Started {media_type.upper()} ({quality}) download"
            })
            return

        if path == "/open-downloads":
            try:
                subprocess.Popen(["open", DOWNLOADS_DIR])
                self._send_json(200, {"success": True, "message": "Opened Downloads folder"})
            except Exception as e:
                self._send_json(500, {"success": False, "error": str(e)})
            return

        self._send_json(404, {"error": "Unknown endpoint"})

    def log_message(self, format, *args):
        pass


def run_server():
    server = HTTPServer(('127.0.0.1', PORT), CompanionHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()

if __name__ == '__main__':
    run_server()
