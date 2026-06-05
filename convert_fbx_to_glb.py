"""
Batch-convert every .fbx in the animations folder into a CLEAN single-clip .glb.

Why this exists: importing all your FBX files into one Blender scene made the
actions pile up, so every export contained many clips. This script imports each
FBX into a fresh, empty scene on its own, so each exported .glb has exactly one
animation — which is what the game's loader expects.

HOW TO RUN (easiest):
  1. Open Blender.
  2. Top tabs -> "Scripting".
  3. Click "Open" in the text editor, pick this file (convert_fbx_to_glb.py).
     (Or click "New", paste the contents in.)
  4. Press "Run Script" (the ▶ play button).
  5. Watch the System Console / info for "Converted ..." lines, then "ALL DONE".

It overwrites the .glb files in the animations folder with clean versions.
Re-run it any time you add more .fbx files.
"""

import bpy
import os
import glob

# If your project lives elsewhere, edit this one line:
ANIM_DIR = "/Users/soomro/Desktop/Projects/little-fighters-/animations"

fbx_files = sorted(glob.glob(os.path.join(ANIM_DIR, "*.fbx")))
print("Found %d FBX files in %s" % (len(fbx_files), ANIM_DIR))

for fbx in fbx_files:
    base = os.path.splitext(os.path.basename(fbx))[0]
    out = os.path.join(ANIM_DIR, base + ".glb")

    # Start from a completely empty scene so no actions carry over.
    bpy.ops.wm.read_homefile(use_empty=True)

    # Import this one animation.
    bpy.ops.import_scene.fbx(filepath=fbx)

    # Export a single-clip GLB.
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_skins=True,
        export_yup=True,
    )
    print("Converted: %s -> %s" % (os.path.basename(fbx), os.path.basename(out)))

print("ALL DONE - %d files converted." % len(fbx_files))
