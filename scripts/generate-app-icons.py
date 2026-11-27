"""Generate product icons from the user-provided transparent PNG (requires Pillow)."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / "resources/branding/openagent-source.png").convert("RGBA")
content = source.crop(source.getchannel("A").getbbox())
side = round(max(content.size) / 0.94)
master = Image.new("RGBA", (side, side))
master.alpha_composite(content, ((side-content.width)//2, (side-content.height)//2))
icons = ROOT / "crates/agent-gui/src-tauri/icons"
# Keep each platform's expected dimensions and regenerate all product rasters.
for path in icons.rglob("*.png"):
    if "custom" in path.parts:
        continue
    with Image.open(path) as previous:
        size = previous.size
    master.resize(size, Image.Resampling.LANCZOS).save(path)
for name in ("icon.ico", "icon-windows.ico"):
    master.resize((256, 256), Image.Resampling.LANCZOS).save(
        icons/name, sizes=[(n,n) for n in (16,20,24,32,40,48,64,128,256)])
master.resize((1024,1024), Image.Resampling.LANCZOS).save(icons/"icon.icns")
master.resize((32,32), Image.Resampling.LANCZOS).save(icons/"tray-icon-windows.png")
public = ROOT / "crates/agent-gui/public"
master.resize((128,128), Image.Resampling.LANCZOS).save(public/"favicon.png")
master.resize((256,256), Image.Resampling.LANCZOS).save(public/"icon-simple.png")
master.resize((512,512), Image.Resampling.LANCZOS).save(ROOT/"resources/branding/openagent-logo.png")
print("Generated openAgent UI, installer, executable, shortcut and tray icons.")
