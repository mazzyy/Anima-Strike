extends CanvasLayer
## Shows a full-screen background image behind the 3D fighters.
## Drop your arena image at res://backgrounds/arena_bg.png (any image works).
## Works with the WorldEnvironment set to a Canvas background.

@export var image_path: String = "res://backgrounds/stage.png"

func _ready() -> void:
	layer = -1   # render behind the 3D scene (Environment bg = Canvas shows this)
	var tr := TextureRect.new()
	tr.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	add_child(tr)
	var found := _find_image()
	if found != "":
		tr.texture = load(found)
		print("[Backdrop] using ", found)
	else:
		push_warning("[Backdrop] No image found in res://backgrounds/ — drop your arena image there.")

## Use the configured image if present, otherwise the first image in backgrounds/.
func _find_image() -> String:
	if ResourceLoader.exists(image_path):
		return image_path
	var dir := DirAccess.open("res://backgrounds")
	if dir:
		dir.list_dir_begin()
		var f := dir.get_next()
		while f != "":
			if not dir.current_is_dir():
				var lf := f.to_lower()
				if lf.ends_with(".png") or lf.ends_with(".jpg") or lf.ends_with(".jpeg") or lf.ends_with(".webp"):
					return "res://backgrounds/" + f
			f = dir.get_next()
	return ""
