import os,urllib.request,re,urllib.parse
TOKEN="bxx16WsKAtu_5UvkccdA"
print("=== disk kitchen/bluey ===")
root="/mnt/tv"
for name in os.listdir(root):
    low=name.lower()
    if any(k in low for k in ["night","gordon","hell","kitchen","bluey","motorway","rookie","come fly","rick"]):
        p=os.path.join(root,name)
        print(repr(name), "dir" if os.path.isdir(p) else "file")
print("=== bluey walk ===")
for r,ds,fs in os.walk("/mnt/tv/Bluey (2018)"):
    print(r)
    print(" files", [f for f in fs if not f.startswith(".")][:10])
    if r.count("/")>6: break
print("=== plex kitchen paths ===")
url="http://10.0.0.235:32400/library/metadata/3896/allLeaves?X-Plex-Token=%s&X-Plex-Container-Size=5"%TOKEN
t=urllib.request.urlopen(url,timeout=60).read().decode()
for m in re.finditer(r"file=\"([^\"]+)\"", t):
    print(m.group(1))
