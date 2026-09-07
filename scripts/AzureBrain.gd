extends Node
class_name AzureBrain

## Async Azure GPT client for the in-game opponent.
##
## Sends a compact snapshot of the fight to the Azure AI Foundry Responses API
## and emits a tactic dictionary when the reply lands. One request in flight at
## a time, rate-limited, and it never blocks the frame — if the network is slow
## or down, AIController just keeps using its local heuristics.
##
## Credentials are NOT stored in this file or anywhere in the repo. They are
## read, in order, from:
##   1. the AZURE_OPENAI_API_KEY environment variable
##   2. user://azure.cfg  (written by `python3 automation/lf.py opponent key`)
##   3. the api_key_override export below (leave empty; for quick local tests)

signal tactic_received(tactic: Dictionary)
signal usage_updated(totals: Dictionary)
signal brain_error(message: String)

@export_group("Connection")
@export var endpoint: String = "https://tasting-resource.services.ai.azure.com/openai/v1/responses"
@export var model: String = "gpt-6-astra"
@export var api_key_override: String = ""
@export var request_timeout: float = 8.0

@export_group("Behaviour")
## Minimum seconds between requests. The fight is driven by local heuristics
## between calls, so this can be generous — every call costs money.
@export var min_interval: float = 2.5
@export var max_output_tokens: int = 400
@export var enabled: bool = true

@export_group("Cost tracking")
## USD per 1,000,000 tokens. Left at 0 the brain still counts tokens exactly
## and simply reports cost as unknown. Set them with:
##   python3 automation/lf.py opponent key --price-in 1.25 --price-out 10.00
@export var price_input_per_1m: float = 0.0
@export var price_output_per_1m: float = 0.0
## Where the running total is kept between runs.
@export var usage_path: String = "user://azure_usage.json"

const CONFIG_PATH := "user://azure.cfg"

const SYSTEM_PROMPT := """You are the tactical brain of a CPU fighter in a 3D beat-'em-up.

You are given the current state of the fight. Choose a short-term plan. You are
NOT controlling individual frames — a local controller executes your plan for the
next couple of seconds, so pick intent, not button presses.

Reply with JSON only, no prose, matching exactly this shape:
{"stance": "...", "preferred": "...", "aggression": 0.0, "taunt": "..."}

  stance      one of: rush, poke, spacing, defensive, retreat
  preferred   one of: punch, kick, dropkick, dash, block
  aggression  0.0 (passive) to 1.0 (relentless)
  taunt       at most 8 words of fighting-game trash talk, or ""

Read the numbers before choosing. Low health means you should stop trading hits.
If the enemy is blocking a lot, stop throwing the same attack into their guard.
If they are far away and you are ahead on health, make them come to you."""

var _http: HTTPRequest
var _in_flight: bool = false
var _cooldown: float = 0.0
var _key: String = ""

var totals: Dictionary = {
	"calls": 0,
	"input_tokens": 0,
	"output_tokens": 0,
	"total_tokens": 0,
	"cost_usd": 0.0,
	"priced": false,
}


func _ready() -> void:
	_load_config()
	_load_usage()
	_http = HTTPRequest.new()
	_http.timeout = request_timeout
	add_child(_http)
	_http.request_completed.connect(_on_request_completed)
	if _key == "":
		push_warning("[AzureBrain] No API key found — running on local heuristics only. "
			+ "Set AZURE_OPENAI_API_KEY or run: python3 automation/lf.py opponent key")


func _process(delta: float) -> void:
	if _cooldown > 0.0:
		_cooldown -= delta


## True when a new request would actually be sent.
func is_ready() -> bool:
	return enabled and _key != "" and not _in_flight and _cooldown <= 0.0


## Ask for a fresh tactic. `snapshot` is a small Dictionary of fight state.
## Returns false if the request was skipped (throttled, busy, or no key).
func request_tactic(snapshot: Dictionary) -> bool:
	if not is_ready():
		return false

	var user_text := JSON.stringify(snapshot)
	var body := {
		"model": model,
		"input": [
			{"role": "system", "content": SYSTEM_PROMPT},
			{"role": "user", "content": user_text},
		],
		"max_output_tokens": max_output_tokens,
	}

	var headers := PackedStringArray([
		"Content-Type: application/json",
		"api-key: %s" % _key,
	])

	var err := _http.request(endpoint, headers, HTTPClient.METHOD_POST, JSON.stringify(body))
	if err != OK:
		brain_error.emit("request failed to start (error %d)" % err)
		_cooldown = min_interval
		return false

	_in_flight = true
	_cooldown = min_interval
	return true


func _on_request_completed(result: int, code: int, _headers: PackedStringArray,
		body: PackedByteArray) -> void:
	_in_flight = false

	if result != HTTPRequest.RESULT_SUCCESS:
		brain_error.emit("network error (result %d)" % result)
		return

	var text := body.get_string_from_utf8()
	if code != 200:
		brain_error.emit("HTTP %d: %s" % [code, text.substr(0, 300)])
		return

	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		brain_error.emit("unparsable response body")
		return

	_record_usage(parsed.get("usage", {}))

	var reply := _extract_text(parsed)
	if reply == "":
		brain_error.emit("empty reply")
		return

	var tactic := _parse_tactic(reply)
	if tactic.is_empty():
		brain_error.emit("reply was not a tactic: %s" % reply.substr(0, 200))
		return

	tactic_received.emit(tactic)


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------
func _extract_text(data: Dictionary) -> String:
	if data.has("output_text") and typeof(data["output_text"]) == TYPE_STRING:
		if not String(data["output_text"]).strip_edges().is_empty():
			return data["output_text"]

	var parts := PackedStringArray()
	for item in data.get("output", []):
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var content = item.get("content", [])
		if typeof(content) == TYPE_STRING:
			parts.append(content)
			continue
		if typeof(content) != TYPE_ARRAY:
			continue
		for chunk in content:
			if typeof(chunk) == TYPE_DICTIONARY and chunk.get("type", "") in ["output_text", "text"]:
				parts.append(String(chunk.get("text", "")))
	return "\n".join(parts)


func _parse_tactic(reply: String) -> Dictionary:
	var body := reply.strip_edges()

	# Strip a ```json fence if the model added one.
	if body.begins_with("```"):
		var first_nl := body.find("\n")
		if first_nl != -1:
			body = body.substr(first_nl + 1)
		var fence := body.rfind("```")
		if fence != -1:
			body = body.substr(0, fence)
		body = body.strip_edges()

	# Fall back to the outermost braces.
	if not body.begins_with("{"):
		var start := body.find("{")
		var stop := body.rfind("}")
		if start == -1 or stop <= start:
			return {}
		body = body.substr(start, stop - start + 1)

	var parsed = JSON.parse_string(body)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}

	return {
		"stance": String(parsed.get("stance", "poke")).to_lower(),
		"preferred": String(parsed.get("preferred", "punch")).to_lower(),
		"aggression": clampf(float(parsed.get("aggression", 0.5)), 0.0, 1.0),
		"taunt": String(parsed.get("taunt", "")),
	}


# ---------------------------------------------------------------------------
# Credentials + cost
# ---------------------------------------------------------------------------
func _load_config() -> void:
	_key = OS.get_environment("AZURE_OPENAI_API_KEY").strip_edges()

	var cfg := ConfigFile.new()
	if cfg.load(CONFIG_PATH) == OK:
		if _key == "":
			_key = String(cfg.get_value("azure", "api_key", "")).strip_edges()
		endpoint = String(cfg.get_value("azure", "endpoint", endpoint))
		model = String(cfg.get_value("azure", "model", model))
		price_input_per_1m = float(cfg.get_value("azure", "input_per_1m", price_input_per_1m))
		price_output_per_1m = float(cfg.get_value("azure", "output_per_1m", price_output_per_1m))

	if _key == "":
		_key = api_key_override.strip_edges()


func _record_usage(raw: Variant) -> void:
	if typeof(raw) != TYPE_DICTIONARY:
		return
	var input_tokens := int(raw.get("input_tokens", raw.get("prompt_tokens", 0)))
	var output_tokens := int(raw.get("output_tokens", raw.get("completion_tokens", 0)))
	var total := int(raw.get("total_tokens", input_tokens + output_tokens))

	totals["calls"] = int(totals["calls"]) + 1
	totals["input_tokens"] = int(totals["input_tokens"]) + input_tokens
	totals["output_tokens"] = int(totals["output_tokens"]) + output_tokens
	totals["total_tokens"] = int(totals["total_tokens"]) + total

	var priced := price_input_per_1m > 0.0 or price_output_per_1m > 0.0
	totals["priced"] = priced
	if priced:
		var cost := (input_tokens * price_input_per_1m + output_tokens * price_output_per_1m) / 1000000.0
		totals["cost_usd"] = float(totals["cost_usd"]) + cost

	_save_usage()
	usage_updated.emit(totals)


## One-line summary suitable for a debug label or the HUD.
func usage_line() -> String:
	var cost := "unpriced" if not bool(totals["priced"]) \
		else "$%0.4f" % float(totals["cost_usd"])
	return "AI: %d calls · %d tok · %s" % [
		int(totals["calls"]), int(totals["total_tokens"]), cost,
	]


func _load_usage() -> void:
	if not FileAccess.file_exists(usage_path):
		return
	var f := FileAccess.open(usage_path, FileAccess.READ)
	if f == null:
		return
	var parsed = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(parsed) == TYPE_DICTIONARY:
		for key in totals.keys():
			if parsed.has(key):
				totals[key] = parsed[key]


func _save_usage() -> void:
	var f := FileAccess.open(usage_path, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify(totals, "  "))
	f.close()


## Wipe the running total (both in memory and on disk).
func reset_usage() -> void:
	totals = {
		"calls": 0, "input_tokens": 0, "output_tokens": 0,
		"total_tokens": 0, "cost_usd": 0.0, "priced": false,
	}
	_save_usage()
	usage_updated.emit(totals)
