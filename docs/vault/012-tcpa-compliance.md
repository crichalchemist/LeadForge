# ADR-012: TCPA compliance: business lines only, one concurrent call, flag mobiles

**Status:** Accepted
**Date:** 2026-03-14

## Context

Automated voice outreach must comply with the Telephone Consumer Protection Act (TCPA). TCPA violations carry civil penalties of $500-$1,500 per call, with potential for treble damages in willful violations.

Key TCPA restrictions relevant to LeadForge:
- Automated calls to mobile phones require prior express written consent
- Calls to residential lines are restricted by Do Not Call (DNC) registry
- Business-to-business calls have more permissive rules

LeadForge targets small businesses and obtains phone numbers from public sources (Google Places, Socrata business license records). We need to implement safeguards to minimize legal risk while maintaining operational effectiveness.

## Decision

We will implement the following TCPA compliance measures:

1. **Business lines only:** Only call numbers identified as business lines from Google Places or Socrata business records
2. **One concurrent call:** Set Celery `worker_prefetch_multiplier=1` to ensure maximum one outbound call at a time
3. **Mobile flagging:** Flag numbers that appear to be personal/mobile for human review before calling
4. **Call recording:** Record all calls and retain transcripts for compliance documentation
5. **DNC list:** Implement do-not-call list checking (future: integrate with National DNC Registry)
6. **Call manager validation:** Implement `is_business_line()` gate function that validates phone before initiating call

## Consequences

### Positive
- Strong regulatory compliance reduces legal risk
- One-at-a-time calling is simple to implement and monitor
- Call recordings provide evidence of compliance in case of dispute
- Business-line-only policy aligns with B2B use case

### Negative
- Slower outreach velocity — sequential calling means ~3 minutes per lead minimum
- Some valid business lines registered on mobile numbers may be incorrectly flagged
- No-answer rates may be higher for single-attempt calls vs parallel dialing
- Need to build mobile number detection heuristics

## Alternatives Considered

- **Parallel calling:** Faster outreach (5-10 concurrent) but harder to monitor and increases risk exposure
- **Manual-only calling:** Safest compliance posture but doesn't scale beyond 10-20 calls per day
- **SMS-first approach:** Different TCPA rules (still requires consent for mobile) and lower engagement rates than voice
