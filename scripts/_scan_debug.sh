#!/bin/bash
set -e
cd /opt/tv-orchestrator
docker compose --env-file .compose.env stop ersatztv
python3 <<'PY'
import sqlite3
db="/var/lib/docker/volumes/tv-orchestrator_ersatztv-config/_data/ersatztv.sqlite3"
con=sqlite3.connect(db)
con.row_factory=sqlite3.Row
print("libraries:")
for r in con.execute("SELECT * FROM Library"):
    print(dict(r))
print("paths:")
for r in con.execute("SELECT * FROM LibraryPath"):
    print(dict(r))
print("files", con.execute("SELECT COUNT(*) FROM MediaFile").fetchone()[0])
# ensure Bluey path on Other Videos too as fallback (MediaKind other videos =4)
path="/media/tv/Bluey (2018)"
for lib_id in (2, 4):
    row=con.execute("SELECT Id FROM LibraryPath WHERE Path=? AND LibraryId=?", (path, lib_id)).fetchone()
    if not row:
        con.execute("INSERT INTO LibraryPath (Path, LibraryId, LastScan) VALUES (?,?,?)", (path, lib_id, "0001-01-01 00:00:00"))
        print("added", path, "lib", lib_id)
con.commit()
PY
docker compose --env-file .compose.env start ersatztv
sleep 10
curl -s -o /dev/null -w "scan2:%{http_code}\n" -X POST http://127.0.0.1:8409/api/libraries/2/scan
curl -s -o /dev/null -w "scan4:%{http_code}\n" -X POST http://127.0.0.1:8409/api/libraries/4/scan
sleep 20
docker logs orca-ersatztv --tail 50
python3 <<'PY'
import sqlite3
db="/var/lib/docker/volumes/tv-orchestrator_ersatztv-config/_data/ersatztv.sqlite3"
con=sqlite3.connect(f"file:{db}?mode=ro", uri=True)
print("files", con.execute("SELECT COUNT(*) FROM MediaFile").fetchone()[0])
print("sample paths:")
for r in con.execute("SELECT Path FROM MediaFile ORDER BY Id DESC LIMIT 15"):
    print(" ", r[0])
PY
