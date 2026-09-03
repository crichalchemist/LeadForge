// =py llm/client.VLLMClient + llm/claude_client.ClaudeClient, both on Workers AI.
// ADR 011 routing carries over as two tiers: the fast model for volume work (entity
// resolution), the quality model for nuance (outreach briefs, sentiment).

export const FAST_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
export const QUALITY_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
type TextModel = typeof FAST_MODEL | typeof QUALITY_MODEL;

export interface CompleteOptions { maxTokens?: number; temperature?: number }

export interface LlmClient {
  // Resolves to null on any failure, as the Python clients do, so callers can fall back.
  complete(prompt: string, options?: CompleteOptions): Promise<string | null>;
}

function workersAiClient(ai: Ai, model: TextModel, defaults: Required<CompleteOptions>): LlmClient {
  return {
    async complete(prompt, options = {}) {
      try {
        const out = (await ai.run(model, {
          messages: [{ role: 'user', content: prompt }],
          max_tokens: options.maxTokens ?? defaults.maxTokens,
          temperature: options.temperature ?? defaults.temperature,
        })) as AiTextGenerationOutput;
        return out.response || null;
      } catch (error) {
        console.warn('llm_completion_failed', model, error instanceof Error ? error.message : String(error));
        return null;
      }
    },
  };
}

// =py VLLMClient defaults (max_tokens=500, temperature=0.1)
export function fastClient(ai: Ai): LlmClient {
  return workersAiClient(ai, FAST_MODEL, { maxTokens: 500, temperature: 0.1 });
}

// =py ClaudeClient defaults (max_tokens=1000, temperature=0.3)
export function qualityClient(ai: Ai): LlmClient {
  return workersAiClient(ai, QUALITY_MODEL, { maxTokens: 1000, temperature: 0.3 });
}

const FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/;

// =py _strip_fences (duplicated per module in Python; shared here)
export function stripFences(text: string): string {
  const m = FENCE_RE.exec(text);
  return m ? m[1].trim() : text.trim();
}
