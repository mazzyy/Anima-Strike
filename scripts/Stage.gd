extends Node3D
## Neon cyberpunk fighting arena (NEO FIGHTER Z style): octagon platform on a
## tech base, a railing of vertical neon bars (cyan->magenta), surrounding
## machinery + billboard screens, tiered crowd silhouettes, a city skyline,
## and a focused key light. Platform top is at y = 0 (where fighters stand).

const TAU_ := 6.2831853

var CYAN := Color(0.10, 0.90, 1.00)
var MAGENTA := Color(1.00, 0.12, 0.65)
var PURPLE := Color(0.55, 0.20, 1.00)
var BLUE := Color(0.20, 0.50, 1.00)

## Build the real 3D fighting platform (floor + neon railing). Keep ON for the
## hybrid look (3D platform over an image backdrop).
@export var build_platform: bool = true
## Build the surrounding props (ground, crowd, machines, billboards).
@export var build_environment: bool = false
## Build the procedural city skyline. Turn OFF when an image backdrop provides
## the distant background instead.
@export var build_skyline: bool = false

func _ready() -> void:
	if build_platform:
		_build_platform()
		_build_floor_detail()
		_build_railing()
	if build_environment:
		_build_ground()
		_build_machines()
		_build_billboards()
		_build_crowd()
	if build_skyline:
		_build_skyline()
	_build_collision()
	_build_keylight()

# ---------------------------------------------------------------------------
# Materials / mesh helpers
# ---------------------------------------------------------------------------
func _solid(color: Color, metallic := 0.6, rough := 0.45) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.metallic = metallic
	m.roughness = rough
	return m

func _neon(color: Color, energy := 4.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color.darkened(0.6)
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	m.metallic = 0.0
	m.roughness = 0.4
	return m

## Cyan on the left (-X) blending to magenta on the right (+X).
func _grad(x: float) -> Color:
	var t: float = clampf((x + 14.0) / 28.0, 0.0, 1.0)
	return CYAN.lerp(MAGENTA, t)

func _add_oct(radius: float, height: float, y: float, mtl: StandardMaterial3D) -> MeshInstance3D:
	var cm := CylinderMesh.new()
	cm.top_radius = radius
	cm.bottom_radius = radius
	cm.height = height
	cm.radial_segments = 8
	var mi := MeshInstance3D.new()
	mi.mesh = cm
	mi.material_override = mtl
	mi.position = Vector3(0, y, 0)
	mi.rotation.y = PI / 8.0
	add_child(mi)
	return mi

func _add_box(size: Vector3, pos: Vector3, yaw: float, mtl: StandardMaterial3D) -> MeshInstance3D:
	var bm := BoxMesh.new()
	bm.size = size
	var mi := MeshInstance3D.new()
	mi.mesh = bm
	mi.material_override = mtl
	mi.position = pos
	mi.rotation.y = yaw
	add_child(mi)
	return mi

func _oct_verts(r: float) -> Array:
	var v: Array = []
	for i in range(8):
		var a := PI / 8.0 + i * PI / 4.0
		v.append(Vector2(r * cos(a), r * sin(a)))
	return v

# ---------------------------------------------------------------------------
# Build steps
# ---------------------------------------------------------------------------
func _build_ground() -> void:
	# Big dark tech floor the whole arena sits on.
	_add_box(Vector3(120, 1.0, 120), Vector3(0, -1.1, 0), 0.0, _solid(Color(0.06, 0.07, 0.10), 0.2, 0.8))

func _build_platform() -> void:
	# Raised octagon platform, dark matte top.
	_add_oct(14.0, 1.4, -0.5, _solid(Color(0.05, 0.055, 0.08), 0.2, 0.8))    # base (raised)
	_add_oct(13.6, 0.16, 0.0, _solid(Color(0.06, 0.07, 0.11), 0.1, 0.85))    # top

func _build_floor_detail() -> void:
	# Subtle glowing octagon outlines on the floor (edge + center emblem).
	var dark := _solid(Color(0.06, 0.07, 0.11), 0.1, 0.85)
	_add_oct(13.2, 0.05, 0.05, _neon(Color(0.35, 0.75, 1.0), 2.2))
	_add_oct(12.7, 0.06, 0.06, dark)
	_add_oct(3.2, 0.05, 0.05, _neon(Color(0.7, 0.4, 1.0), 2.5))
	_add_oct(2.6, 0.06, 0.06, dark)

func _build_railing() -> void:
	var metal := _solid(Color(0.10, 0.11, 0.14), 0.85, 0.35)
	var verts := _oct_verts(14.2)
	for i in range(8):
		var p1: Vector2 = verts[i]
		var p2: Vector2 = verts[(i + 1) % 8]
		var mid := (p1 + p2) * 0.5
		var length := p1.distance_to(p2)
		var yaw := -atan2(p2.y - p1.y, p2.x - p1.x)
		# metal kick-rail + top rail
		_add_box(Vector3(length, 0.4, 0.3), Vector3(mid.x, 0.2, mid.y), yaw, metal)
		_add_box(Vector3(length, 0.22, 0.34), Vector3(mid.x, 1.75, mid.y), yaw, metal)
		# vertical neon bars (the signature look), colored along the gradient
		var bars := 9
		for b in range(bars + 1):
			var t := float(b) / bars
			var px := lerpf(p1.x, p2.x, t)
			var pz := lerpf(p1.y, p2.y, t)
			_add_box(Vector3(0.1, 1.45, 0.1), Vector3(px, 0.97, pz), yaw, _neon(_grad(px), 6.5))
	for v in verts:
		_add_box(Vector3(0.34, 2.0, 0.34), Vector3(v.x, 1.0, v.y), 0.0, metal)

func _build_machines() -> void:
	# Tech/server units around the arena as backdrop dressing.
	var metal := _solid(Color(0.20, 0.22, 0.27), 0.7, 0.45)
	for a in [25.0, 90.0, 155.0, 205.0, 270.0, 335.0]:
		var ang := deg_to_rad(a)
		var x := 19.0 * cos(ang)
		var z := 19.0 * sin(ang)
		var facing := atan2(-x, -z)
		var inward := Vector3(-x, 0, -z).normalized()
		_add_box(Vector3(3.4, 4.4, 2.4), Vector3(x, 1.7, z), facing, metal)
		# glowing vent strips on the inward face
		for h in [1.2, 2.0, 2.8]:
			_add_box(Vector3(2.4, 0.14, 0.1), Vector3(x, h, z) + inward * 1.25, facing, _neon(_grad(x), 4.0))

func _build_billboards() -> void:
	var metal := _solid(Color(0.14, 0.15, 0.20), 0.9, 0.3)
	var specs := [[60.0, CYAN], [120.0, MAGENTA], [240.0, BLUE], [300.0, PURPLE]]
	for s in specs:
		var ang: float = deg_to_rad(s[0])
		var color: Color = s[1]
		var bx := 24.0 * cos(ang)
		var bz := 24.0 * sin(ang)
		var facing := atan2(-bx, -bz)
		var inward := Vector3(-bx, 0, -bz).normalized()
		_add_box(Vector3(0.4, 9.0, 0.4), Vector3(bx, 4.5, bz), facing, metal)   # post
		_add_box(Vector3(8.4, 5.0, 0.3), Vector3(bx, 9.0, bz), facing, metal)   # frame
		# single-sided screen facing the arena
		var qm := QuadMesh.new()
		qm.size = Vector2(7.8, 4.4)
		var smi := MeshInstance3D.new()
		smi.mesh = qm
		smi.material_override = _neon(color, 4.5)
		smi.position = Vector3(bx, 9.0, bz) + inward * 0.3
		smi.rotation.y = facing
		add_child(smi)
		# spotlight from the screen onto the playing ground
		var sp := SpotLight3D.new()
		add_child(sp)
		sp.global_position = Vector3(bx, 9.0, bz)
		sp.look_at(Vector3(0, 0.5, 0), Vector3.UP)
		sp.light_color = color
		sp.light_energy = 8.0
		sp.spot_range = 70.0
		sp.spot_angle = 30.0

func _build_crowd() -> void:
	# Tiered rings of dark spectator silhouettes around the arena.
	var dark := _solid(Color(0.08, 0.09, 0.13), 0.0, 1.0)
	for ring in range(6):
		var radius := 23.0 + ring * 2.6
		var tier_y := -0.5 + ring * 1.15
		var count := int(radius * 1.1)
		for k in range(count):
			var ang := (float(k) + (ring % 2) * 0.5) / count * TAU_
			var x := radius * cos(ang)
			var z := radius * sin(ang)
			_add_box(Vector3(0.5, 1.1, 0.5), Vector3(x, tier_y + 0.55, z), ang, dark)

func _build_skyline() -> void:
	var city := _neon(Color(0.10, 0.16, 0.40), 0.7)
	city.albedo_color = Color(0.03, 0.04, 0.08)
	seed(7)
	for k in range(48):
		var ang := float(k) / 48.0 * TAU_
		var dist := randf_range(70.0, 110.0)
		var h := randf_range(16.0, 46.0)
		var w := randf_range(4.0, 9.0)
		_add_box(Vector3(w, h, w), Vector3(dist * cos(ang), h / 2.0, dist * sin(ang)), ang, city)

func _build_keylight() -> void:
	var sp := SpotLight3D.new()
	add_child(sp)
	sp.position = Vector3(0, 18, 0)
	sp.rotation_degrees = Vector3(-90, 0, 0)
	sp.light_color = Color(0.95, 0.97, 1.0)
	sp.light_energy = 7.0
	sp.spot_range = 40.0
	sp.spot_angle = 34.0
	sp.spot_attenuation = 1.2

func _build_collision() -> void:
	var body := StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 1
	add_child(body)
	var floor_cs := CollisionShape3D.new()
	var floor_shape := CylinderShape3D.new()
	floor_shape.radius = 14.0
	floor_shape.height = 1.0
	floor_cs.shape = floor_shape
	floor_cs.position = Vector3(0, -0.5, 0)
	body.add_child(floor_cs)
	var verts := _oct_verts(14.2)
	for i in range(8):
		var p1: Vector2 = verts[i]
		var p2: Vector2 = verts[(i + 1) % 8]
		var mid := (p1 + p2) * 0.5
		var length := p1.distance_to(p2)
		var yaw := -atan2(p2.y - p1.y, p2.x - p1.x)
		var wcs := CollisionShape3D.new()
		var wshape := BoxShape3D.new()
		wshape.size = Vector3(length, 3.0, 0.5)
		wcs.shape = wshape
		wcs.position = Vector3(mid.x, 1.5, mid.y)
		wcs.rotation.y = yaw
		body.add_child(wcs)
