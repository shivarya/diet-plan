#!/usr/bin/env python3
"""
Stage A of the YouTube recipe-import pipeline (see scripts/youtube/README.md).

Deterministic, no AI. Lists every video on each configured channel via the
YouTube Data API (API key only, no login), fetches the full title/description,
and best-effort fetches the auto/manual caption transcript. Both are login-free:
the Data API needs only a free API key (no OAuth), and the transcript fetch is
an unofficial but unauthenticated endpoint — it works without logging into
YouTube, but IT MUST RUN FROM YOUR OWN MACHINE, not a cloud/VPS host, which
YouTube's caption endpoint blocks aggressively.

  export YOUTUBE_API_KEY=...
  python scripts/youtube/fetch.py                    # every channel in channels.json
  python scripts/youtube/fetch.py --channel @handle   # just one channel
  python scripts/youtube/fetch.py --limit 20          # cap videos per channel (smoke test)

Output: server/database/seed/youtube/raw/<handle>/<video_id>.json
        { video_id, url, channel, channel_handle, title, description,
          transcript, duration_s, published_at }
Resumable: existing raw files are skipped unless --force.
"""
import argparse
import json
import os
import re
import sys
import time

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_DIR = os.path.join(HERE, "..", "..", "database", "seed")
CHANNELS_FILE = os.path.join(HERE, "channels.json")
RAW_DIR = os.path.join(SEED_DIR, "youtube", "raw")

DURATION_RE = re.compile(r"P(?:\d+D)?T(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?(?:(?P<s>\d+)S)?")


def parse_duration(iso):
    """ISO 8601 duration (e.g. 'PT14M3S') -> seconds. No extra dependency needed."""
    m = DURATION_RE.match(iso or "")
    if not m:
        return 0
    h, mi, s = (int(m.group(k) or 0) for k in ("h", "m", "s"))
    return h * 3600 + mi * 60 + s


def uploads_playlist_id(youtube, handle):
    resp = youtube.channels().list(part="contentDetails,snippet", forHandle=handle).execute()
    items = resp.get("items") or []
    if not items:
        sys.exit(f"ERROR: no channel found for handle {handle!r}")
    ch = items[0]
    return ch["contentDetails"]["relatedPlaylists"]["uploads"], ch["snippet"]["title"]


def list_video_ids(youtube, playlist_id, limit=None):
    ids, token = [], None
    while True:
        resp = youtube.playlistItems().list(
            part="contentDetails", playlistId=playlist_id, maxResults=50, pageToken=token
        ).execute()
        ids.extend(i["contentDetails"]["videoId"] for i in resp.get("items", []))
        token = resp.get("nextPageToken")
        if not token or (limit and len(ids) >= limit):
            break
    return ids[:limit] if limit else ids


def video_details(youtube, video_ids):
    """videos().list in batches of 50 -> {id: {title, description, duration_s, published_at}}."""
    out = {}
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i + 50]
        resp = youtube.videos().list(part="snippet,contentDetails", id=",".join(batch)).execute()
        for item in resp.get("items", []):
            snip = item["snippet"]
            out[item["id"]] = {
                "title": snip.get("title", ""),
                "description": snip.get("description", ""),
                "published_at": snip.get("publishedAt"),
                "duration_s": parse_duration(item["contentDetails"].get("duration")),
            }
    return out


def fetch_transcript(video_id):
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        sys.exit("ERROR: pip install youtube-transcript-api")
    try:
        try:
            fetched = YouTubeTranscriptApi().fetch(video_id)          # current (v1.x) instance API
        except AttributeError:
            fetched = YouTubeTranscriptApi.get_transcript(video_id)   # older static API
        parts = []
        for snippet in fetched:
            text = getattr(snippet, "text", None)
            if text is None and isinstance(snippet, dict):
                text = snippet.get("text")
            if text:
                parts.append(text)
        return " ".join(parts).strip() or None
    except Exception as e:
        print(f"    transcript unavailable ({type(e).__name__}): {video_id}")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channels-file", default=CHANNELS_FILE)
    ap.add_argument("--channel", help="only fetch this one @handle")
    ap.add_argument("--limit", type=int, help="cap videos per channel (newest first)")
    ap.add_argument("--min-duration", type=int, default=90,
                     help="skip videos shorter than this many seconds (filters Shorts)")
    ap.add_argument("--sleep", type=float, default=1.0, help="seconds between transcript fetches")
    ap.add_argument("--force", action="store_true", help="refetch videos that already have a raw JSON file")
    args = ap.parse_args()

    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        sys.exit("ERROR: set YOUTUBE_API_KEY in the environment first.")

    channels = json.load(open(args.channels_file, encoding="utf-8"))
    if args.channel:
        channels = [c for c in channels if c["handle"] == args.channel]
        if not channels:
            sys.exit(f"ERROR: {args.channel!r} not found in {args.channels_file}")

    youtube = build("youtube", "v3", developerKey=api_key)

    for chan in channels:
        handle = chan["handle"]
        print(f"\n=== {handle} ===")
        try:
            playlist_id, channel_title = uploads_playlist_id(youtube, handle)
        except HttpError as e:
            print(f"  ERROR resolving channel: {e}")
            continue

        video_ids = list_video_ids(youtube, playlist_id, args.limit)
        print(f"  {len(video_ids)} videos found")
        details = video_details(youtube, video_ids)

        out_dir = os.path.join(RAW_DIR, handle.lstrip("@"))
        os.makedirs(out_dir, exist_ok=True)

        fetched = skipped_existing = skipped_short = 0
        for vid in video_ids:
            out_path = os.path.join(out_dir, f"{vid}.json")
            if os.path.exists(out_path) and not args.force:
                skipped_existing += 1
                continue
            d = details.get(vid)
            if not d:
                continue
            if d["duration_s"] < args.min_duration:
                skipped_short += 1
                continue

            transcript = fetch_transcript(vid)
            time.sleep(args.sleep)

            record = {
                "video_id": vid,
                "url": f"https://www.youtube.com/watch?v={vid}",
                "channel": channel_title,
                "channel_handle": handle,
                "title": d["title"],
                "description": d["description"],
                "transcript": transcript,
                "duration_s": d["duration_s"],
                "published_at": d["published_at"],
            }
            json.dump(record, open(out_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
            fetched += 1

        print(f"  fetched={fetched} skipped(existing)={skipped_existing} skipped(short)={skipped_short}")

    print(f"\nDone. Raw videos under {os.path.relpath(RAW_DIR, os.path.join(HERE, '..', '..'))}")
    print("Next: python scripts/youtube/extract.py --smoke 10")


if __name__ == "__main__":
    sys.exit(main())
