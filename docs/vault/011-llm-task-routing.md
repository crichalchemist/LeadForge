# ADR-011: LLM task routing: vLLM for volume, Claude for nuance

**Status:** Accepted
**Date:** 2026-03-14

## Context

LeadForge uses two LLM providers — a self-hosted vLLM instance (Qwen2.5-7B) and Claude API (Sonnet). We need to decide which tasks should be routed to which provider to optimize for both cost and quality.

The vLLM instance runs locally on our infrastructure, making it essentially free after the initial GPU cost, but with potentially lower quality for complex reasoning tasks. Claude API provides higher quality outputs, especially for nuanced judgment and creative writing, but at significant cost per request.

We need to process thousands of leads through various LLM-dependent tasks including entity resolution, website data extraction, revenue estimation, data normalization, GBP completeness assessment, outreach brief generation, and call transcript sentiment analysis.

## Decision

We will route LLM tasks based on volume and complexity:

**vLLM (local, fast, cheap):**
- Entity resolution
- Website data extraction
- Revenue estimation
- Data normalization

**Claude API (expensive, high quality):**
- GBP completeness assessment
- Outreach brief generation
- Call transcript sentiment analysis

**Rationale:** vLLM handles high-volume structured extraction tasks where speed and cost matter most. Claude handles tasks requiring nuanced judgment (sentiment), quality writing (persuasive briefs), and complex assessment (GBP completeness scoring).

## Consequences

### Positive
- Cost-effective architecture — vLLM calls are free after GPU cost, Claude only used for approximately 3 calls per lead
- Can scale vLLM horizontally without API cost concerns
- Higher quality outputs for customer-facing content (briefs) and critical judgment tasks (sentiment)

### Negative
- vLLM quality may be lower for complex reasoning tasks, requiring careful prompt engineering
- Two LLM integrations to maintain, each with different APIs and failure modes
- Need to carefully monitor quality thresholds to know when vLLM is underperforming

## Alternatives Considered

- **All Claude:** Too expensive at scale — 10,000 leads × 7 LLM tasks × $0.003 per call = $210 per batch vs ~$9 with hybrid approach
- **All vLLM:** Quality too low for briefs and sentiment — testing showed Qwen2.5-7B produces generic, unconvincing outreach briefs
- **GPT-4o:** Higher API costs than Claude Sonnet ($0.005 vs $0.003 per call) with comparable quality
