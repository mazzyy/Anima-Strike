/**
 * The tactical brain for the CPU fighter, running in the main process.
 *
 * Ported from AzureBrain.gd. Same contract: given a snapshot of the fight,
 * return a short-term plan. One request in flight at a time, rate-limited,
 * and every failure resolves to null so the renderer's local tactics layer
 * simply carries on.
 *
 * Token and cost accounting is folded into the SAME ledger the CLI writes
 * (automation/usage.json), under the command name "game", so one number
 * covers everything the Azure key was used for.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const PROJECT = path.resolve(APP, '..');            // the original project root
const AUTOMATION = path.join(PROJECT, 'automation');
const LEDGER = path.join(AUTOMATION, 'usage.json');
const PRICING = path.join(AUTOMATION, 'pricing.json');

const DEFAULT_ENDPOINT =
  'https://tasting-resource.services.ai.azure.com/openai/v1/responses';
const DEFAULT_MODEL = 'gpt-6-astra';

const SYSTEM_PROMPT = `You are the tactical brain of a CPU fighter in a 3D beat-'em-up.

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
If they are far away and you are ahead on health, make them come to you.`;

const STANCES = ['rush', 'poke', 'spacing', 'defensive', 'retreat'];
const MOVES = ['punch', 'kick', 'dropkick', 'dash', 'block'];

/** Minimal .env reader — real environment variables win. */
function loadEnv() {
  const out = {};
  for (const file of [path.join(PROJECT, '.env'), path.join(APP, '.env')]) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (val.length >= 2 && val[0] === val.at(-1) && (val[0] === '"' || val[0] === "'")) {
        val = val.slice(1, -1);
      }
      if (key && out[key] === undefined) out[key] = val;
    }
  }
  return out;
}

function blankBucket() {
  return {
    calls: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    unpriced_calls: 0,
  };
}

export class AzureBrain {
  constructor({ minIntervalMs = 2500 } = {}) {
    const env = loadEnv();
    const pick = (name, fallback) =>
      (process.env[name] ?? env[name] ?? fallback ?? '').toString().trim();

    this.apiKey = pick('AZURE_OPENAI_API_KEY');
    this.endpoint = pick('AZURE_OPENAI_ENDPOINT', DEFAULT_ENDPOINT);
    this.model = pick('AZURE_OPENAI_MODEL', DEFAULT_MODEL);
    this.minIntervalMs = minIntervalMs;
    this.authStyle = 'api-key';

    this.inFlight = false;
    this.nextAllowedAt = 0;
    this.totals = { ...blankBucket(), priced: false };
  }

  status() {
    return {
      configured: Boolean(this.apiKey),
      model: this.model,
      endpoint: this.endpoint,
      reason: this.apiKey
        ? ''
        : 'No AZURE_OPENAI_API_KEY — the opponent runs on local tactics only.',
    };
  }

  /** Returns a tactic object, or null if unavailable/throttled/failed. */
  async requestTactic(snapshot) {
    if (!this.apiKey || this.inFlight || Date.now() < this.nextAllowedAt) return null;

    this.inFlight = true;
    this.nextAllowedAt = Date.now() + this.minIntervalMs;

    const body = {
      model: this.model,
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(snapshot) },
      ],
      max_output_tokens: 400,
    };

    try {
      let data = await this.#post(body);
      if (data === 'retry-auth') {
        this.authStyle = 'bearer';
        data = await this.#post(body);
      }
      if (!data || typeof data !== 'object') return null;

      await this.#recordUsage(data.usage, data.model || this.model);
      return this.#parseTactic(extractText(data));
    } catch (err) {
      console.warn('[AzureBrain]', err.message);
      return null;
    } finally {
      this.inFlight = false;
    }
  }

  async #post(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.authStyle === 'api-key') headers['api-key'] = this.apiKey;
      else headers.Authorization = `Bearer ${this.apiKey}`;

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if ((res.status === 401 || res.status === 403) && this.authStyle === 'api-key') {
        return 'retry-auth';
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  #parseTactic(reply) {
    if (!reply) return null;
    let body = reply.trim();
    if (body.startsWith('```')) {
      body = body.slice(body.indexOf('\n') + 1);
      const fence = body.lastIndexOf('```');
      if (fence !== -1) body = body.slice(0, fence);
      body = body.trim();
    }
    if (!body.startsWith('{')) {
      const a = body.indexOf('{');
      const b = body.lastIndexOf('}');
      if (a === -1 || b <= a) return null;
      body = body.slice(a, b + 1);
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const stance = String(parsed.stance ?? 'poke').toLowerCase();
    const preferred = String(parsed.preferred ?? 'punch').toLowerCase();
    const aggression = Number(parsed.aggression);

    return {
      stance: STANCES.includes(stance) ? stance : 'poke',
      preferred: MOVES.includes(preferred) ? preferred : 'punch',
      aggression: Number.isFinite(aggression) ? Math.min(Math.max(aggression, 0), 1) : 0.5,
      taunt: String(parsed.taunt ?? '').slice(0, 80),
    };
  }

  async #priceFor(model) {
    try {
      const table = JSON.parse(await readFile(PRICING, 'utf8'));
      const models = table.models ?? {};
      let entry = models[model];
      if (!entry) {
        for (const [name, val] of Object.entries(models)) {
          if (name && (model.startsWith(name) || model.includes(name))) { entry = val; break; }
        }
      }
      if (!entry || entry.input_per_1m == null || entry.output_per_1m == null) return null;
      return entry;
    } catch {
      return null;
    }
  }

  /** Fold one call into the shared ledger, under the command name "game". */
  async #recordUsage(raw, model) {
    if (!raw || typeof raw !== 'object') return;

    const input = Number(raw.input_tokens ?? raw.prompt_tokens ?? 0) || 0;
    const output = Number(raw.output_tokens ?? raw.completion_tokens ?? 0) || 0;
    const total = Number(raw.total_tokens ?? input + output) || 0;
    const cached = Number(raw.input_tokens_details?.cached_tokens ?? 0) || 0;
    const reasoning = Number(raw.output_tokens_details?.reasoning_tokens ?? 0) || 0;

    const price = await this.#priceFor(model);
    let cost = null;
    if (price) {
      const cachedRate = price.cached_input_per_1m ?? price.input_per_1m;
      cost =
        ((input - cached) * price.input_per_1m +
          cached * cachedRate +
          output * price.output_per_1m) / 1e6;
    }

    // In-memory copy the HUD reads.
    this.totals.calls += 1;
    this.totals.input_tokens += input;
    this.totals.cached_input_tokens += cached;
    this.totals.output_tokens += output;
    this.totals.reasoning_tokens += reasoning;
    this.totals.total_tokens += total;
    if (cost === null) this.totals.unpriced_calls += 1;
    else {
      this.totals.cost_usd += cost;
      this.totals.priced = true;
    }

    await this.#appendLedger({ model, input, output, total, cached, reasoning, cost });
  }

  async #appendLedger(rec) {
    let data;
    try {
      data = JSON.parse(await readFile(LEDGER, 'utf8'));
    } catch {
      data = { first_call: null, last_call: null, totals: blankBucket(), by_command: {}, by_model: {} };
    }
    data.totals ??= blankBucket();
    data.by_command ??= {};
    data.by_model ??= {};

    const at = new Date().toISOString().replace(/\.\d+Z$/, '+00:00');
    data.first_call ??= at;
    data.last_call = at;

    const add = (bucket) => {
      bucket.calls += 1;
      bucket.input_tokens += rec.input;
      bucket.cached_input_tokens += rec.cached;
      bucket.output_tokens += rec.output;
      bucket.reasoning_tokens += rec.reasoning;
      bucket.total_tokens += rec.total;
      if (rec.cost === null) bucket.unpriced_calls += 1;
      else bucket.cost_usd = Number((bucket.cost_usd + rec.cost).toFixed(6));
    };

    data.by_command.game ??= blankBucket();
    data.by_model[rec.model] ??= blankBucket();
    add(data.totals);
    add(data.by_command.game);
    add(data.by_model[rec.model]);

    try {
      await mkdir(AUTOMATION, { recursive: true });
      await writeFile(LEDGER, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    } catch (err) {
      console.warn('[AzureBrain] could not write the ledger:', err.message);
    }
  }
}

/** Pull assistant text out of a Responses API payload. */
function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const parts = [];
  for (const item of data.output ?? []) {
    if (!item || typeof item !== 'object') continue;
    const content = item.content;
    if (typeof content === 'string') { parts.push(content); continue; }
    if (!Array.isArray(content)) continue;
    for (const chunk of content) {
      if (chunk?.type === 'output_text' || chunk?.type === 'text') parts.push(chunk.text ?? '');
    }
  }
  return parts.join('\n');
}
