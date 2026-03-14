# ADR-008: vLLM model selection: based on VRAM, Qwen2.5-7B default

## Status

Accepted

## Date

2026-03-14

## Context

Phase 2 and Phase 3 require local LLM capability for:
- Entity resolution (matching duplicates across sources)
- Data extraction (structured field extraction from unstructured text)
- Lead qualification signals

Using a local LLM avoids API costs at volume and keeps sensitive business data on-premises. However, must balance:
- Model quality (how well it performs NER, entity matching, extraction)
- VRAM requirements (consumer GPU constraints: 8GB typical, 16GB high-end)
- Inference throughput (how many requests/sec can be processed)
- Latency (response time critical for user-facing queries in Phase 4)

Ollama is simpler but offers less control. Cloud LLMs (OpenAI, Anthropic) are cost-prohibitive at scale. Fine-tuned models require significant data and time.

## Decision

Default to **Qwen2.5-7B-Instruct** via vLLM with OpenAI-compatible API. This model:
- Runs comfortably on consumer GPUs (8GB VRAM, optimally 16GB)
- Supports JSON mode for structured outputs (entity resolution, extraction)
- Strong performance on entity matching and NER tasks
- Can be swapped for larger models (Qwen2.5-14B, Llama-3.1-8B) if hardware allows

Implementation:
- Use vLLM as inference engine
- Expose OpenAI-compatible API endpoint (`/v1/chat/completions`)
- Configure JSON mode and temperature for deterministic entity matching
- Support provider swapping via Settings (vLLM, Ollama, OpenAI with fallback)
- Structured prompting for entity resolution and data extraction tasks

## Consequences

### Positive
- Runs on common consumer GPUs (8GB+, 16GB optimal)
- Excellent entity resolution quality for name and address matching
- OpenAI-compatible interface allows easy provider switching
- JSON mode guarantees structured outputs for programmatic use
- No API costs, data stays on-premises
- Throughput scales with hardware; can run multiple workers

### Negative
- Requires GPU hardware (can't run on CPU efficiently)
- Model quality may not match best cloud LLMs for complex reasoning
- Requires vLLM deployment and management overhead
- VRAM becomes bottleneck under high concurrency
- Model updates/versioning must be managed locally

### Neutral
- Entity resolution accuracy adequate but not perfect (fuzzy matching still needed as fallback)
- Inference latency ~200-500ms depending on input length and hardware

## Alternatives Considered

### 1. Ollama
**Description**: Use Ollama as inference engine for ease of local model management
**Why rejected**: Less control over throughput, no JSON mode support in v1, smaller model ecosystem
**Trade-offs**: Much easier setup/management but less flexibility for production workloads

### 2. Cloud-Only LLM (OpenAI, Anthropic, Groq)
**Description**: Call external LLM APIs for all entity resolution and extraction
**Why rejected**: Cost at volume (10k+ businesses × multiple enrichment calls = significant burn)
**Trade-offs**: Best-in-class quality but unacceptable cost structure; only viable for final user-facing scoring

### 3. Regex and Fuzzy Matching Only (No LLM)
**Description**: Use FuzzyWuzzy, Levenshtein, and rule-based NER for entity matching
**Why rejected**: Too brittle and maintenance-heavy; misses semantic relationships
**Trade-offs**: No infra cost but poor accuracy for messy real-world data (common in local business data)
