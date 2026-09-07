@tool
extends Node
class_name AssassinSkin

## Reskins the instanced Knight model non-destructively:
##  - the head/hands mesh gets a NATURAL human-skin material (so the face reads
##    as a person, not a glowing mask)
##  - the body & armor meshes get the stylized dark-assassin material
##
## `variant` palette-swaps the armor so Player 2 looks like a distinct fighter
## while sharing the exact same rig, animations and gameplay as Player 1.

enum Variant { CRIMSON, AZURE }

@export var variant: Variant = Variant.CRIMSON:
	set(value):
		variant = value
		if is_inside_tree():
			apply()
@export var enabled: bool = true
## When on, the armor color is chosen automatically from the fighter's
## action_prefix ("p2" -> azure, otherwise crimson). This is robust against
## scene re-saves dropping a per-instance override. Turn off to force `variant`.
@export var auto_by_player: bool = true

const FACE_MAT: Material = preload("res://materials/face_skin.tres")
const ARMOR_CRIMSON: Material = preload("res://materials/assassin_skin.tres")
const ARMOR_AZURE: Material = preload("res://materials/assassin_skin_blue.tres")

func _ready() -> void:
	if enabled:
		apply()

func apply() -> void:
	var root := get_parent()
	if root == null:
		return
	var use_azure: bool = (variant == Variant.AZURE)
	if auto_by_player and ("action_prefix" in root):
		use_azure = (root.action_prefix == "p2")
	var armor: Material = ARMOR_AZURE if use_azure else ARMOR_CRIMSON
	for mi in root.find_children("*", "MeshInstance3D", true, false):
		# Head_Hands -> natural face/skin; everything else -> assassin armor.
		var is_face := mi.name.to_lower().contains("head")
		var mat: Material = FACE_MAT if is_face else armor
		var count: int = max(mi.mesh.get_surface_count() if mi.mesh else 1, 1)
		for s in range(count):
			mi.set_surface_override_material(s, mat)
