#!/usr/bin/env python3
import re
import urllib.parse
import urllib.request

TOKEN = "bxx16WsKAtu_5UvkccdA"
BASE = "http://10.0.0.235:32400"


def get(path: str, **params: str) -> str:
    params.setdefault("X-Plex-Token", TOKEN)
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode("utf-8", "ignore")


t = get(
    "/library/sections/2/all",
    **{"X-Plex-Container-Start": "0", "X-Plex-Container-Size": "100"},
)
print("container", re.search(r'size="(\d+)"', t).group(1))
for m in re.finditer(r"<Directory([^>]+)>", t):
    d = m.group(1)
    if 'type="show"' not in d:
        continue
    title = re.search(r'title="([^"]+)"', d)
    rk = re.search(r'ratingKey="([^"]+)"', d)
    year = re.search(r'year="([^"]+)"', d)
    leaf = re.search(r'leafCount="([^"]+)"', d)
    print(
        f"- {title.group(1) if title else '?'} ({year.group(1) if year else '?'})"
        f" eps={leaf.group(1) if leaf else '?'} rk={rk.group(1) if rk else '?'}"
    )
