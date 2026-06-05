extends CharacterBody3D
class_name Fighter

## Little Fighters-style 3D fighter controller.
## Movement happens on the X/Z ground plane (8-directional, beat-'em-up style),
## with jumping on the Y axis. Animations are driven by a small state machine.
##
## This script is written to be robust against your current art pipeline:
## right now your .glb only ships one animation ("mixamo.com"). The state
## machine will simply skip any animation it can't find, so the game still
## runs. As you add more Mixamo clips into the AnimationPlayer, just map their
## names in the @export fields below and the states light up automatically.

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------
@export_group("Movement")
@export var walk_speed: float = 4.0
@export var run_speed: float = 7.0
@export var acceleration: float = 40.0      # how fast we reach target speed
@export var friction: float = 50.0          # how fast we stop
@export var jump_velocity: float = 7.0
@export var jump_move_speed: float = 6.0    # horizontal travel speed while jumping
@export var gravity: float = 20.0
@export var turn_speed: float = 16.0        # how fast the model rotates to face

@export_group("Combat")
@export var attack_duration: float = 0.45   # fallback if a clip has no length
## When the hitbox is live, as a FRACTION of the attack clip's length
## (0.35 = 35% into the swing). Lands the hit around the contact frame.
@export var hit_window_start: float = 0.35
@export var hit_window_end: float = 0.6
@export var attack_damage: int = 8
@export var hit_stun: float = 0.35          # time locked after a light hit
@export var knockback_force: float = 6.0

@export_group("Kick (heavy attack)")
@export var kick_duration: float = 0.6       # fallback if a clip has no length
@export var kick_damage: int = 14
@export var kick_knockback: float = 4.0      # small pushback for the light kick

@export_group("Drop kick (run + kick)")
@export var dropkick_damage: int = 18
@export var dropkick_knockback: float = 14.0 # strong shove that drops the enemy
@export var dropkick_lunge: float = 11.0     # forward lunge speed during the move
@export var dropkick_lunge_time: float = 0.45  # how long the forward lunge lasts
@export var dropkick_start_offset: float = 0.8 # skip this many secs of the clip's run-up slide

@export_group("Dash")
@export var dash_speed: float = 14.0
@export var dash_duration: float = 0.22

@export_group("Block & knockdown")
@export var block_damage_mult: float = 0.15  # damage taken while blocking (0 = full block)
@export var block_pushback: float = 2.0
@export var knockdown_duration: float = 0.8  # time lying down before getting up
@export var getup_duration: float = 0.6
@export var knockdown_speed: float = 1.8     # playback speed of the fall (higher = faster fall)

@export_group("Input")
## Prefix for this fighter's input actions, e.g. "p1" -> "p1_left", "p1_attack".
## Set "p2" on the second fighter. Actions are defined in project.godot.
@export var action_prefix: String = "p1"
@export var ai_controlled: bool = false     # if true, ignores input (hook your AI here)

@export_group("Animation names")
## Map these to the clip names that exist in your AnimationPlayer.
## Leave a field blank (or pointing at a missing clip) and that state just
## won't animate — the rest of the game keeps working.
@export var anim_idle: String = "idle"
@export var anim_walk: String = "walk"
@export var anim_run: String = "run"
@export var anim_jump: String = "jump"
@export var anim_attack: String = "punch"
@export var anim_kick: String = "kick"
@export var anim_dropkick: String = "dropkick"
@export var anim_hit: String = "hit"
@export var anim_block: String = "block"
@export var anim_dash: String = "dash"
@export var anim_knockdown: String = "knockdown"
@export var anim_getup: String = "getup"
@export var anim_ko: String = "death"

## Animations stored in separate .glb files (e.g. Mixamo clips downloaded
## "Without Skin"). They're loaded at runtime and registered under the clean
## name on the left. Key = clip name, Value = path to the .glb.
## Just drop new clips in res://animations/ and add a line here.
## (Lines whose file doesn't exist yet are skipped harmlessly.)
@export var external_animations: Dictionary = {
	"idle": "res://animations/breathing.glb",
	"walk": "res://animations/walking.glb",
	"run": "res://animations/run.glb",
	"jump": "res://animations/jump.glb",
	"punch": "res://animations/punch.glb",
	"kick": "res://animations/mmakick.glb",
	"dropkick": "res://animations/dropkick.glb",
	"hit": "res://animations/hit.glb",
	"block": "res://animations/block.glb",
	"dash": "res://animations/dash.glb",
	"knockdown": "res://animations/knockdown.glb",
	"getup": "res://animations/getup.glb",
	"death": "res://animations/death.glb",
}

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
enum State { IDLE, WALK, RUN, JUMP, ATTACK, KICK, DROPKICK, HIT, BLOCK, DASH, KNOCKDOWN, GETUP, KO }
var state: int = State.IDLE

var facing_sign: float = 1.0     # +1 faces +X (right), -1 faces -X (left)
var _state_time: float = 0.0     # seconds spent in current state
var _hitbox_live: bool = false
var _attack_knocks_down: bool = false   # does the current swing cause a knockdown
var _current_attack_damage: int = 8     # damage of the current swing (read by Hitbox)
var _current_attack_knockback: float = 6.0  # knockback of the current swing
var _dropkick_connected: bool = false   # set when a drop kick lands, halts the lunge
var _dash_dir: Vector3 = Vector3.ZERO   # locked direction during a dash
var _swing_len: float = 0.45            # length of the current attack clip
var _reaction_len: float = 0.35         # length of the current hit/knockdown clip

@onready var anim: AnimationPlayer = _find_animation_player()
@onready var model: Node3D = _find_model()
@onready var health: Node = get_node_or_null("HealthComponent")
@onready var hitbox: Area3D = get_node_or_null("Hitbox")

signal state_changed(new_state)

func _ready() -> void:
	add_to_group("fighters")
	_load_external_animations()
	# Debug: prints the exact animation names available on this model so you
	# can map them in the Inspector. Remove once your anim names are set.
	if anim:
		print("[Fighter] %s animations: %s" % [name, anim.get_animation_list()])
	else:
		print("[Fighter] WARNING: no AnimationPlayer found under ", name)
	if hitbox:
		hitbox.monitoring = false
		hitbox.set("owner_fighter", self)
	if health and health.has_signal("died"):
		health.died.connect(_on_died)
	_enter_state(State.IDLE)


func _physics_process(delta: float) -> void:
	_state_time += delta

	# Gravity always applies.
	if not is_on_floor():
		velocity.y -= gravity * delta

	match state:
		State.IDLE, State.WALK, State.RUN:
			_process_grounded(delta)
		State.JUMP:
			_process_jump(delta)
		State.ATTACK, State.KICK, State.DROPKICK:
			_process_swing(delta)
		State.BLOCK:
			_process_block(delta)
		State.DASH:
			_process_dash(delta)
		State.HIT:
			_process_hit(delta)
		State.KNOCKDOWN:
			_process_knockdown(delta)
		State.GETUP:
			_process_getup(delta)
		State.KO:
			_decelerate(delta)

	move_and_slide()


# ---------------------------------------------------------------------------
# State behaviours
# ---------------------------------------------------------------------------
func _process_grounded(delta: float) -> void:
	var dir := _move_input()

	# Hold block: stand and guard while the key is down.
	if _held("block"):
		velocity.x = 0.0
		velocity.z = 0.0
		_enter_state(State.BLOCK)
		return
	if _pressed("attack"):
		_enter_state(State.ATTACK)
		return
	if _pressed("kick"):
		# Running (holding run while moving) + kick = drop kick; otherwise a normal kick.
		if _held("run") and dir != Vector2.ZERO:
			_enter_state(State.DROPKICK)
		else:
			_enter_state(State.KICK)
		return
	if _pressed("dash"):
		# Dash in the input direction, or forward (facing) if standing still.
		_dash_dir = Vector3(dir.x, 0, dir.y).normalized() if dir != Vector2.ZERO else Vector3(facing_sign, 0, 0)
		_enter_state(State.DASH)
		return
	if _pressed("jump") and is_on_floor():
		velocity.y = jump_velocity
		# Launch in the held direction so the jump arcs that way.
		if dir != Vector2.ZERO:
			velocity.x = dir.x * jump_move_speed
			velocity.z = dir.y * jump_move_speed
			_face_direction(Vector3(dir.x, 0, dir.y), delta)
		_enter_state(State.JUMP)
		return

	var running := _held("run")
	var target_speed := run_speed if running else walk_speed

	if dir != Vector2.ZERO:
		var target := Vector3(dir.x, 0.0, dir.y) * target_speed
		velocity.x = move_toward(velocity.x, target.x, acceleration * delta)
		velocity.z = move_toward(velocity.z, target.z, acceleration * delta)
		_face_direction(Vector3(dir.x, 0, dir.y), delta)
		_enter_state(State.RUN if running else State.WALK)
	else:
		_decelerate(delta)
		_enter_state(State.IDLE)


func _process_jump(delta: float) -> void:
	# Air control: steer the jump in the held direction (responsive).
	var dir := _move_input()
	if dir != Vector2.ZERO:
		var target := Vector3(dir.x, 0.0, dir.y) * jump_move_speed
		velocity.x = move_toward(velocity.x, target.x, acceleration * 2.0 * delta)
		velocity.z = move_toward(velocity.z, target.z, acceleration * 2.0 * delta)
		_face_direction(Vector3(dir.x, 0, dir.y), delta)

	if _pressed("attack"):
		_enter_state(State.ATTACK)   # jump attack
		_attack_knocks_down = true   # air attacks knock the enemy down (drop hit)
		return

	if is_on_floor() and velocity.y <= 0.0:
		_enter_state(State.IDLE)


func _process_swing(delta: float) -> void:
	# Shared logic for ATTACK (punch), KICK and DROPKICK. The state lasts the
	# full length of the animation clip; the hitbox is live for a fraction of it.
	var active_start := _swing_len * hit_window_start
	var active_end := _swing_len * hit_window_end
	if state == State.DROPKICK:
		# Drop kick connects DURING the leap (not late in the long clip).
		active_start = 0.1
		active_end = dropkick_lunge_time + 0.2

	if state == State.DROPKICK and _state_time < dropkick_lunge_time and not _dropkick_connected:
		# Quick committed forward leap in the facing direction.
		var fwd := Vector3(sin(rotation.y), 0, cos(rotation.y))
		velocity.x = fwd.x * dropkick_lunge
		velocity.z = fwd.z * dropkick_lunge
	else:
		_decelerate(delta * 1.5)  # settle quickly after the leap

	if hitbox:
		var live := _state_time >= active_start and _state_time <= active_end
		if live != _hitbox_live:
			_hitbox_live = live
			if hitbox.has_method("set_active"):
				hitbox.set_active(live)
			else:
				hitbox.monitoring = live
				hitbox.visible = live

	if _state_time >= _swing_len:
		if hitbox and hitbox.has_method("set_active"):
			hitbox.set_active(false)
		elif hitbox:
			hitbox.monitoring = false
		_hitbox_live = false
		_enter_state(State.IDLE)


func _process_block(delta: float) -> void:
	_decelerate(delta)
	# Release the key to drop the guard.
	if not _held("block"):
		_enter_state(State.IDLE)


func _process_dash(delta: float) -> void:
	velocity.x = _dash_dir.x * dash_speed
	velocity.z = _dash_dir.z * dash_speed
	_face_direction(_dash_dir, delta)
	if _state_time >= dash_duration:
		_enter_state(State.IDLE)


func _process_hit(delta: float) -> void:
	_decelerate(delta)
	if _state_time >= _reaction_len:
		_enter_state(State.IDLE)


func _process_knockdown(delta: float) -> void:
	_decelerate(delta)  # slide back from the impact, then settle
	if _state_time >= _reaction_len:
		_enter_state(State.GETUP)


func _process_getup(delta: float) -> void:
	_decelerate(delta)
	if _state_time >= _reaction_len:
		_enter_state(State.IDLE)


# ---------------------------------------------------------------------------
# Combat hooks
# ---------------------------------------------------------------------------
## Called by a Hurtbox when this fighter is struck.
## knocks_down: if true (e.g. a kick), a non-lethal hit puts the fighter on the
## ground instead of just flinching.
func take_hit(damage: int, from_position: Vector3, knocks_down: bool = false, knockback: float = 6.0) -> void:
	if state == State.KO or state == State.KNOCKDOWN or state == State.GETUP:
		return

	# Direction from the attacker to us, on the ground plane.
	var away := global_position - from_position
	away.y = 0.0
	if away.length() < 0.001:
		away = Vector3(-facing_sign, 0, 0)
	away = away.normalized()

	# Blocking: only works if we're facing the attacker (they're in front of us).
	var blocked := false
	if state == State.BLOCK:
		var attacker_side := signf(from_position.x - global_position.x)
		if attacker_side == facing_sign or attacker_side == 0.0:
			blocked = true

	var final_damage := damage
	if blocked:
		final_damage = int(round(damage * block_damage_mult))

	if health and health.has_method("apply_damage"):
		health.apply_damage(final_damage)

	# Spawn an impact effect at roughly chest height between the two fighters.
	var fx_pos := global_position.lerp(from_position, 0.4) + Vector3.UP * 1.1
	if blocked:
		_spawn_hit_effect(fx_pos, Color(0.5, 0.7, 1.0))   # blue spark = blocked
		# Small pushback, stay in guard.
		velocity.x = away.x * block_pushback
		velocity.z = away.z * block_pushback
		_enter_state(State.BLOCK)
		return
	_spawn_hit_effect(fx_pos, Color(1.0, 0.85, 0.3))      # yellow spark = clean hit

	velocity.x = away.x * knockback
	velocity.z = away.z * knockback

	# Lethal hits go straight to KO via the HealthComponent.died signal.
	if health and health.has_method("is_alive") and not health.is_alive():
		return  # _on_died() will fire and set KO
	if knocks_down:
		_enter_state(State.KNOCKDOWN)
	else:
		_enter_state(State.HIT)


## Called by the Hitbox when this fighter's attack connects with an enemy,
## so a lunging move (drop kick) stops on impact instead of passing through.
func on_attack_connected() -> void:
	if state == State.DROPKICK:
		_dropkick_connected = true
		velocity.x = 0.0
		velocity.z = 0.0


func _on_died() -> void:
	_enter_state(State.KO)


## A quick expanding emissive flash at a hit's contact point.
func _spawn_hit_effect(pos: Vector3, color: Color) -> void:
	var mi := MeshInstance3D.new()
	var sph := SphereMesh.new()
	sph.radius = 0.22
	sph.height = 0.44
	mi.mesh = sph
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.emission_enabled = true
	mat.emission = color
	mat.albedo_color = color
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mi.material_override = mat
	get_tree().current_scene.add_child(mi)
	mi.global_position = pos
	mi.scale = Vector3.ONE * 0.4
	var tw := get_tree().create_tween()
	tw.set_parallel(true)
	tw.tween_property(mi, "scale", Vector3.ONE * 1.6, 0.18)
	tw.tween_property(mat, "albedo_color:a", 0.0, 0.18)
	tw.set_parallel(false)
	tw.tween_callback(mi.queue_free)


# ---------------------------------------------------------------------------
# State machine plumbing
# ---------------------------------------------------------------------------
func _enter_state(new_state: int) -> void:
	if new_state == state and new_state in [State.IDLE, State.WALK, State.RUN, State.BLOCK]:
		return  # don't restart looping anims every frame
	state = new_state
	_state_time = 0.0
	# Configure attack damage / knockdown / length when entering a swing.
	if new_state == State.ATTACK or new_state == State.KICK or new_state == State.DROPKICK:
		var fallback := attack_duration
		match new_state:
			State.ATTACK:
				_attack_knocks_down = false
				_current_attack_damage = attack_damage
				_current_attack_knockback = knockback_force
			State.KICK:
				# Simple kick: a light hit (flinch + small pushback), no fall.
				_attack_knocks_down = false
				_current_attack_damage = kick_damage
				_current_attack_knockback = kick_knockback
				fallback = kick_duration
			State.DROPKICK:
				# Drop kick: heavy hit that knocks the enemy down.
				_attack_knocks_down = true
				_current_attack_damage = dropkick_damage
				_current_attack_knockback = dropkick_knockback
				_dropkick_connected = false
				fallback = kick_duration
		var clip := _anim_for(new_state)
		_swing_len = fallback
		if anim and anim.has_animation(clip):
			_swing_len = anim.get_animation(clip).length
		# Drop kick: skip the clip's run-up slide at the start.
		if new_state == State.DROPKICK:
			_swing_len = maxf(0.2, _swing_len - dropkick_start_offset)
	# Reaction states last as long as their clip (so it isn't cut short).
	if new_state == State.HIT or new_state == State.KNOCKDOWN or new_state == State.GETUP:
		var rclip := _anim_for(new_state)
		var rfallback := hit_stun
		if new_state == State.KNOCKDOWN:
			rfallback = knockdown_duration
		elif new_state == State.GETUP:
			rfallback = getup_duration
		_reaction_len = rfallback
		if anim and anim.has_animation(rclip):
			_reaction_len = anim.get_animation(rclip).length
		# Play the fall faster, and shorten the state to match.
		if new_state == State.KNOCKDOWN:
			_reaction_len /= maxf(0.1, knockdown_speed)
	# Speed up the knockdown clip; everything else plays at normal speed.
	if anim:
		anim.speed_scale = knockdown_speed if new_state == State.KNOCKDOWN else 1.0
	var should_loop := new_state in [State.IDLE, State.WALK, State.RUN, State.BLOCK]
	_play(_anim_for(new_state), should_loop)
	# Drop kick: jump past the run-up portion of the animation.
	if new_state == State.DROPKICK and anim and dropkick_start_offset > 0.0:
		anim.seek(dropkick_start_offset, true)
	# Debug: shows each state the fighter enters, so you can confirm moves fire
	# even before their animation clips exist. Remove once anims are all in.
	print("[Fighter] %s -> %s" % [name, State.keys()[new_state]])
	state_changed.emit(new_state)


func _anim_for(s: int) -> String:
	match s:
		State.IDLE: return anim_idle
		State.WALK: return anim_walk
		State.RUN:  return anim_run if anim_run != "" else anim_walk
		State.JUMP: return anim_jump
		State.ATTACK: return anim_attack
		State.KICK: return anim_kick
		State.DROPKICK: return anim_dropkick
		State.HIT: return anim_hit
		State.BLOCK: return anim_block
		State.DASH: return anim_dash if anim_dash != "" else anim_run
		State.KNOCKDOWN: return anim_knockdown
		State.GETUP: return anim_getup
		State.KO: return anim_ko
	return ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
func _move_input() -> Vector2:
	if ai_controlled:
		return Vector2.ZERO
	# x = left/right, y = up/down screen (mapped to world Z)
	var x := Input.get_action_strength(_act("right")) - Input.get_action_strength(_act("left"))
	var y := Input.get_action_strength(_act("down")) - Input.get_action_strength(_act("up"))
	var v := Vector2(x, y)
	if v.length() > 1.0:
		v = v.normalized()
	return v


func _decelerate(delta: float) -> void:
	velocity.x = move_toward(velocity.x, 0.0, friction * delta)
	velocity.z = move_toward(velocity.z, 0.0, friction * delta)


func _face_direction(dir3: Vector3, delta: float) -> void:
	# Rotate the whole body to face the movement direction. Rotating the body
	# (not just the model) keeps the Hitbox pointing where the fighter faces,
	# so attacks actually reach the target. Movement is in world space, so body
	# rotation doesn't affect it.
	if dir3.length() < 0.05:
		return
	var target_y := atan2(dir3.x, dir3.z)
	var weight: float = clampf(turn_speed * delta, 0.0, 1.0)
	rotation.y = lerp_angle(rotation.y, target_y, weight)
	# Keep a left/right sign for block/knockback logic.
	if absf(dir3.x) > 0.05:
		facing_sign = signf(dir3.x)


func _play(clip: String, loop: bool = false) -> void:
	if anim == null or clip == "":
		return
	if not anim.has_animation(clip):
		return  # clip not imported yet — skip silently
	if loop:
		var a := anim.get_animation(clip)
		if a and a.loop_mode == Animation.LOOP_NONE:
			a.loop_mode = Animation.LOOP_LINEAR
	if anim.current_animation != clip:
		anim.play(clip)


func _act(name: String) -> String:
	return "%s_%s" % [action_prefix, name]

func _pressed(name: String) -> bool:
	return not ai_controlled and Input.is_action_just_pressed(_act(name))

func _held(name: String) -> bool:
	return not ai_controlled and Input.is_action_pressed(_act(name))


func _load_external_animations() -> void:
	# Pulls clips out of separate .glb files and registers them on this
	# fighter's AnimationPlayer under clean names. Works because every Mixamo
	# clip shares the same skeleton/bone names as the model.
	if anim == null:
		return
	var lib: AnimationLibrary
	if anim.has_animation_library(""):
		lib = anim.get_animation_library("")
	else:
		lib = AnimationLibrary.new()
		anim.add_animation_library("", lib)

	for clip_name in external_animations.keys():
		var path := _resolve_anim_path(external_animations[clip_name])
		if path == "":
			print("[AnimLoad] %s: NO FILE found" % clip_name)
			continue
		var packed = load(path)
		if packed == null:
			print("[AnimLoad] %s: load() FAILED for %s" % [clip_name, path])
			continue
		var inst: Node = packed.instantiate()
		var src_ap := _recursive_find(inst, "AnimationPlayer") as AnimationPlayer
		if src_ap == null:
			print("[AnimLoad] %s: no AnimationPlayer inside %s" % [clip_name, path])
			inst.queue_free()
			continue
		var names := src_ap.get_animation_list()
		if names.size() >= 1:
			# Use the first clip (clean files have exactly one).
			var src := src_ap.get_animation(names[0])
			if src:
				var dup := src.duplicate(true) as Animation
				_register_clip(lib, clip_name, dup)
				var extra := "" if names.size() == 1 else "  (warning: %d clips, used first)" % names.size()
				print("[AnimLoad] %s: OK <- %s%s" % [clip_name, path, extra])
		else:
			print("[AnimLoad] %s: ZERO clips in %s" % [clip_name, path])
		inst.queue_free()


## Adds a clip to the library, applying looping and root-motion stripping.
func _register_clip(lib: AnimationLibrary, clip_name: String, anim_clip: Animation) -> void:
	# In-place locomotion: remove the hips translation so the clip doesn't drift
	# the body forward (the code drives movement). Equivalent to Mixamo "In Place".
	if clip_name in ["walk", "run", "dash"]:
		_strip_root_motion(anim_clip)
	# Looping clips play continuously instead of restarting with a visible pop.
	if clip_name in ["idle", "walk", "run", "block"]:
		anim_clip.loop_mode = Animation.LOOP_LINEAR
	if lib.has_animation(clip_name):
		lib.remove_animation(clip_name)
	lib.add_animation(clip_name, anim_clip)


## Removes the position track on the root (Hips) bone so the animation stays
## in place instead of translating the character.
func _strip_root_motion(anim_clip: Animation) -> void:
	for i in range(anim_clip.get_track_count() - 1, -1, -1):
		if anim_clip.track_get_type(i) == Animation.TYPE_POSITION_3D:
			var p := str(anim_clip.track_get_path(i))
			if p.contains("Hips"):
				anim_clip.remove_track(i)


## Finds the actual file for an animation, preferring a clean .fbx re-import
## over an older bundled .glb of the same name.
func _resolve_anim_path(configured: String) -> String:
	var base := (configured as String).get_basename()
	# Prefer Blender-made .glb (compatible skeleton) over raw .fbx.
	for ext in [".glb", ".gltf", ".fbx"]:
		var p: String = base + ext
		if ResourceLoader.exists(p):
			return p
	# Fall back to exactly what was configured (handles odd names).
	if ResourceLoader.exists(configured):
		return configured
	return ""


func _find_animation_player() -> AnimationPlayer:
	return _recursive_find(self, "AnimationPlayer") as AnimationPlayer

func _find_model() -> Node3D:
	# Prefer a child explicitly named "Model" (the instanced glb).
	var m := get_node_or_null("Model")
	if m is Node3D:
		return m
	# Fallback: first Node3D child that isn't a gameplay/physics node.
	for child in get_children():
		if child is Node3D and not (child is Area3D) and not (child is CollisionShape3D):
			return child
	return null

func _recursive_find(node: Node, klass: String) -> Node:
	for child in node.get_children():
		if child.get_class() == klass:
			return child
		var found := _recursive_find(child, klass)
		if found:
			return found
	return null
