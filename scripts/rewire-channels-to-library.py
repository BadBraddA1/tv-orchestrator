#!/usr/bin/env python3
"""Point Orca Broadcast ErsatzTV channels at existing /media/tv library folders.

Skips NZBGet re-downloads for shows you already have.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
import urllib.request
import uuid
from pathlib import Path

ETV = os.environ.get("ERSATZTV_URL", "http://127.0.0.1:8409").rstrip("/")
DB = Path(
    os.environ.get(
        "ERSATZTV_DB",
        "/var/lib/docker/volumes/tv-orchestrator_ersatztv-config/_data/ersatztv.sqlite3",
    )
)
ORCA_DB = Path(os.environ.get("ORCA_DB", "/opt/tv-orchestrator/data/tv-orchestrator.db"))
SHOWS_LIBRARY_ID = 2  # Local "Shows" library in fresh ETV

# channel number, name, slug, host paths under /media/tv (CT view of Plex TV Shows)
STATIONS = [
    (
        11,
        "Toon Box",
        "toon-box",
        ["/media/tv/Bluey (2018)"],
    ),
    (
        9,
        "Kitchen Heat",
        "kitchen-heat",
        ["/media/tv/KN"],
    ),
    (
        3,
        "Cops 24/7",
        "cops",
        [
            "/media/tv/motorway cops catching britains speeders",
            "/media/tv/Rookie Cops 2022",
        ],
    ),
    (
        5,
        "Comedy",
        "comedy",
        ["/media/tv/Come Fly with Me (2010)"],
    ),
]


def post(path: str) -> None:
    req = urllib.request.Request(f"{ETV}{path}", method="POST", data=b"")
    with urllib.request.urlopen(req, timeout=120) as res:
        print(f"POST {path} -> {res.status}")


def db() -> sqlite3.Connection:
    con = sqlite3.connect(str(DB), timeout=60)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=60000")
    return con


def ensure_paths(con: sqlite3.Connection) -> list[int]:
    ids: list[int] = []
    wanted = []
    for _n, _name, _slug, paths in STATIONS:
        wanted.extend(paths)
    # also keep parent for any loose matches
    for path in wanted:
        if not Path(path).exists():
            print(f"WARN missing path {path}")
            continue
        row = con.execute(
            "SELECT Id FROM LibraryPath WHERE Path = ? AND LibraryId = ?",
            (path, SHOWS_LIBRARY_ID),
        ).fetchone()
        if row:
            ids.append(int(row["Id"]))
            print(f"LibraryPath exists {path} id={row['Id']}")
            continue
        cur = con.execute(
            "INSERT INTO LibraryPath (Path, LibraryId, LastScan) VALUES (?, ?, ?)",
            (path, SHOWS_LIBRARY_ID, "0001-01-01 00:00:00"),
        )
        ids.append(int(cur.lastrowid))
        print(f"LibraryPath added {path} id={cur.lastrowid}")
    con.commit()
    return ids


def wait_episodes(con: sqlite3.Connection, timeout: int = 600) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        n = con.execute(
            """
            SELECT COUNT(*) AS c
            FROM MediaFile mf
            WHERE mf.Path LIKE '/media/tv/%'
            """
        ).fetchone()[0]
        print(f"scanned media files under /media/tv: {n}")
        if n >= 50:
            return
        time.sleep(8)
        post(f"/api/libraries/{SHOWS_LIBRARY_ID}/scan")
    print("WARN: scan still thin — continuing with whatever we have")


def media_ids_for_paths(con: sqlite3.Connection, paths: list[str]) -> list[int]:
    ids: list[int] = []
    for path in paths:
        # Episodes under Shows library
        rows = con.execute(
            """
            SELECT DISTINCT mi.Id
            FROM MediaFile mf
            JOIN MediaVersion mv ON mv.Id = mf.MediaVersionId
            JOIN Episode e ON e.Id = mv.EpisodeId
            JOIN MediaItem mi ON mi.Id = e.Id
            WHERE mf.Path LIKE ? || '/%' OR mf.Path LIKE ? || '/%'
            """,
            (path, path.rstrip("/")),
        ).fetchall()
        # OtherVideo fallback (if scanned as other)
        rows2 = con.execute(
            """
            SELECT DISTINCT mi.Id
            FROM MediaFile mf
            JOIN MediaVersion mv ON mv.Id = mf.MediaVersionId
            JOIN OtherVideo ov ON ov.Id = mv.OtherVideoId
            JOIN MediaItem mi ON mi.Id = ov.Id
            WHERE mf.Path LIKE ? || '/%' OR mf.Path = ?
            """,
            (path, path),
        ).fetchall()
        for r in list(rows) + list(rows2):
            ids.append(int(r["Id"]))
    return sorted(set(ids))


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
    print(f"collection {name} items={len(media_ids)} id={cid}")
    return cid


def ensure_schedule(con: sqlite3.Connection, name: str, collection_id: int) -> int:
    row = con.execute("SELECT Id FROM ProgramSchedule WHERE Name = ?", (name,)).fetchone()
    if row:
        sid = int(row["Id"])
        for r in con.execute(
            "SELECT Id FROM ProgramScheduleItem WHERE ProgramScheduleId = ?", (sid,)
        ):
            iid = int(r["Id"])
            con.execute("DELETE FROM ProgramScheduleFloodItem WHERE Id = ?", (iid,))
            con.execute("DELETE FROM ProgramScheduleItem WHERE Id = ?", (iid,))
    else:
        cur = con.execute(
            """
            INSERT INTO ProgramSchedule (
              FixedStartTimeBehavior, KeepMultiPartEpisodesTogether, Name,
              RandomStartPoint, ShuffleScheduleItems, TreatCollectionsAsShows
            ) VALUES (0, 1, ?, 0, 0, 0)
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
    return sid


def ensure_playout(con: sqlite3.Connection, channel_number: str, schedule_id: int) -> None:
    ch = con.execute("SELECT Id FROM Channel WHERE Number = ?", (channel_number,)).fetchone()
    if not ch:
        raise SystemExit(f"missing channel {channel_number}")
    channel_id = int(ch["Id"])
    row = con.execute("SELECT Id FROM Playout WHERE ChannelId = ?", (channel_id,)).fetchone()
    if row:
        con.execute(
            "UPDATE Playout SET ProgramScheduleId=?, ScheduleKind=1, ScheduleFile=NULL WHERE Id=?",
            (schedule_id, int(row["Id"])),
        )
    else:
        seed = int(hashlib.md5(channel_number.encode()).hexdigest()[:8], 16) % 1_000_000
        con.execute(
            """
            INSERT INTO Playout (
              ChannelId, DailyRebuildTime, DecoId, OnDemandCheckpoint, ProgramScheduleId,
              ScheduleFile, ScheduleKind, Seed
            ) VALUES (?, NULL, NULL, NULL, ?, NULL, 1, ?)
            """,
            (channel_id, schedule_id, seed),
        )
    con.commit()


def disable_orca_downloads() -> None:
    if not ORCA_DB.exists():
        print(f"ORCA db missing at {ORCA_DB} — skip download disable")
        return
    con = sqlite3.connect(str(ORCA_DB))
    # Stop hopper grabs; library mode
    con.execute("UPDATE channels SET hopper_size = 0, drop_after_watch = 0, updated_at = datetime('now')")
    con.execute(
        """
        INSERT INTO settings (key, value) VALUES ('broadcast_library_mode', '1')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """
    )
    # settings table might use different schema
    try:
        con.commit()
    except sqlite3.Error:
        con.rollback()
        cols = [r[1] for r in con.execute("PRAGMA table_info(settings)")]
        print("settings cols", cols)
        if "key" in cols and "value" in cols:
            exists = con.execute(
                "SELECT 1 FROM settings WHERE key = ?", ("broadcast_library_mode",)
            ).fetchone()
            if exists:
                con.execute(
                    "UPDATE settings SET value = ? WHERE key = ?",
                    ("1", "broadcast_library_mode"),
                )
            else:
                con.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?)",
                    ("broadcast_library_mode", "1"),
                )
            con.commit()
    print("Orca hopper_size=0 (no re-download) + broadcast_library_mode=1")
    con.close()


def main() -> int:
    print(f"etv={ETV} db={DB}")
    con = db()
    ensure_paths(con)
    post(f"/api/libraries/{SHOWS_LIBRARY_ID}/scan")
    wait_episodes(con)

    for num, name, slug, paths in STATIONS:
        mids = media_ids_for_paths(con, paths)
        if not mids:
            print(f"WARN no media for {name} paths={paths}")
            continue
        coll = ensure_collection(con, f"Library · {name}", mids)
        sched = ensure_schedule(con, f"Library · {name} 24/7", coll)
        ensure_playout(con, str(num), sched)
        print(f"wired ch {num} {name} <- {len(mids)} library items")

    for num, _, _, _ in STATIONS:
        try:
            post(f"/api/channels/{num}/playout/reset")
        except Exception as e:
            print(f"reset {num}: {e}")

    disable_orca_downloads()

    with urllib.request.urlopen(f"{ETV}/iptv/xmltv.xml", timeout=30) as res:
        xml = res.read().decode("utf-8", "ignore")
    print(f"xmltv bytes={len(xml)} channels={xml.count('<channel ')} programmes={xml.count('<programme ')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
