# Bundles index.html + style.css + script.js (+ the logo) into single-file pages in dist/.
#   dist/journey-of-a-drop.html   full branded game, opens on its own in any browser
#   dist/preview-unbranded.html   same game without the logo/link, for private playtest links
import base64, pathlib, re

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text(encoding="utf-8")
head = re.search(r"<!-- BUILD:HEAD START -->(.*?)<!-- BUILD:HEAD END -->", html, re.S).group(1).strip()
body = re.search(r"<!-- BUILD:BODY START -->(.*?)<!-- BUILD:BODY END -->", html, re.S).group(1).strip()
css = (root / "style.css").read_text(encoding="utf-8")
js = (root / "script.js").read_text(encoding="utf-8")

logo = base64.b64encode((root / "assets" / "charity-water-logo.png").read_bytes()).decode()
body = body.replace("assets/charity-water-logo.png", "data:image/png;base64," + logo)

(root / "dist").mkdir(exist_ok=True)

standalone = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
{head}
<style>
{css}
</style>
</head>
<body>
{body}
<script>
{js}
</script>
</body>
</html>
"""
(root / "dist" / "journey-of-a-drop.html").write_text(standalone, encoding="utf-8")

preview_body = re.sub(r'\s*<div class="brand[^"]*"[^>]*>.*?</div>', "", body, flags=re.S)
preview_body = re.sub(r'\s*<a class="brand-link".*?</a>', "", preview_body, flags=re.S)
preview = f"{head}\n<style>\n{css}\n</style>\n{preview_body}\n<script>\n{js}\n</script>\n"
(root / "dist" / "preview-unbranded.html").write_text(preview, encoding="utf-8")

print("built", len(standalone), "and", len(preview), "bytes")
