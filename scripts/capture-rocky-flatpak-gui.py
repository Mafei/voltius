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
gi.require_version("GdkX11", "3.0")
from gi.repository import Gdk, GdkX11

Gdk.init([])
root = Gdk.get_default_root_window()
assert root, "No X11 root window"
root_pix = Gdk.pixbuf_get_from_window(root, 0, 0, root.get_width(), root.get_height())
assert root_pix, "Root screenshot failed"
root_pix.savev("evidence/root.png", "png", [], [])
with open("evidence/main-window-id.txt") as window_file:
    window_id = int(window_file.read().strip(), 16)
window = GdkX11.X11Window.foreign_new_for_display(Gdk.Display.get_default(), window_id)
assert window, "Voltius native window no longer exists"
pix = Gdk.pixbuf_get_from_window(window, 0, 0, window.get_width(), window.get_height())
assert pix, "Voltius window is not viewable or capture failed"
pix.savev("evidence/launch.png", "png", [], [])
pixels = pix.get_pixels()
channels = pix.get_n_channels()
colors = set(tuple(pixels[i:i+3]) for i in range(0, len(pixels)-channels, channels*127))
print(json.dumps({"width": pix.get_width(), "height": pix.get_height(),
                  "window_id": hex(window_id), "sampled_colors": len(colors),
                  "nonblank": len(colors) >= 16}))
# This excludes an empty black/white window. Human inspection still must confirm UI.
sys.exit(0 if len(colors) >= 16 else 2)
