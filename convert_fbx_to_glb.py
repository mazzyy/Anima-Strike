"""
Batch-convert every .fbx in the animations folder into a CLEAN single-clip .glb.

Why this exists: importing all your FBX files into one Blender scene made the
actions pile up, so every export contained many clips. This script imports each
FBX into a fresh scene on its own, so each exported .glb has exactly one
animation — which is what the game's loader expects.

HOW TO RUN (easiest):
  1. Open Blender.
  2. Top tabs -> "Scripting".
  3. Click "Open" in the text editor, pick this file (convert_fbx_to_glb.py).
     (Or click "New", paste the contents in.)
  4. Press "Run Script" (the play button).
  5. Watch the System Console / info for "Converted ..." lines, then "ALL DONE".

It overwrites the .glb files in the animations folder with clean versions.
Re-run it any time you add more .fbx files.
"""

import bpy
import os
import glob

# Points at: <your home folder>/Desktop/animations
ANIM_DIR = os.path.join(os.path.expanduser("~"), "Desktop", "animations")


def find_view3d_override():
    """Build a context override pointing at a 3D Viewport, which the FBX
    importer needs for its mode_set calls."""
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == 'VIEW_3D':
                for region in area.regions:
                    if region.type == 'WINDOW':
                        return {
                            "window": window,
                            "screen": window.screen,
                            "area": area,
                            "region": region,
                        }
    return None


def clear_scene():
    """Remove everything from the current scene + purge orphan data."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.actions, bpy.data.armatures, bpy.data.meshes,
                  bpy.data.materials, bpy.data.images):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


fbx_files = sorted(glob.glob(os.path.join(ANIM_DIR, "*.fbx")))
print("Found %d FBX files in %s" % (len(fbx_files), ANIM_DIR))

override = find_view3d_override()

for fbx in fbx_files:
    base = os.path.splitext(os.path.basename(fbx))[0]
    out = os.path.join(ANIM_DIR, base + ".glb")

    # Clear the current scene rather than reloading the home file, so the
    # window/screen/area context stays valid for the importer.
    clear_scene()

    # Import this one animation, with a 3D-Viewport context override so the
    # importer's internal mode_set call has an active object area to work in.
    if override:
        with bpy.context.temp_override(**override):
            bpy.ops.import_scene.fbx(filepath=fbx)
    else:
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