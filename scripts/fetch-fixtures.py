"""Fetch only pinned official upstream binaries. No RPC or wallet interaction."""
import hashlib
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "fixtures.json").read_text())
destination = root / ".tools" / "fixtures"
destination.mkdir(parents=True, exist_ok=True)
for name, fixture in manifest.items():
    path = destination / f"{name}.so"
    if path.exists():
        data = path.read_bytes()
    else:
        with urllib.request.urlopen(fixture["url"], timeout=60) as response:
            data = response.read()
    sha256 = hashlib.sha256(data).hexdigest()
    if "sha256" in fixture:
        assert sha256 == fixture["sha256"], f"{name}: SHA256 mismatch"
    if "gitBlobSha1" in fixture:
        git_blob = b"blob " + str(len(data)).encode() + b"\0" + data
        assert hashlib.sha1(git_blob).hexdigest() == fixture["gitBlobSha1"], f"{name}: Git blob mismatch"
    path.write_bytes(data)
    print(json.dumps({"fixture": name, "size": len(data), "sha256": sha256}))
