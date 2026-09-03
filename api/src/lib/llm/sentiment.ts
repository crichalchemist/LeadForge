// =py llm/sentiment
import { stripFences, type LlmClient } from './client';

export interface SentimentResult {
  sentiment_score: number;
  sentiment_label: string;
  objections: string[];
  interest_signals: string[];
  purchase_intent: string;
  recommended_action: string;
  summary: string;
}

const SENTIMENT_PROMPT = (transcript: string) => `Analyze this call transcript between a marketing agent and a small business owner.

Transcript:
${transcript}

Analyze and respond with ONLY a JSON object:
{
    "sentiment_score": -1.0 to 1.0 (hostile=-1, dismissive=-0.5, neutral=0, curious=0.3, interested=0.6, enthusiastic=1.0),
    "sentiment_label": "hostile|dismissive|neutral|curious|interested|enthusiastic",
    "objections": ["list of objections raised"],
    "interest_signals": ["list of positive signals"],
    "purchase_intent": "none|low|medium|high",
    "recommended_action": "immediate|scheduled|deprioritize|disqualify",
    "summary": "1-2 sentence summary of the call outcome"
}
`;

// =py analyze_sentiment; the score is clamped to [-1, 1] because ADR 014 multiplies it into the composite
export async function analyzeSentiment(transcript: string, client: LlmClient): Promise<SentimentResult> {
  if (!transcript || !transcript.trim()) return emptySentiment();
  const response = await client.complete(SENTIMENT_PROMPT(transcript.slice(0, 8000)), { maxTokens: 500, temperature: 0.1 });
  if (!response) return emptySentiment();
  try {
    const result = JSON.parse(stripFences(response)) as SentimentResult;
    const score = Number(result.sentiment_score ?? 0);
    result.sentiment_score = Math.max(-1, Math.min(1, score));
    return result;
  } catch (error) {
    console.warn('sentiment_analysis_failed', error instanceof Error ? error.message : String(error));
    return emptySentiment();
  }
}

// =py _empty_sentiment
function emptySentiment(): SentimentResult {
  return {
    sentiment_score: 0,
    sentiment_label: 'neutral',
    objections: [],
    interest_signals: [],
    purchase_intent: 'none',
    recommended_action: 'deprioritize',
    summary: 'Sentiment analysis unavailable',
  };
}
