import Anthropic from '@anthropic-ai/sdk';

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
// LLM_PROVIDER picks where every call in this module goes:
//   'anthropic' - Claude only.
//   'ollama'    - a local open-weight model via Ollama (https://ollama.com) only - free, no API
//                 account, nothing leaves the machine.
//   'auto' (default) - Claude first; on a billing/auth failure (e.g. "credit balance is too low"),
//                 a missing key, or Claude being unreachable, fall back to Ollama, and keep using
//                 Ollama for OLLAMA_FALLBACK_MINUTES so every call doesn't first pay for a failing
//                 Claude round trip.
// OLLAMA_MODEL must support images for the vision calls (background review, poster design) and
// should handle Tamil/Telugu - Gemma 3 does both. OLLAMA_URL defaults to the local Ollama server.
type Provider = 'anthropic' | 'ollama' | 'auto';
const OLLAMA_DEFAULT_MODEL = 'gemma3:12b';
const OLLAMA_FALLBACK_MINUTES = 10;
let ollamaUntil = 0;

function getProvider(): Provider {
  const p = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  return p === 'anthropic' || p === 'ollama' ? p : 'auto';
}

// Failures that won't resolve by retrying Claude right away - the cue for 'auto' to switch to Ollama.
function isClaudeUnavailable(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    const message = String(err.message || '').toLowerCase();
    return err.status === 401 || err.status === 403 || (err.status === 400 && (message.includes('credit balance') || message.includes('billing')));
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

async function callModel(call: ModelCall): Promise<string> {
  const provider = getProvider();
  if (provider === 'ollama' || (provider === 'auto' && Date.now() < ollamaUntil)) return callOllama(call);
  try {
    const content: string | Anthropic.MessageParam['content'] = call.image
      ? [
        { type: 'image', source: { type: 'base64', media_type: call.image.mediaType, data: call.image.base64 } },
        { type: 'text', text: call.userText },
      ]
      : call.userText;
    return await callClaudeWithContent(call.systemPrompt, content, call.maxTokens, call.model);
  } catch (err) {
    if (provider !== 'auto' || !isClaudeUnavailable(err)) throw err;
    console.warn(`[llm] Claude unavailable (${err instanceof Error ? err.message.slice(0, 160) : err}); using local Ollama model for the next ${OLLAMA_FALLBACK_MINUTES} minutes.`);
    ollamaUntil = Date.now() + OLLAMA_FALLBACK_MINUTES * 60_000;
    return callOllama(call);
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        ...(call.json ? { format: 'json' } : {}),
        messages: [
          { role: 'system', content: call.systemPrompt },
          { role: 'user', content: call.userText, ...(call.image ? { images: [call.image.base64] } : {}) },
        ],
        options: { num_predict: Math.max(1024, call.maxTokens * 3), num_ctx: 16384, temperature: 0.7 },
      }),
    });
  } catch (err: any) {
    throw new Error(err?.name === 'AbortError'
      ? `Local model (${model}) timed out after ${Math.round(timeoutMs / 1000)}s`
      : `Could not reach Ollama at ${baseUrl} - is it running? (${err?.message || err})`);
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama returned ${res.status}${res.status === 404 ? ` (model not installed - run: ollama pull ${model})` : ''}: ${body.slice(0, 200)}`);
  }
  const data: any = await res.json();
  const text = String(data?.message?.content ?? '').trim();
  if (!text) throw new Error(`Local model (${model}) returned no text`);
  if (data?.done_reason === 'length') {
    throw new Error(`Local model (${model}) response was truncated (hit its output limit before finishing)`);
  }
  return text;
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
