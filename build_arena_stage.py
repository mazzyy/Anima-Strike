"""
Procedurally builds a stylized neon cyberpunk fighting arena (à la the
"NEO FIGHTER Z" reference) and exports it as a single .glb for Godot.

Octagon platform + glowing concentric rings + radial spokes + railings +
billboard screens + a city-skyline silhouette + colored neon lights.

HOW TO RUN
  1. Open Blender.
  2. Top tabs -> "Scripting".
  3. Open this file (or paste it into a New text block).
  4. Press "Run Script" (the play button).
  It builds the scene and writes  arena_stage.glb  next to your project.

The platform's TOP surface sits at world height 0, so in Godot the fighters
(whose floor is y = 0) stand right on it.
"""

import bpy
import math

OUT_PATH = "/Users/soomro/Desktop/Projects/little-fighters-/arena_stage.glb"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_homefile(use_empty=True)

def mat(name, base=(0.1, 0.1, 0.12), metallic=0.0, rough=0.5, emis=None, emis_str=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (base[0], base[1], base[2], 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if emis is not None:
        for n in ("Emission Color", "Emission"):
            if n in b.inputs:
                b.inputs[n].default_value = (emis[0], emis[1], emis[2], 1)
                break
        if "Emission Strength" in b.inputs:
            b.inputs["Emission Strength"].default_value = emis_str
    return m

def octagon(name, radius, depth, z, material, rot=math.pi / 8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=radius, depth=depth,
                                        location=(0, 0, z))
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = (0, 0, rot)
    o.data.materials.append(material)
    return o

def box(name, size, loc, rot_z, material):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0], size[1], size[2])
    o.rotation_euler = (0, 0, rot_z)
    o.data.materials.append(material)
    return o

def add_light(kind, loc, color, energy, size=2.0):
    bpy.ops.object.light_add(type=kind, location=loc)
    l = bpy.context.active_object
    l.data.color = color
    l.data.energy = energy
    if kind == "AREA":
        l.data.size = size
    return l

def oct_verts(R, rot=math.pi / 8):
    return [(R * math.cos(rot + i * math.pi / 4),
             R * math.sin(rot + i * math.pi / 4)) for i in range(8)]

# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
reset_scene()

M_DARK   = mat("FloorDark",  base=(0.05, 0.06, 0.09), metallic=0.6, rough=0.45)
M_PANEL  = mat("FloorPanel", base=(0.10, 0.11, 0.16), metallic=0.7, rough=0.40)
M_METAL  = mat("Metal",      base=(0.14, 0.15, 0.19), metallic=0.9, rough=0.30)
M_CITY   = mat("City",       base=(0.03, 0.04, 0.08), metallic=0.2, rough=0.8,
               emis=(0.06, 0.10, 0.25), emis_str=1.2)

CYAN     = mat("NeonCyan",    base=(0,0,0), emis=(0.1, 0.9, 1.0),  emis_str=9)
MAGENTA  = mat("NeonMagenta", base=(0,0,0), emis=(1.0, 0.1, 0.7),  emis_str=9)
PURPLE   = mat("NeonPurple",  base=(0,0,0), emis=(0.55, 0.2, 1.0), emis_str=9)
BLUE     = mat("NeonBlue",    base=(0,0,0), emis=(0.2, 0.5, 1.0),  emis_str=7)
NEONS = [CYAN, PURPLE, MAGENTA, BLUE]

# ---------------------------------------------------------------------------
# Platform base (top surface at z = 0)
# ---------------------------------------------------------------------------
octagon("PlatformBase", radius=10.0, depth=1.4, z=-0.7, material=M_DARK)
octagon("PlatformTop",  radius=9.6,  depth=0.10, z=0.0, material=M_PANEL)

# Concentric glowing rings (stacked discs of shrinking radius read as rings)
r = 9.2
i = 0
z = 0.04
while r > 1.0:
    is_neon = (i % 2 == 1)
    m = NEONS[(i // 2) % len(NEONS)] if is_neon else M_PANEL
    octagon("Ring_%d" % i, radius=r, depth=0.06, z=z, material=m)
    r -= 0.7
    z += 0.012
    i += 1

# Bright center emblem
octagon("CoreGlow", radius=1.2, depth=0.08, z=z + 0.02, material=CYAN)

# Radial neon spokes across the floor
for k in range(8):
    ang = k * math.pi / 4
    box("Spoke_%d" % k, size=(9.0, 0.18, 0.05),
        loc=(4.6 * math.cos(ang), 4.6 * math.sin(ang), 0.07),
        rot_z=ang, material=NEONS[k % len(NEONS)])

# ---------------------------------------------------------------------------
# Railing around the platform edge
# ---------------------------------------------------------------------------
RAIL_R = 10.2
verts = oct_verts(RAIL_R)
for i in range(8):
    x1, y1 = verts[i]
    x2, y2 = verts[(i + 1) % 8]
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    length = math.dist((x1, y1), (x2, y2))
    yaw = math.atan2(y2 - y1, x2 - x1)
    # metal kick-wall + glowing top strip
    box("Rail_%d" % i, size=(length, 0.18, 1.1), loc=(mx, my, 0.55), rot_z=yaw, material=M_METAL)
    box("RailGlow_%d" % i, size=(length, 0.26, 0.10),
        loc=(mx, my, 1.12), rot_z=yaw, material=NEONS[i % len(NEONS)])
# corner posts
for (x, y) in verts:
    box("Post_%.0f_%.0f" % (x, y), size=(0.3, 0.3, 1.5), loc=(x, y, 0.75), rot_z=0, material=M_METAL)

# ---------------------------------------------------------------------------
# Billboard screens (big emissive panels on posts, facing the center)
# ---------------------------------------------------------------------------
billboard_specs = [
    (math.radians(55),  CYAN),
    (math.radians(125), MAGENTA),
    (math.radians(235), BLUE),
    (math.radians(305), PURPLE),
]
for idx, (ang, color) in enumerate(billboard_specs):
    bx, by = 16.0 * math.cos(ang), 16.0 * math.sin(ang)
    facing = math.atan2(-by, -bx)  # face the arena center
    # support posts
    box("BBPostL_%d" % idx, size=(0.4, 0.4, 7.0), loc=(bx, by, 3.5), rot_z=facing, material=M_METAL)
    # screen
    box("Billboard_%d" % idx, size=(6.5, 0.4, 3.4),
        loc=(bx, by, 7.2), rot_z=facing, material=color)
    box("BBFrame_%d" % idx, size=(7.0, 0.3, 3.9),
        loc=(bx, by, 7.2), rot_z=facing, material=M_METAL)

# ---------------------------------------------------------------------------
# City skyline silhouette (ring of dark glowing towers)
# ---------------------------------------------------------------------------
import random
random.seed(7)
for k in range(40):
    ang = k / 40.0 * math.tau
    dist = random.uniform(30, 46)
    h = random.uniform(8, 28)
    w = random.uniform(2.5, 5.5)
    bx, by = dist * math.cos(ang), dist * math.sin(ang)
    box("Tower_%d" % k, size=(w, w, h), loc=(bx, by, h / 2), rot_z=ang, material=M_CITY)

# ---------------------------------------------------------------------------
# Lights
# ---------------------------------------------------------------------------
add_light("AREA", (0, 0, 16), (0.8, 0.85, 1.0), 600, size=22)   # soft key from above
add_light("POINT", (8, 8, 6),  (0.1, 0.9, 1.0), 800)            # cyan rim
add_light("POINT", (-8, -8, 6),(1.0, 0.2, 0.7), 800)            # magenta rim
add_light("POINT", (-9, 9, 5), (0.6, 0.2, 1.0), 600)            # purple fill
add_light("POINT", (9, -9, 5), (0.2, 0.5, 1.0), 600)            # blue fill

# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
bpy.ops.export_scene.gltf(
    filepath=OUT_PATH,
    export_format='GLB',
    export_apply=True,
    export_lights=True,
)
print("ARENA EXPORTED ->", OUT_PATH)
