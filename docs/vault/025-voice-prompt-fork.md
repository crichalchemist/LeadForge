# ADR-025: Voice prompt fork: dynamic NOF vs marketing pitch based on eligibility

## Status

Accepted

## Date

2026-03-14

## Context

The same Retell AI voice infrastructure (ADR-013) serves both acquisition channels: marketing outreach and NOF grant facilitation. However, the pitch angles and talking points are completely different:

- **Marketing pitch**: "You don't have a strong web presence. We help small businesses get online and attract customers."
- **NOF grant pitch**: "You may qualify for up to $250K in City of Chicago renovation funding. We help eligible businesses apply for this grant."

These pitches require different objection handling, different talking points, different call goals, and different follow-up workflows. Using the same agent prompt for both would force awkward pivots ("about that website... actually, you might qualify for a grant") and confuse both business owners and call handlers reviewing recordings.

The Retell agent system (ADR-013) is already built to support prompt customization. Extended prompts can be passed at call initialization time. The challenge is determining which prompt template to use and ensuring consistency between voice calls and the backend outreach brief.

## Decision

Extend the `build_agent_prompt(business: Business, enriched_data: dict, **kwargs) -> str` function in `src/leadforge/tasks/voice.py` to accept an optional `nof_context: dict` parameter. When provided, uses the `NOF_VOICE_AGENT_SYSTEM_PROMPT` template instead of the default `VOICE_AGENT_SYSTEM_PROMPT`.

Define two system prompts in config or as constants:

```python
VOICE_AGENT_SYSTEM_PROMPT = """
You are an AI assistant calling small business owners to discuss website and digital marketing.
[Original prompt content]
"""

NOF_VOICE_AGENT_SYSTEM_PROMPT = """
You are an AI assistant calling small business owners on behalf of the City of Chicago to discuss the Neighborhood Opportunity Fund (NOF) grant.
Your goal is to determine eligibility and help the owner apply for up to $250K in renovation funding.
Key talking points: [grant details], [corridor/neighborhood benefit], [renovation examples]
[Grant-specific objection handling, timeline, next steps]
"""
```

Extend `generate_outreach_brief(business: Business, ..., nof_eligible: bool = False) -> str` to produce grant-focused Claude prompts when `nof_eligible=True`. The Claude brief will instruct the model to generate talking points aligned with grant (e.g., "focus on renovation potential, not website deficiency").

Extend Retell call initialization (in `CallManager.initiate_call()` or similar) to check business `nof_eligibility_score >= NOF_ELIGIBILITY_THRESHOLD`. If true, pass `nof_context={"grant_amount": ..., "corridor": ...}` to `build_agent_prompt()`. Fallback briefs are also forked based on eligibility.

All changes are backward-compatible: if `nof_context` is not provided, behavior is identical to current implementation. Default voice calls continue to use marketing prompt.

## Consequences

### Positive
- Enables warm, relevant pitch ("you qualify for a grant") instead of generic cold call
- Voice agent has appropriate talking points for NOF audience
- Fallback brief is aligned with call goal (grant vs. website)
- Single Retell agent infrastructure serves both channels (no agent duplication)
- Backward-compatible: existing marketing calls unaffected
- Easy to A/B test: can toggle `nof_eligible` flag to compare pitch effectiveness

### Negative
- Two separate system prompts must be maintained; if City changes grant details, prompt must be updated
- Voice agent quality depends on prompt quality; poor prompt undermines call effectiveness
- No fallback if NOF prompt is stale or incorrect; quality assurance burden is higher
- Retell agent may not follow NOF prompt as precisely as marketing prompt (model-dependent)

### Neutral
- Adds ~300 lines of prompt content and 50 lines of conditional logic
- Requires testing of NOF-specific voice calls to verify talking points are accurate

## Alternatives Considered

1. **Separate Retell agents per channel** — Create two distinct Retell agents (agent_marketing and agent_nof) with separate IDs and configurations. Rejected because doubles agent management overhead, requires maintaining two separate agent IDs in config, and both share the same conversation structure and Webhook handler. Simpler to fork prompts at runtime.

2. **Single prompt with conditional sections** — Use one system prompt with inline conditional logic ("If NOF eligible, discuss grant; otherwise discuss website"). Rejected because prompts become unreadable, Retell agent interpretation becomes ambiguous, and logic is buried in natural language. Cleaner to have two distinct templates selected at runtime.

3. **Frontend-only pitch selection** — Let end user (call handler) choose pitch before initiating call ("Marketing" vs. "Grant"). Rejected because users should not have to make this decision; system should be intelligent enough to choose based on eligibility score.

4. **Email/SMS pitch, voice is always marketing** — Use email/SMS for grant outreach, reserve voice calls for marketing. Rejected because grant pitch is most impactful when delivered live (conversation, real-time objection handling, relationship building); email is too impersonal for grant facilitation.

5. **Post-call prompt injection** — Always use marketing prompt during call, then have Retell agent dynamically switch topics mid-call if NOF eligibility is detected. Rejected because mid-call pivots are jarring to business owner, and Retell agent is not designed for topic switching; prompt should be set upfront.
