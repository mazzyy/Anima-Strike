extends Node
class_name HealthComponent

## Simple health pool. Attach as a child named "HealthComponent" under a Fighter.

@export var max_health: int = 100
var current_health: int

signal health_changed(current: int, max: int)
signal died

func _ready() -> void:
	current_health = max_health
	health_changed.emit(current_health, max_health)

func apply_damage(amount: int) -> void:
	if current_health <= 0:
		return
	current_health = max(current_health - amount, 0)
	health_changed.emit(current_health, max_health)
	if current_health == 0:
		died.emit()

func heal(amount: int) -> void:
	current_health = min(current_health + amount, max_health)
	health_changed.emit(current_health, max_health)

func is_alive() -> bool:
	return current_health > 0
