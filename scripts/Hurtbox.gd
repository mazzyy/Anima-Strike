extends Area3D
class_name Hurtbox

## The vulnerable volume of a fighter. Lives as a child named "Hurtbox" under a
## Fighter. When an enemy Hitbox overlaps it, it forwards the hit to its owner.

@export var owner_fighter_path: NodePath = ^".."  # defaults to parent Fighter
var owner_fighter: Node

func _ready() -> void:
	owner_fighter = get_node_or_null(owner_fighter_path)

func receive_hit(damage: int, from_position: Vector3, knocks_down: bool = false) -> void:
	if owner_fighter and owner_fighter.has_method("take_hit"):
		owner_fighter.take_hit(damage, from_position, knocks_down)
