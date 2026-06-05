extends Area3D
class_name Hitbox

## The damaging volume of an attack. Lives as a child named "Hitbox" under a
## Fighter. The Fighter enables monitoring only during an attack's active
## frames. When it overlaps an enemy Hurtbox, it deals damage once per swing.
##
## Collision layer/mask suggestion (set in the Inspector):
##   Hitbox  -> layer: "hitbox",  mask: "hurtbox"
##   Hurtbox -> layer: "hurtbox", mask: "hitbox"

var owner_fighter: Node = null   # set by Fighter._ready()
var _already_hit: Array = []     # hurtboxes hit during the current activation

func _ready() -> void:
	monitoring = false
	visible = false
	area_entered.connect(_on_area_entered)

func _on_area_entered(area: Area3D) -> void:
	if not (area is Hurtbox):
		return
	var hurt := area as Hurtbox
	# Don't hit yourself.
	if hurt.owner_fighter == owner_fighter:
		return
	if hurt in _already_hit:
		return
	_already_hit.append(hurt)
	var dmg := 8
	var knocks_down := false
	if owner_fighter:
		# The Fighter sets these per swing (punch / kick / drop kick).
		if "_current_attack_damage" in owner_fighter:
			dmg = owner_fighter._current_attack_damage
		if "_attack_knocks_down" in owner_fighter:
			knocks_down = owner_fighter._attack_knocks_down
	var from_pos: Vector3 = owner_fighter.global_position if owner_fighter else global_position
	hurt.receive_hit(dmg, from_pos, knocks_down)

func set_active(active: bool) -> void:
	monitoring = active
	visible = active
	if active:
		_already_hit.clear()
