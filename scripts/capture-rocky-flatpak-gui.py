#!/usr/bin/env python3
"""Rocky Python 3.6 compatible: reject helper windows and blank captures."""
import json
import re
import sys

if len(sys.argv) > 1 and sys.argv[1] == "--check-window":
    for line in open(sys.argv[2]):
        if "voltius" not in line.lower():
            continue
        size = re.search(r"\b(\d+)x(\d+)\+", line)
        window = re.search(r"\b(0x[0-9a-fA-F]+)\b", line)
        if size and window and int(size.group(1)) >= 800 and int(size.group(2)) >= 500:
            print(window.group(1))
            sys.exit(0)
    sys.exit(1)

import gi
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk

Gdk.init([])
root = Gdk.get_default_root_window()
assert root, "No X11 root window"
pix = Gdk.pixbuf_get_from_window(root, 0, 0, root.get_width(), root.get_height())
assert pix, "X11 screenshot failed"
pix.savev("evidence/launch.png", "png", [], [])
pixels = pix.get_pixels()
channels = pix.get_n_channels()
colors = set(tuple(pixels[i:i+3]) for i in range(0, len(pixels)-channels, channels*127))
print(json.dumps({"width": pix.get_width(), "height": pix.get_height(),
                  "sampled_colors": len(colors), "nonblank": len(colors) >= 16}))
# This excludes an empty black/white window. Human inspection still must confirm UI.
sys.exit(0 if len(colors) >= 16 else 2)
