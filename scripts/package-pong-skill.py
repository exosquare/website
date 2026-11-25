"""Rebuild the weight-free reader packet with stable ordering and timestamps."""
from hashlib import sha256
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parents[1]
pong = root / "public/experiments/pong"
arena = pong / "arena"
authoring = root / "tools/pong-authoring"
files = {
    "SKILL.md": (arena / "SKILL.md").read_bytes(),
    "TASK.md": (authoring / "arena-packet.md").read_bytes(),
    "check-authoring.mjs": (authoring / "check-authoring.mjs").read_bytes(),
    "validate.js": (pong / "validate.js").read_bytes(),
    "package.json": b'{"type":"module","engines":{"node":">=24"}}\n',
}
files["SHA256SUMS"] = "".join(
    f"{sha256(data).hexdigest()}  {name}\n" for name, data in files.items()
).encode()
with ZipFile(arena / "pong-authoring.zip", "w") as archive:
    for name, data in files.items():
        entry = ZipInfo(f"author-literal-network-parameters/{name}")
        entry.compress_type = ZIP_DEFLATED
        archive.writestr(entry, data)
