extends CanvasLayer

## Binds each fighter's HealthComponent to an on-screen health bar.
## Player 1 -> top-left bar, Player 2 -> top-right bar.

@onready var p1_bar: ProgressBar = $P1Bar
@onready var p2_bar: ProgressBar = $P2Bar

func _ready() -> void:
	# Wait one frame so all fighters have run _ready and joined the group.
	await get_tree().process_frame
	for fighter in get_tree().get_nodes_in_group("fighters"):
		var hc := fighter.get_node_or_null("HealthComponent")
		if hc == null:
			continue
		var prefix: String = fighter.action_prefix if "action_prefix" in fighter else "p1"
		var bar: ProgressBar = p2_bar if prefix == "p2" else p1_bar
		bar.max_value = hc.max_health
		bar.value = hc.current_health
		# Capture this bar for the closure.
		hc.health_changed.connect(func(current: int, maximum: int) -> void:
			bar.max_value = maximum
			bar.value = current
		)
