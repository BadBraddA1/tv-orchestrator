#!/usr/bin/env python3
"""Bootstrap Orca station folders into ErsatzTV channels (local Other Videos).

Run inside the orca CT (or any host that can reach ErsatzTV + the staging mount):

  python3 bootstrap-ersatztv-channels.py

Requires: ffmpeg on PATH, ErsatzTV at ERSATZTV_URL (default http://127.0.0.1:8409),
staging at CHANNELS_STAGING (default /mnt/channels), and the ersatztv sqlite volume.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

STATIONS = [
    (3, "Cops 24/7", "cops"),
    (5, "Comedy", "comedy"),
    (7, "Below Deck", "below-deck"),
    (9, "Kitchen Heat", "kitchen-heat"),
    (11, "Toon Box", "toon-box"),
]

ETV = os.environ.get("ERSATZTV_URL", "http://127.0.0.1:8409").rstrip("/")
STAGING = Path(os.environ.get("CHANNELS_STAGING", "/mnt/channels"))
DB = Path(
    os.environ.get(
        "ERSATZTV_DB",
        "/var/lib/docker/volumes/tv-orchestrator_ersatztv-config/_data/ersatztv.sqlite3",
    )
)
# Other Videos library id in a fresh ETV install
OTHER_VIDEOS_LIBRARY_ID = int(os.environ.get("OTHER_VIDEOS_LIBRARY_ID", "4"))


def sh(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.check_call(cmd)


def ffmpeg_bin() -> str:
    for p in (
        os.environ.get("FFMPEG"),
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ):
        if p and Path(p).exists():
            return p
    # Prefer ErsatzTV container ffmpeg (always present in our compose)
    try:
        subprocess.check_call(
            ["docker", "exec", "orca-ersatztv", "ffmpeg", "-version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return "docker-ersatztv"
    except Exception:
        pass
    which = subprocess.run(["which", "ffmpeg"], capture_output=True, text=True)
    if which.returncode == 0 and which.stdout.strip():
        return which.stdout.strip()
    raise SystemExit("ffmpeg not found (host or orca-ersatztv container)")


def ensure_stubs() -> None:
    STAGING.mkdir(parents=True, exist_ok=True)
    ff = ffmpeg_bin()
    for _num, name, slug in STATIONS:
        d = STAGING / slug
        d.mkdir(parents=True, exist_ok=True)
        out = d / f"{slug}-placeholder.mp4"
        if out.exists() and out.stat().st_size > 10_000:
            print(f"stub ok {out}")
            continue
        label = name.replace(":", "-").replace("'", "")
        # Container sees staging at /media/channels
        container_out = f"/media/channels/{slug}/{slug}-placeholder.mp4"
        # No drawtext — some ETV ffmpeg builds omit that filter
        if ff == "docker-ersatztv":
            cmd = [
                "docker",
                "exec",
                "orca-ersatztv",
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"color=c=0x1a1a2e:s=1280x720:d=60",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=44100:cl=stereo",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                "-t",
                "60",
                "-metadata",
                f"title={label}",
                container_out,
            ]
        else:
            cmd = [
                ff,
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x1a1a2e:s=1280x720:d=60",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=44100:cl=stereo",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                "-t",
                "60",
                "-metadata",
                f"title={label}",
                str(out),
            ]
        sh(cmd)


def db_connect() -> sqlite3.Connection:
    # Writer: allow WAL; ETV may be running — we keep writes minimal
    con = sqlite3.connect(str(DB), timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=30000")
    return con


def ensure_library_path(con: sqlite3.Connection) -> int:
    path = "/media/channels"
    row = con.execute(
        "SELECT Id FROM LibraryPath WHERE Path = ? AND LibraryId = ?",
        (path, OTHER_VIDEOS_LIBRARY_ID),
    ).fetchone()
    if row:
        print(f"LibraryPath exists id={row['Id']}")
        return int(row["Id"])
    cur = con.execute(
        "INSERT INTO LibraryPath (Path, LibraryId, LastScan) VALUES (?, ?, ?)",
        (path, OTHER_VIDEOS_LIBRARY_ID, "0001-01-01 00:00:00"),
    )
    con.commit()
    print(f"LibraryPath created id={cur.lastrowid}")
    return int(cur.lastrowid)


def scan_library() -> None:
    url = f"{ETV}/api/libraries/{OTHER_VIDEOS_LIBRARY_ID}/scan"
    req = urllib.request.Request(url, method="POST", data=b"")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            print(f"scan POST {res.status}")
    except Exception as e:
        print(f"scan request: {e} (continuing — ETV may scan on its own)")


def wait_for_media(con: sqlite3.Connection, timeout: int = 180) -> list[sqlite3.Row]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = list(
            con.execute(
                """
                SELECT mf.Id AS FileId, mf.Path, mi.Id AS MediaItemId, mf.PathHash
                FROM MediaFile mf
                JOIN MediaVersion mv ON mv.Id = mf.MediaVersionId
                JOIN OtherVideo ov ON ov.Id = mv.OtherVideoId
                JOIN MediaItem mi ON mi.Id = ov.Id
                WHERE mf.Path LIKE '/media/channels/%'
                """
            )
        )
        if rows:
            print(f"found {len(rows)} media files")
            return rows
        print("waiting for scan…")
        time.sleep(5)
        # reconnect in case WAL snapshot is stale
        con.execute("SELECT 1").fetchone()
    raise SystemExit("Timed out waiting for ErsatzTV to scan /media/channels")


def upsert_channels(con: sqlite3.Connection) -> dict[str, int]:
    """Return slug -> Channel.Id"""
    # Retire default channel 1 placeholder name if still default
    con.execute(
        """
        UPDATE Channel SET Name = 'Orca Idle', Number = '99', SortNumber = 99.0, ShowInEpg = 0, IsEnabled = 0
        WHERE Number = '1' AND Name = 'ErsatzTV'
        """
    )
    out: dict[str, int] = {}
    for num, name, slug in STATIONS:
        row = con.execute("SELECT Id FROM Channel WHERE Number = ?", (str(num),)).fetchone()
        if row:
            con.execute(
                """
                UPDATE Channel SET Name=?, SortNumber=?, Group=?, IsEnabled=1, ShowInEpg=1,
                  StreamingMode=5, FFmpegProfileId=1
                WHERE Id=?
                """,
                (name, float(num), "Orca Broadcast", row["Id"]),
            )
            out[slug] = int(row["Id"])
            print(f"updated channel {num} {name} id={row['Id']}")
            continue
        uid = str(uuid.uuid4()).upper()
        cur = con.execute(
            """
            INSERT INTO Channel (
              Categories, FFmpegProfileId, FallbackFillerId, "Group", IdleBehavior, IsEnabled,
              MirrorSourceChannelId, MusicVideoCreditsMode, MusicVideoCreditsTemplate, Name, Number,
              PlayoutMode, PlayoutOffset, PlayoutSource, PreferredAudioLanguageCode, PreferredAudioTitle,
              PreferredSubtitleLanguageCode, ShowInEpg, SongVideoMode, SortNumber, StreamSelector,
              StreamSelectorMode, StreamingMode, SubtitleMode, TranscodeMode, UniqueId, WatermarkId, SoftSeconds
            ) VALUES (
              NULL, 1, NULL, 'Orca Broadcast', 0, 1,
              NULL, 0, NULL, ?, ?,
              0, NULL, 0, NULL, NULL,
              NULL, 1, 0, ?, NULL,
              0, 5, 0, 0, ?, NULL, NULL
            )
            """,
            (name, str(num), float(num), uid),
        )
        # SoftSeconds may not exist — retry without it if needed
        out[slug] = int(cur.lastrowid)
        print(f"created channel {num} {name} id={cur.lastrowid}")
    con.commit()
    return out


def upsert_channels_safe(con: sqlite3.Connection) -> dict[str, int]:
    cols = {r[1] for r in con.execute("PRAGMA table_info(Channel)")}
    out: dict[str, int] = {}
    con.execute(
        """
        UPDATE Channel SET Name = 'Orca Idle', Number = '99', SortNumber = 99.0, ShowInEpg = 0, IsEnabled = 0
        WHERE Number = '1' AND Name = 'ErsatzTV'
        """
    )
    for num, name, slug in STATIONS:
        row = con.execute("SELECT Id FROM Channel WHERE Number = ?", (str(num),)).fetchone()
        if row:
            con.execute(
                """
                UPDATE Channel SET Name=?, SortNumber=?, "Group"=?, IsEnabled=1, ShowInEpg=1,
                  StreamingMode=5, FFmpegProfileId=1
                WHERE Id=?
                """,
                (name, float(num), "Orca Broadcast", int(row["Id"])),
            )
            out[slug] = int(row["Id"])
            print(f"updated channel {num} {name} id={row['Id']}")
            continue
        uid = str(uuid.uuid4()).upper()
        fields = {
            "FFmpegProfileId": 1,
            "Group": "Orca Broadcast",
            "IdleBehavior": 0,
            "IsEnabled": 1,
            "MusicVideoCreditsMode": 0,
            "Name": name,
            "Number": str(num),
            "PlayoutMode": 0,
            "PlayoutSource": 0,
            "ShowInEpg": 1,
            "SongVideoMode": 0,
            "SortNumber": float(num),
            "StreamSelectorMode": 0,
            "StreamingMode": 5,
            "SubtitleMode": 0,
            "TranscodeMode": 0,
            "UniqueId": uid,
        }
        if "SlugSeconds" in cols:
            fields["SlugSeconds"] = None
        keys = ", ".join(f'"{k}"' if k == "Group" else k for k in fields)
        placeholders = ", ".join("?" for _ in fields)
        cur = con.execute(
            f"INSERT INTO Channel ({keys}) VALUES ({placeholders})",
            list(fields.values()),
        )
        out[slug] = int(cur.lastrowid)
        print(f"created channel {num} {name} id={cur.lastrowid}")
    con.commit()
    return out


def ensure_collection(con: sqlite3.Connection, name: str, media_ids: list[int]) -> int:
    row = con.execute("SELECT Id FROM Collection WHERE Name = ?", (name,)).fetchone()
    if row:
        cid = int(row["Id"])
    else:
        cur = con.execute(
            "INSERT INTO Collection (Name, UseCustomPlaybackOrder) VALUES (?, 0)",
            (name,),
        )
        cid = int(cur.lastrowid)
    con.execute("DELETE FROM CollectionItem WHERE CollectionId = ?", (cid,))
    for mid in media_ids:
        con.execute(
            "INSERT INTO CollectionItem (CollectionId, MediaItemId, CustomIndex) VALUES (?, ?, NULL)",
            (cid, mid),
        )
    con.commit()
    print(f"collection {name} id={cid} items={len(media_ids)}")
    return cid


def ensure_schedule(con: sqlite3.Connection, name: str, collection_id: int) -> int:
    row = con.execute("SELECT Id FROM ProgramSchedule WHERE Name = ?", (name,)).fetchone()
    if row:
        sid = int(row["Id"])
        # wipe items
        item_ids = [
            int(r["Id"])
            for r in con.execute(
                "SELECT Id FROM ProgramScheduleItem WHERE ProgramScheduleId = ?", (sid,)
            )
        ]
        for iid in item_ids:
            con.execute("DELETE FROM ProgramScheduleFloodItem WHERE Id = ?", (iid,))
            con.execute("DELETE FROM ProgramScheduleItem WHERE Id = ?", (iid,))
    else:
        cur = con.execute(
            """
            INSERT INTO ProgramSchedule (
              FixedStartTimeBehavior, KeepMultiPartEpisodesTogether, Name,
              RandomStartPoint, ShuffleScheduleItems, TreatCollectionsAsShows
            ) VALUES (0, 0, ?, 0, 0, 0)
            """,
            (name,),
        )
        sid = int(cur.lastrowid)

    cur = con.execute(
        """
        INSERT INTO ProgramScheduleItem (
          CollectionId, CollectionType, CustomTitle, FakeCollectionKey, FallbackFillerId,
          FillWithGroupMode, FixedStartTimeBehavior, GuideMode, "Index",
          MarathonBatchSize, MarathonGroupBy, MarathonShuffleGroups, MarathonShuffleItems,
          MediaItemId, MidRollFillerId, MultiCollectionId, PlaybackOrder, PlaylistId,
          PostRollFillerId, PreRollFillerId, PreferredAudioLanguageCode, PreferredAudioTitle,
          PreferredSubtitleLanguageCode, ProgramScheduleId, RerunCollectionId, SmartCollectionId,
          StartTime, SubtitleMode, TailFillerId, SearchQuery, SearchTitle
        ) VALUES (
          ?, 0, NULL, NULL, NULL,
          0, NULL, 0, 0,
          NULL, 0, 0, 0,
          NULL, NULL, NULL, 3, NULL,
          NULL, NULL, NULL, NULL,
          NULL, ?, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL
        )
        """,
        (collection_id, sid),
    )
    item_id = int(cur.lastrowid)
    con.execute("INSERT INTO ProgramScheduleFloodItem (Id) VALUES (?)", (item_id,))
    con.commit()
    print(f"schedule {name} id={sid} flood item={item_id}")
    return sid


def ensure_playout(con: sqlite3.Connection, channel_id: int, schedule_id: int) -> int:
    row = con.execute("SELECT Id FROM Playout WHERE ChannelId = ?", (channel_id,)).fetchone()
    if row:
        con.execute(
            """
            UPDATE Playout SET ProgramScheduleId=?, ScheduleKind=1, ScheduleFile=NULL
            WHERE Id=?
            """,
            (schedule_id, int(row["Id"])),
        )
        con.commit()
        print(f"playout updated id={row['Id']} channel={channel_id}")
        return int(row["Id"])
    seed = int(hashlib.md5(str(channel_id).encode()).hexdigest()[:8], 16) % 1_000_000
    cur = con.execute(
        """
        INSERT INTO Playout (
          ChannelId, DailyRebuildTime, DecoId, OnDemandCheckpoint, ProgramScheduleId,
          ScheduleFile, ScheduleKind, Seed
        ) VALUES (?, NULL, NULL, NULL, ?, NULL, 1, ?)
        """,
        (channel_id, schedule_id, seed),
    )
    con.commit()
    print(f"playout created id={cur.lastrowid} channel={channel_id}")
    return int(cur.lastrowid)


def reset_playouts(channel_numbers: list[str]) -> None:
    for n in channel_numbers:
        url = f"{ETV}/api/channels/{n}/playout/reset"
        req = urllib.request.Request(url, method="POST", data=b"")
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                print(f"playout reset ch {n}: {res.status}")
        except Exception as e:
            print(f"playout reset ch {n} failed: {e}")


def main() -> int:
    if not DB.exists():
        print(f"DB not found: {DB}", file=sys.stderr)
        return 1
    print(f"staging={STAGING} etv={ETV} db={DB}")
    ensure_stubs()
    con = db_connect()
    ensure_library_path(con)
    scan_library()
    # give ETV a moment to pick up path if it was just inserted
    time.sleep(3)
    scan_library()
    media = wait_for_media(con)
    channels = upsert_channels_safe(con)

    by_slug: dict[str, list[int]] = {slug: [] for _, _, slug in STATIONS}
    for m in media:
        path = m["Path"] or ""
        for _, _, slug in STATIONS:
            if f"/media/channels/{slug}/" in path or path.endswith(f"/{slug}-placeholder.mp4"):
                by_slug[slug].append(int(m["MediaItemId"]))

    for num, name, slug in STATIONS:
        ids = sorted(set(by_slug.get(slug) or []))
        if not ids:
            print(f"WARNING: no media for {slug} — channel will be empty", file=sys.stderr)
            continue
        coll = ensure_collection(con, f"Orca · {name}", ids)
        sched = ensure_schedule(con, f"Orca · {name} 24/7", coll)
        ensure_playout(con, channels[slug], sched)

    reset_playouts([str(n) for n, _, _ in STATIONS])
    # verify
    with urllib.request.urlopen(f"{ETV}/iptv/channels.m3u", timeout=15) as res:
        m3u = res.read().decode()
    print("--- m3u ---")
    print(m3u[:1500])
    with urllib.request.urlopen(f"{ETV}/iptv/xmltv.xml", timeout=15) as res:
        xml = res.read().decode()
    print("--- xmltv head ---")
    print(xml[:800])
    print(f"xmltv bytes={len(xml)} channels_tag={xml.count('<channel ')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
