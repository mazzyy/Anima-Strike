extends Node
class_name AIController

## Drives a Fighter whose `ai_controlled` is true.
##
## Two layers, on purpose:
##   · a local heuristic layer that runs every physics frame — it is what
##     actually presses the buttons, so the fight never stutters or stalls
##   · an Azure GPT layer that, every few seconds, returns a *plan* (stance,
##     preferred attack, aggression) which re-weights the local layer
##
## If the network is slow, the key is missing, or the model replies with
## nonsense, the local layer keeps fighting on its own. The LLM makes the
## opponent read the match; it is never in the critical path of a frame.

@export_group("Wiring")
## The Fighter this controller drives. Leave empty to use the parent node.
@export var fighter_path: NodePath
## The Fighter to fight. Leave empty to auto-pick the nearest other fighter.
@export var opponent_path: NodePath
@export var brain_path: NodePath

@export_group("Tactics")
@export var use_llm: bool = true
## Seconds between plan requests. Also re-requested immediately after a KO
## swing lands or health crosses a threshold.
@export var think_interval: float = 3.0
@export var reaction_delay: float = 0.12   ## human-ish input lag, seconds
@export var attack_range: float = 1.9
@export var spacing_range: float = 3.2
@export var debug_log: bool = false

var fighter: Fighter
var opponent: Fighter
var brain: AzureBrain

## The model speaks fighting-game vocabulary; the Fighter's input actions are
## named differently. Everything crossing that boundary goes through this map.
const ACTION_FOR := {
	"punch": "attack",
	"attack": "attack",
	"kick": "kick",
	"dropkick": "kick",
	"dash": "dash",
	"block": "block",
}

var stance: String = "poke"
var preferred: String = "attack"      ## a Fighter action name, already mapped
var wants_dropkick: bool = false      ## the plan asked for kick-while-running
var aggression: float = 0.5
var last_taunt: String = ""

var _think_timer: float = 0.0
var _decision_timer: float = 0.0
var _last_health_bucket: int = -1
var _blocked_streak: int = 0


func _ready() -> void:
	if not fighter_path.is_empty():
		fighter = get_node_or_null(fighter_path) as Fighter
	else:
		fighter = get_parent() as Fighter
	if fighter == null:
		push_error("[AIController] No Fighter found — set fighter_path.")
		set_physics_process(false)
		return
	fighter.ai_controlled = true

	if not opponent_path.is_empty():
		opponent = get_node_or_null(opponent_path) as Fighter
	if not brain_path.is_empty():
		brain = get_node_or_null(brain_path) as AzureBrain
	if brain == null:
		brain = get_node_or_null("AzureBrain") as AzureBrain

	if brain:
		brain.tactic_received.connect(_on_tactic)
		brain.brain_error.connect(_on_brain_error)

	_think_timer = randf() * think_interval   # de-sync multiple AI fighters


func _physics_process(delta: float) -> void:
	if opponent == null or not is_instance_valid(opponent):
		opponent = _find_opponent()
		if opponent == null:
			return

	if fighter.state == Fighter.State.KO:
		fighter.ai_move = Vector2.ZERO
		return

	_maybe_think(delta)

	_decision_timer -= delta
	if _decision_timer > 0.0:
		return
	_decision_timer = reaction_delay

	_act()


# ---------------------------------------------------------------------------
# The local layer — this is what actually plays the game
# ---------------------------------------------------------------------------
func _act() -> void:
	var to_enemy: Vector3 = opponent.global_position - fighter.global_position
	to_enemy.y = 0.0
	var dist: float = to_enemy.length()
	var dir := Vector2(to_enemy.x, to_enemy.z).normalized() if dist > 0.001 else Vector2.ZERO

	var enemy_attacking := opponent.state in [
		Fighter.State.ATTACK, Fighter.State.KICK, Fighter.State.DROPKICK,
	]
	var my_health := _health_fraction(fighter)

	# Always release last frame's holds; we re-assert them below.
	fighter.ai_hold_set("block", false)
	fighter.ai_hold_set("run", false)

	# Reflex: guard against an incoming swing we are inside the range of.
	var guard_chance := 0.75 - aggression * 0.45
	if enemy_attacking and dist < attack_range + 0.6 and randf() < guard_chance:
		fighter.ai_move = Vector2.ZERO
		fighter.ai_hold_set("block", true)
		return

	match stance:
		"retreat":
			fighter.ai_move = -dir
			if dist < attack_range and randf() < 0.25:
				fighter.ai_press("dash")
			return
		"defensive":
			if dist < spacing_range:
				fighter.ai_move = -dir * 0.6
				fighter.ai_hold_set("block", dist < attack_range)
			else:
				fighter.ai_move = Vector2.ZERO
			if dist < attack_range and randf() < 0.15 * aggression:
				fighter.ai_press(_pick_attack())
			return
		"spacing":
			var band := spacing_range
			if dist > band + 0.5:
				fighter.ai_move = dir * 0.7
			elif dist < band - 0.5:
				fighter.ai_move = -dir * 0.7
			else:
				fighter.ai_move = Vector2(-dir.y, dir.x) * 0.5   # strafe
			if dist <= attack_range and randf() < 0.35 * aggression:
				fighter.ai_press(_pick_attack())
			return
		"rush":
			if dist > attack_range:
				fighter.ai_move = dir
				fighter.ai_hold_set("run", dist > spacing_range)
				# Run + kick is the drop kick — close a big gap with it.
				if dist > spacing_range and wants_dropkick and randf() < 0.05:
					fighter.ai_press("kick")
			else:
				fighter.ai_move = dir * 0.2
				if randf() < 0.5 + aggression * 0.4:
					fighter.ai_press(_pick_attack())
			return
		_:   # "poke" and anything unrecognised
			if dist > attack_range:
				fighter.ai_move = dir * (0.6 + aggression * 0.4)
				if my_health < 0.35 and randf() < 0.02:
					fighter.ai_press("dash")
			else:
				fighter.ai_move = Vector2.ZERO
				if randf() < 0.3 + aggression * 0.35:
					fighter.ai_press(_pick_attack())


func _pick_attack() -> String:
	# Bias toward the plan's preferred attack, but keep it unpredictable so a
	# human can't just hold block against one button. "dash" and "block" are
	# not attacks, so they fall back to the punch.
	var base: String = preferred if preferred in ["attack", "kick"] else "attack"
	if _blocked_streak >= 3:
		_blocked_streak = 0
		return "kick" if base == "attack" else "attack"
	if randf() < 0.65:
		return base
	return "attack" if randf() < 0.5 else "kick"


func _health_fraction(f: Fighter) -> float:
	var hc := f.get_node_or_null("HealthComponent") as HealthComponent
	if hc == null or hc.max_health <= 0:
		return 1.0
	return clampf(float(hc.current_health) / float(hc.max_health), 0.0, 1.0)


func _find_opponent() -> Fighter:
	var best: Fighter = null
	var best_d := INF
	for node in get_tree().get_nodes_in_group("fighters"):
		var other := node as Fighter
		if other == null or other == fighter:
			continue
		var d: float = other.global_position.distance_to(fighter.global_position)
		if d < best_d:
			best_d = d
			best = other
	return best


# ---------------------------------------------------------------------------
# The LLM layer — plans, not button presses
# ---------------------------------------------------------------------------
func _maybe_think(delta: float) -> void:
	if not use_llm or brain == null:
		return

	_think_timer -= delta

	# Re-plan immediately when the match state changes meaningfully.
	var bucket := int(_health_fraction(fighter) * 4.0)
	if bucket != _last_health_bucket:
		_last_health_bucket = bucket
		_think_timer = min(_think_timer, 0.2)

	if _think_timer > 0.0:
		return
	_think_timer = think_interval

	if brain.request_tactic(_snapshot()) and debug_log:
		print("[AIController] asked for a plan")


func _snapshot() -> Dictionary:
	var to_enemy: Vector3 = opponent.global_position - fighter.global_position
	to_enemy.y = 0.0
	return {
		"my_health_pct": int(_health_fraction(fighter) * 100.0),
		"enemy_health_pct": int(_health_fraction(opponent) * 100.0),
		"distance": snappedf(to_enemy.length(), 0.1),
		"attack_range": attack_range,
		"my_state": Fighter.State.keys()[fighter.state],
		"enemy_state": Fighter.State.keys()[opponent.state],
		"enemy_blocked_my_last_hits": _blocked_streak,
		"current_stance": stance,
	}


func _on_tactic(tactic: Dictionary) -> void:
	stance = String(tactic.get("stance", stance))
	var raw := String(tactic.get("preferred", "punch")).to_lower()
	wants_dropkick = raw == "dropkick"
	preferred = String(ACTION_FOR.get(raw, "attack"))
	aggression = float(tactic.get("aggression", aggression))
	var taunt := String(tactic.get("taunt", ""))
	if taunt != "":
		last_taunt = taunt
	if debug_log:
		print("[AIController] plan: %s / %s / aggression %.2f  %s" % [
			stance, preferred, aggression, last_taunt,
		])


func _on_brain_error(message: String) -> void:
	# Non-fatal by design: the local layer carries the fight.
	if debug_log:
		push_warning("[AIController] brain: %s" % message)


## Call this from Hurtbox/Fighter when an attack is blocked, so the plan can
## react to a turtling human player.
func note_blocked() -> void:
	_blocked_streak += 1
