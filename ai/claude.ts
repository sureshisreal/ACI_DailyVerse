import Anthropic from '@anthropic-ai/sdk';
import http from 'node:http';
import https from 'node:https';

// Cheapest current model ($1 / $5 per MTok). Override with CLAUDE_MODEL (e.g. claude-sonnet-5-5,
// claude-opus-5-5, claude-fable-5-1) for higher quality at higher cost.
const DEFAULT_MODEL = 'claude-haiku-4-5';

// Request shape differs by model family:
// - Haiku 4.5: no effort parameter (it errors) and no server-side refusal fallbacks; thinking can be
//   switched off outright, which these direct creative-writing / structured-output calls don't need.
// - Fable 5.1 / Opus 5.5 and other current models: always think - `thinking: {type: 'disabled'}` is
//   rejected with a 400 - so depth is set through effort instead ('low' keeps latency and cost close
//   to the no-thinking path; override via CLAUDE_EFFORT), with refusal fallbacks enabled.
const DEFAULT_EFFORT = 'low';
// Thinking tokens count against max_tokens. Callers size maxTokens for the visible answer only, so
// thinking models get this much on top - otherwise a long think could hit stop_reason "max_tokens"
// with the answer cut off or missing entirely.
const THINKING_HEADROOM_TOKENS = 4000;

function isHaiku(model: string): boolean {
  return model.startsWith('claude-haiku');
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  if (!client) {
    // A stalled connection has been observed hanging indefinitely with no default timeout - fail
    // fast instead so a bad network call surfaces as an error, not a silent hang. maxRetries: 0
    // because callers here (e.g. ai/contentPackage.ts) already have their own retry loops - the
    // SDK's default of 2 retries-with-backoff would silently triple the wait on every slow/timed-out
    // request before our own retry logic even sees the failure, which read as a hang in testing.
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 180_000, maxRetries: 0 });
  }
  return client;
}

// --- Provider selection ---------------------------------------------------------------------------
// Calls go down a chain of providers; one that is unusable (no key, no credits, rate-limited, down)
// is skipped and the next is tried, and a provider that failed that way is skipped for
// PROVIDER_COOLDOWN_MINUTES so every call doesn't first pay for a failing round trip.
//   'anthropic' - Claude (ANTHROPIC_API_KEY).
//   'gemini'    - Google Gemini via its OpenAI-compatible API (GEMINI_API_KEY, free tier at
//                 https://aistudio.google.com/apikey). Strong Tamil/Telugu + image input. Seconds.
//   'groq'      - Groq's OpenAI-compatible API (GROQ_API_KEY, free tier at https://console.groq.com/keys).
//                 Very fast open-weight models. Seconds.
//   'ollama'    - a local open-weight model via Ollama - free and private, but minutes per call on a
//                 CPU-only host (e.g. Codespaces), so it is the last resort.
// LLM_PROVIDER: 'auto' (default) = anthropic -> gemini -> groq -> ollama, skipping cloud providers
// without a key; or one provider name to use only that one; or a comma list for a custom order
// (e.g. "gemini,groq,ollama").
type ProviderName = 'anthropic' | 'gemini' | 'groq' | 'ollama';
const ALL_PROVIDERS: ProviderName[] = ['anthropic', 'gemini', 'groq', 'ollama'];
const OLLAMA_DEFAULT_MODEL = 'gemma3:12b';
// Gemini models tried in order. Individual free-tier models are often briefly overloaded (503) or
// hang, and dated IDs get retired (404), so one that fails that way is skipped for a few minutes and
// the next is tried; the rolling "-latest" alias is the final catch-all. Override with GEMINI_MODEL
// (one ID or a comma list).
const GEMINI_DEFAULT_MODELS = 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-flash-latest,gemini-flash-lite-latest';
const MODEL_COOLDOWN_MINUTES = 3;
const modelCooldownUntil: Record<string, number> = {};
// Preferred Groq model: in testing it used correct Christian Tamil/Telugu terms (கர்த்தர், దేవుడు)
// where qwen3.8 did not. Text-only - image calls get a 400 and move on to the next provider.
// If it isn't live, another is picked from /models.
const GROQ_PREFERRED_MODEL = 'openai/gpt-oss-120b';
// Short: the usual cause is a brief overload spike or a per-minute rate limit, not an outage.
const PROVIDER_COOLDOWN_MINUTES = 3;
const cooldownUntil: Partial<Record<ProviderName, number>> = {};

function getProviderChain(): ProviderName[] {
  const raw = (process.env.LLM_PROVIDER || 'auto').toLowerCase().trim();
  if (raw !== 'auto') {
    const named = raw.split(',').map((s) => s.trim()).filter((s): s is ProviderName => (ALL_PROVIDERS as string[]).includes(s));
    if (named.length) return named;
  }
  // Auto: skip cloud providers with no key. Claude stays in even without a key when it is the only
  // option, so its "ANTHROPIC_API_KEY is not set" error is what gets reported.
  return ALL_PROVIDERS.filter((p) =>
    p === 'anthropic' ? true
      : p === 'gemini' ? !!process.env.GEMINI_API_KEY
        : p === 'groq' ? !!process.env.GROQ_API_KEY
          : true);
}

// Failure that won't resolve by retrying the same provider right away - move to the next one.
// `cooldown: false` means skip it for this call only (e.g. a 400 that may be specific to this
// request, such as an image sent to a text-only model).
class ProviderUnavailable extends Error {
  constructor(message: string, readonly cooldown = true) { super(message); }
}

function isClaudeUnavailable(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    const message = String(err.message || '').toLowerCase();
    return err.status === 401 || err.status === 403 || err.status === 429 || err.status === 529
      || (err.status === 400 && (message.includes('credit balance') || message.includes('billing')));
  }
  return err instanceof Error && err.message === 'ANTHROPIC_API_KEY is not set';
}

interface ModelCall {
  systemPrompt: string;
  userText: string;
  image?: { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' };
  maxTokens: number;
  model?: string;
  json: boolean;
}

async function callProvider(provider: ProviderName, call: ModelCall): Promise<string> {
  switch (provider) {
    case 'anthropic': {
      const content: string | Anthropic.MessageParam['content'] = call.image
        ? [
          { type: 'image', source: { type: 'base64', media_type: call.image.mediaType, data: call.image.base64 } },
          { type: 'text', text: call.userText },
        ]
        : call.userText;
      try {
        return await callClaudeWithContent(call.systemPrompt, content, call.maxTokens, call.model);
      } catch (err) {
        if (isClaudeUnavailable(err)) throw new ProviderUnavailable(err instanceof Error ? err.message : String(err));
        throw err;
      }
    }
    case 'gemini':
      return tryModels('Gemini', (process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODELS).split(','), (model) => callOpenAICompatible(call, {
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: process.env.GEMINI_API_KEY,
        model,
      }));
    case 'groq':
      return tryModels('Groq', process.env.GROQ_MODEL ? process.env.GROQ_MODEL.split(',') : await pickGroqModels(), (model) => callOpenAICompatible(call, {
        name: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY,
        model,
      }));
    case 'ollama':
      return callOllama(call);
  }
}

// Tries a provider's models in order. Free tiers fail per model - Gemini models are briefly
// overloaded (503) or hang, Groq rate-limits each model separately (429) - so a model that fails
// that way is skipped for MODEL_COOLDOWN_MINUTES and the next is tried before giving up on the
// provider.
async function tryModels(name: string, modelList: string[], attempt: (model: string) => Promise<string>): Promise<string> {
  const models = modelList.map((m) => m.trim()).filter(Boolean);
  const key = (m: string) => `${name}:${m}`;
  const ready = models.filter((m) => (modelCooldownUntil[key(m)] || 0) <= Date.now());
  let lastErr: unknown;
  for (const model of ready.length ? ready : models) {
    try {
      return await attempt(model);
    } catch (err) {
      // A bad/missing key fails every model the same way - stop and let the chain move on.
      if (!(err instanceof ProviderUnavailable) || /api.key/i.test(err.message)) throw err;
      lastErr = err;
      if (err.cooldown) modelCooldownUntil[key(model)] = Date.now() + MODEL_COOLDOWN_MINUTES * 60_000;
      console.warn(`[llm] ${name} ${model} failed (${err.message.slice(0, 120)}); trying next ${name} model.`);
    }
  }
  throw lastErr;
}

async function callModel(call: ModelCall): Promise<string> {
  const chain = getProviderChain();
  const now = Date.now();
  // Providers not cooling down, in order; if every one is cooling down, try them all anyway rather
  // than fail without a single attempt.
  const ready = chain.filter((p) => (cooldownUntil[p] || 0) <= now);
  const order = ready.length ? ready : chain;
  let lastErr: unknown;
  for (let i = 0; i < order.length; i++) {
    const provider = order[i];
    try {
      return await callProvider(provider, call);
    } catch (err) {
      const isLast = i === order.length - 1;
      if (!(err instanceof ProviderUnavailable) || isLast) throw err;
      lastErr = err;
      if (err.cooldown) cooldownUntil[provider] = Date.now() + PROVIDER_COOLDOWN_MINUTES * 60_000;
      console.warn(`[llm] ${provider} unavailable (${err.message.slice(0, 160)}); trying ${order[i + 1]}${err.cooldown ? ` (skipping ${provider} for ${PROVIDER_COOLDOWN_MINUTES} min)` : ''}.`);
    }
  }
  throw lastErr;
}

// OpenAI-style /chat/completions, used for Gemini and Groq. Both are fast hosted APIs, so plain fetch
// with a short timeout is fine (unlike Ollama, below).
async function callOpenAICompatible(
  call: ModelCall,
  cfg: { name: string; baseUrl: string; apiKey?: string; model: string }
): Promise<string> {
  if (!cfg.apiKey) throw new ProviderUnavailable(`${cfg.name} API key is not set`);
  const timeoutMs = Number(process.env.CLOUD_LLM_TIMEOUT_MS) || 60_000; // a hung free-tier model sends no bytes at all - move on
  // Groq's JSON mode requires the word "JSON" in the messages; this also keeps both models terse.
  const system = call.json ? `${call.systemPrompt}\n\nRespond with a single valid JSON object only.` : call.systemPrompt;
  const userContent = call.image
    ? [
      { type: 'text', text: call.userText },
      { type: 'image_url', image_url: { url: `data:${call.image.mediaType};base64,${call.image.base64}` } },
    ]
    : call.userText;
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
        // Indic scripts tokenize longer on these models than on Claude, and Gemini's thinking tokens
        // count against this budget - so give generous headroom over the Claude-sized limit.
        max_tokens: call.maxTokens * 2 + 4000,
        temperature: 0.7,
        ...(call.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    throw new ProviderUnavailable(`${cfg.name} unreachable or timed out: ${err?.message || err}`);
  }
  const bodyText = await res.text();
  if (!res.ok) {
    const msg = `${cfg.name} (${cfg.model}) returned ${res.status}: ${bodyText.slice(0, 200)}`;
    // 400 is often request-specific (e.g. image sent to a text-only model): skip for this call only.
    // Gemini reports a bad key as 400 too - that one does deserve the cooldown.
    if (res.status === 400) throw new ProviderUnavailable(msg, /api.key/i.test(bodyText));
    if (res.status === 404 && cfg.name === 'Groq') groqModels = null; // model retired - re-list next time
    throw new ProviderUnavailable(msg);
  }
  let data: any;
  try { data = JSON.parse(bodyText); } catch { throw new ProviderUnavailable(`${cfg.name} returned non-JSON: ${bodyText.slice(0, 200)}`, false); }
  const choice = data?.choices?.[0];
  const text = String(choice?.message?.content ?? '').trim();
  if (choice?.finish_reason === 'length') throw new Error(`${cfg.name} (${cfg.model}) response was truncated (hit its output limit before finishing)`);
  if (!text) throw new ProviderUnavailable(`${cfg.name} (${cfg.model}) returned no text (finish_reason: ${choice?.finish_reason})`, false);
  return text;
}

// Groq retires models often, so rather than hard-code a list, take the live general chat models the
// account can see, preferred ones first (gpt-oss-120b used correct Christian Tamil/Telugu terms in
// testing; gpt-oss-20b is the closest smaller sibling). Several, not one: Groq's free-tier rate
// limits are per model. Cached for the process.
const GROQ_MODEL_PREFERENCE = [GROQ_PREFERRED_MODEL, 'openai/gpt-oss-20b'];
let groqModels: string[] | null = null;
async function pickGroqModels(): Promise<string[]> {
  if (groqModels) return groqModels;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [GROQ_PREFERRED_MODEL];
    const ids: string[] = ((await res.json())?.data || []).filter((m: any) => m?.active !== false).map((m: any) => String(m.id));
    const general = ids.filter((id) => /gpt-oss|llama|qwen|kimi/i.test(id) && !/guard|safeguard|whisper|tts|prompt|orpheus/i.test(id));
    groqModels = [...GROQ_MODEL_PREFERENCE.filter((m) => general.includes(m)), ...general.filter((m) => !GROQ_MODEL_PREFERENCE.includes(m))];
    if (!groqModels.length) groqModels = [GROQ_PREFERRED_MODEL];
    console.log(`[llm] Groq models: ${groqModels.join(', ')}`);
    return groqModels;
  } catch {
    return [GROQ_PREFERRED_MODEL];
  }
}

// Ollama's native chat API. Open-weight tokenizers split Tamil/Telugu into far more tokens than
// Claude's, so the output budget is scaled up rather than reusing Claude-sized limits (a budget
// sized for Claude would truncate Indic-script answers). JSON calls use Ollama's JSON mode, which
// constrains output to valid JSON.
async function callOllama(call: ModelCall): Promise<string> {
  const baseUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL || OLLAMA_DEFAULT_MODEL;
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || 600_000;
  const payload = JSON.stringify({
    model,
    stream: true,
    ...(call.json ? { format: 'json' } : {}),
    messages: [
      { role: 'system', content: call.systemPrompt },
      { role: 'user', content: call.userText, ...(call.image ? { images: [call.image.base64] } : {}) },
    ],
    options: { num_predict: Math.max(1024, call.maxTokens * 3), num_ctx: 16384, temperature: 0.7 },
  });

  // node:http rather than fetch: fetch (undici) aborts if no response headers arrive within 5 minutes,
  // and Ollama sends none until a request actually starts generating. On CPU-only hosts (e.g.
  // Codespaces) Ollama runs one request at a time, so a request queued behind others - or a long
  // prompt's prefill - easily waits past that and was cut off ("client closing the connection").
  // Here only OLLAMA_TIMEOUT_MS bounds the call. Streamed (NDJSON) so long answers arrive piecewise.
  const url = new URL('/api/chat', baseUrl);
  const transport = url.protocol === 'https:' ? https : http;
  const { text, doneReason } = await new Promise<{ text: string; doneReason?: string }>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => { if (!settled) { settled = true; clearTimeout(timer); req.destroy(); reject(err); } };
    const timer = setTimeout(
      () => fail(new Error(`Local model (${model}) timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs
    );
    const req = transport.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      res.setEncoding('utf8');
      if ((res.statusCode || 0) >= 400) {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => fail(new Error(`Ollama returned ${res.statusCode}${res.statusCode === 404 ? ` (model not installed - run: ollama pull ${model})` : ''}: ${body.slice(0, 200)}`)));
        return;
      }
      // One {"message":{"content":"..."},"done":false} object per line, then {"done":true,"done_reason":...}.
      let acc = '';
      let reason: string | undefined;
      let buffer = '';
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const chunk = JSON.parse(line);
        if (chunk.error) throw new Error(`Ollama error: ${String(chunk.error).slice(0, 200)}`);
        acc += chunk?.message?.content ?? '';
        if (chunk.done) reason = chunk.done_reason;
      };
      res.on('data', (c: string) => {
        buffer += c;
        let nl: number;
        try {
          while ((nl = buffer.indexOf('\n')) !== -1) { handleLine(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
        } catch (err: any) { fail(err); }
      });
      res.on('end', () => {
        if (settled) return;
        try { handleLine(buffer); } catch (err: any) { return fail(err); }
        settled = true;
        clearTimeout(timer);
        resolve({ text: acc, doneReason: reason });
      });
      res.on('error', (err) => fail(err));
    });
    req.on('error', (err) => fail(new Error(`Could not reach Ollama at ${baseUrl} - is it running? (${err.message})`)));
    req.end(payload);
  });

  const trimmed = text.trim();
  if (!trimmed) throw new Error(`Local model (${model}) returned no text`);
  if (doneReason === 'length') {
    throw new Error(`Local model (${model}) response was truncated (hit its output limit before finishing)`);
  }
  return trimmed;
}

async function callClaudeWithContent(
  systemPrompt: string,
  content: string | Anthropic.MessageParam['content'],
  maxTokens: number,
  model?: string
): Promise<string> {
  const anthropic = getClient();
  const resolvedModel = model || process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const base = { model: resolvedModel, system: systemPrompt, messages: [{ role: 'user' as const, content }] };
  const response = (isHaiku(resolvedModel)
    ? await anthropic.messages.create({
      ...base,
      max_tokens: maxTokens,
      // `as any`: the installed SDK version predates typed support for this field; the API accepts it.
      thinking: { type: 'disabled' }
    } as any)
    : await anthropic.messages.create({
      ...base,
      max_tokens: maxTokens + THINKING_HEADROOM_TOKENS,
      output_config: { effort: process.env.CLAUDE_EFFORT || DEFAULT_EFFORT },
      // On a safety-classifier decline (stop_reason "refusal"), the API re-runs the same request on
      // a fallback model inside the same call instead of just stopping.
      fallbacks: 'default'
      // `as any`: the installed SDK version predates typed support for output_config / fallbacks,
      // but the API accepts them - the SDK passes the params object through to the request body.
    } as any, { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } })) as Anthropic.Message;

  // String cast: the installed SDK's StopReason type predates "refusal".
  if ((response.stop_reason as string) === 'refusal') {
    throw new Error('Claude declined the request (stop_reason "refusal")');
  }
  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
  if (!textBlock) {
    throw new Error('Claude response contained no text content');
  }
  if (response.stop_reason === 'max_tokens') {
    // A truncated response is not valid output regardless of how much text came back - silently
    // returning a cut-off answer (e.g. a script that stops mid-sentence) is worse than an error a
    // caller's retry loop can act on.
    throw new Error(`Claude response was truncated (hit max_tokens=${maxTokens} before finishing)`);
  }
  return textBlock.text.trim();
}

// Returns the raw text reply, unparsed - for prompts that ask Claude to use a delimiter format
// other than JSON (e.g. XML-style tags around free-form fields), which sidesteps JSON's
// quote-escaping/line-break requirements for long creative text where those have proven
// unreliable in practice (see ai/contentPackage.ts). Optional model override for callers that need a
// specific model instead of the default/CLAUDE_MODEL.
export async function askClaudeForText(systemPrompt: string, userPrompt: string, maxTokens = 300, model?: string): Promise<string> {
  return callModel({ systemPrompt, userText: userPrompt, maxTokens, model, json: false });
}

function parseJsonReply(text: string): any {
  // Defensive: strip a markdown code fence if the model wraps the JSON in one despite instructions.
  const raw = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    // One narrow repair attempt, not a general "fix broken JSON" fallback: a literal raw
    // newline/tab typed inside a string value (instead of the \n/\t JSON requires) is a real
    // failure mode seen with longer free-form fields (e.g. a multi-paragraph meditation script),
    // and is unambiguous to fix - only control characters actually inside a string literal (tracked
    // via a quote/escape state machine) get touched, so this can't corrupt otherwise-valid
    // structural JSON. If the repaired text still doesn't parse (e.g. an unescaped quote mark
    // instead), throw the ORIGINAL error - a second, different error would be confusing.
    try {
      return JSON.parse(repairControlCharsInStrings(raw));
    } catch {
      throw err;
    }
  }
}

// Sends one compact request and returns the parsed JSON reply. Low max_tokens and a terse
// system prompt keep this to a single small round trip per verse - no chain-of-thought, no
// explanation, no retries/re-prompting on the model's own initiative. Optional model override, same
// as askClaudeForText.
export async function askClaudeForJson(systemPrompt: string, userPrompt: string, maxTokens = 300, model?: string): Promise<any> {
  const text = await callModel({ systemPrompt, userText: userPrompt, maxTokens, model, json: true });
  return parseJsonReply(text);
}

// Same idea as askClaudeForJson, but the user turn is an image (Claude's vision input) plus a short
// text instruction, for prompts that ask Claude to look at something rather than just read text -
// see ai/backgroundReview.ts, which uses this to have Claude look at a generated background image
// before it's accepted for a poster.
export async function askClaudeVisionForJson(
  systemPrompt: string,
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
  userText: string,
  maxTokens = 300
): Promise<any> {
  const text = await callModel({ systemPrompt, userText, image: { base64: imageBase64, mediaType }, maxTokens, json: true });
  return parseJsonReply(text);
}

function repairControlCharsInStrings(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === '\\') {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += ch;
      }
    } else {
      out += ch;
      if (ch === '"') inString = true;
    }
  }
  return out;
}
