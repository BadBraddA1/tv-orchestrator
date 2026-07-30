#!/usr/bin/env python3
import hashlib, sqlite3, time, urllib.request

ETV = "http://127.0.0.1:8409"
DB = "/var/lib/docker/volumes/tv-orchestrator_ersatztv-config/_data/ersatztv.sqlite3"
ORCA = "/opt/tv-orchestrator/data/tv-orchestrator.db"
OTHER = 4

# Channel number -> bound library folders under /media/channels/library
STATIONS = [
    (11, "Toon Box", ["/media/channels/library/toon-box"]),
    (9, "Kitchen Heat", ["/media/channels/library/kitchen-heat"]),
    (3, "Cops 24/7", ["/media/channels/library/cops-motorway", "/media/channels/library/cops-rookie"]),
    (5, "Comedy", ["/media/channels/library/comedy"]),
    (7, "Below Deck", ["/media/channels/library/below-deck"]),
]

def post(path):
    req = urllib.request.Request(ETV + path, method="POST", data=b"")
    with urllib.request.urlopen(req, timeout=180) as r:
        print("POST", path, r.status)

con = sqlite3.connect(DB, timeout=60)
con.row_factory = sqlite3.Row

# Ensure parent library path + station paths on Other Videos
for path in ["/media/channels/library"] + [p for _,_,ps in STATIONS for p in ps]:
    row = con.execute("SELECT Id FROM LibraryPath WHERE Path=? AND LibraryId=?", (path, OTHER)).fetchone()
    if not row:
        con.execute("INSERT INTO LibraryPath (Path, LibraryId, LastScan) VALUES (?,?,?)", (path, OTHER, "0001-01-01 00:00:00"))
        print("path+", path)
    else:
        print("path=", path, row["Id"])
con.commit()

# Restart ETV so it loads new paths cleanly
import subprocess
subprocess.check_call(["bash","-lc","cd /opt/tv-orchestrator && docker compose --env-file .compose.env restart ersatztv"])
time.sleep(10)
post(f"/api/libraries/{OTHER}/scan")

for i in range(60):
    n = con.execute("SELECT COUNT(*) FROM MediaFile WHERE Path LIKE '/media/channels/library/%'").fetchone()[0]
    b = con.execute("SELECT COUNT(*) FROM MediaFile WHERE Path LIKE '/media/channels/library/toon-box/%'").fetchone()[0]
    print(f"t={i*5}s library_files={n} bluey={b}")
    if b >= 20:
        break
    time.sleep(5)
    if i % 6 == 5:
        post(f"/api/libraries/{OTHER}/scan")

def media_ids(paths):
    ids=set()
    for path in paths:
        for r in con.execute(
            """
            SELECT DISTINCT mi.Id
            FROM MediaFile mf
            JOIN MediaVersion mv ON mv.Id = mf.MediaVersionId
            LEFT JOIN OtherVideo ov ON ov.Id = mv.OtherVideoId
            LEFT JOIN Episode e ON e.Id = mv.EpisodeId
            JOIN MediaItem mi ON mi.Id = COALESCE(ov.Id, e.Id)
            WHERE mf.Path LIKE ? || '/%' OR mf.Path LIKE ? || '/%'
            """,
            (path, path.rstrip("/")),
        ):
            if r[0] is not None:
                ids.add(int(r[0]))
        # simpler: any media version linked
        for r in con.execute(
            """
            SELECT mv.OtherVideoId, mv.EpisodeId, mv.MovieId
            FROM MediaFile mf JOIN MediaVersion mv ON mv.Id=mf.MediaVersionId
            WHERE mf.Path LIKE ? || '/%'
            """,
            (path,),
        ):
            for x in r:
                if x: ids.add(int(x))
    return sorted(ids)

def ensure_collection(name, mids):
    row=con.execute("SELECT Id FROM Collection WHERE Name=?",(name,)).fetchone()
    cid=int(row["Id"]) if row else int(con.execute("INSERT INTO Collection (Name, UseCustomPlaybackOrder) VALUES (?,0)",(name,)).lastrowid)
    con.execute("DELETE FROM CollectionItem WHERE CollectionId=?",(cid,))
    for mid in mids:
        con.execute("INSERT OR IGNORE INTO CollectionItem (CollectionId, MediaItemId, CustomIndex) VALUES (?,?,NULL)",(cid,mid))
    con.commit(); print("collection", name, len(mids)); return cid

def ensure_schedule(name, cid):
    row=con.execute("SELECT Id FROM ProgramSchedule WHERE Name=?",(name,)).fetchone()
    if row:
        sid=int(row["Id"])
        for r in con.execute("SELECT Id FROM ProgramScheduleItem WHERE ProgramScheduleId=?",(sid,)):
            con.execute("DELETE FROM ProgramScheduleFloodItem WHERE Id=?",(int(r[0]),))
            con.execute("DELETE FROM ProgramScheduleItem WHERE Id=?",(int(r[0]),))
    else:
        sid=int(con.execute("INSERT INTO ProgramSchedule (FixedStartTimeBehavior, KeepMultiPartEpisodesTogether, Name, RandomStartPoint, ShuffleScheduleItems, TreatCollectionsAsShows) VALUES (0,1,?,0,0,0)",(name,)).lastrowid)
    iid=int(con.execute("""INSERT INTO ProgramScheduleItem (
      CollectionId, CollectionType, CustomTitle, FakeCollectionKey, FallbackFillerId,
      FillWithGroupMode, FixedStartTimeBehavior, GuideMode, "Index",
      MarathonBatchSize, MarathonGroupBy, MarathonShuffleGroups, MarathonShuffleItems,
      MediaItemId, MidRollFillerId, MultiCollectionId, PlaybackOrder, PlaylistId,
      PostRollFillerId, PreRollFillerId, PreferredAudioLanguageCode, PreferredAudioTitle,
      PreferredSubtitleLanguageCode, ProgramScheduleId, RerunCollectionId, SmartCollectionId,
      StartTime, SubtitleMode, TailFillerId, SearchQuery, SearchTitle
    ) VALUES (?,0,NULL,NULL,NULL,0,NULL,0,0,NULL,0,0,0,NULL,NULL,NULL,3,NULL,NULL,NULL,NULL,NULL,NULL,?,NULL,NULL,NULL,NULL,NULL,NULL,NULL)""",(cid,sid)).lastrowid)
    con.execute("INSERT INTO ProgramScheduleFloodItem (Id) VALUES (?)",(iid,))
    con.commit(); return sid

def ensure_playout(num, sid):
    ch=con.execute("SELECT Id FROM Channel WHERE Number=?",(str(num),)).fetchone()
    if not ch: print("no channel", num); return
    channel_id=int(ch["Id"])
    row=con.execute("SELECT Id FROM Playout WHERE ChannelId=?",(channel_id,)).fetchone()
    if row:
        con.execute("UPDATE Playout SET ProgramScheduleId=?, ScheduleKind=1 WHERE Id=?",(sid,int(row["Id"])))
    else:
        seed=int(hashlib.md5(str(num).encode()).hexdigest()[:8],16)%1000000
        con.execute("INSERT INTO Playout (ChannelId, DailyRebuildTime, DecoId, OnDemandCheckpoint, ProgramScheduleId, ScheduleFile, ScheduleKind, Seed) VALUES (?,NULL,NULL,NULL,?,NULL,1,?)",(channel_id,sid,seed))
    con.commit()

for num, name, paths in STATIONS:
    mids = media_ids(paths)
    print(name, "ids", len(mids))
    if not mids:
        continue
    cid = ensure_collection(f"Library · {name}", mids)
    sid = ensure_schedule(f"Library · {name} 24/7", cid)
    ensure_playout(num, sid)
    try:
        post(f"/api/channels/{num}/playout/reset")
    except Exception as e:
        print("reset fail", e)

ocon=sqlite3.connect(ORCA)
ocon.execute("UPDATE channels SET hopper_size=0, drop_after_watch=0")
if ocon.execute("SELECT 1 FROM settings WHERE key='broadcast_library_mode'").fetchone():
    ocon.execute("UPDATE settings SET value='1' WHERE key='broadcast_library_mode'")
else:
    ocon.execute("INSERT INTO settings (key,value) VALUES ('broadcast_library_mode','1')")
ocon.commit()
print("library mode on")

xml=urllib.request.urlopen(ETV+"/iptv/xmltv.xml", timeout=60).read().decode("utf-8","ignore")
import re
titles=re.findall(r"<title[^>]*>([^<]+)</title>", xml)
print("xmltv programmes", len(titles), "sample", titles[:10])
