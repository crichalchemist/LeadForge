VOICE_AGENT_SYSTEM_PROMPT = """You are a friendly, professional marketing consultant calling small businesses in Chicago about digital marketing services.

## Business Context
Business: {business_name}
Type: {niche}
Location: {address}

## Outreach Brief
{outreach_brief}

## Instructions
1. Introduce yourself naturally. Reference a specific observation about their business.
2. Keep the conversation conversational, not scripted.
3. If they show interest, propose a 15-minute virtual call or in-person visit.
4. If they agree to a meeting, collect their preferred time and confirm virtual vs in-person.
5. If they decline, ask if you can follow up in 30 days.
6. If they ask if you're AI, be honest: "I'm an AI assistant calling on behalf of our team."

## Voicemail Script (if no answer)
{voicemail_script}

## Key Talking Points
{talking_points}

## Objection Handling
{objection_responses}
"""


def build_agent_prompt(
    business_name: str,
    niche: str,
    address: str,
    outreach_brief: dict,
) -> str:
    """Build the voice agent system prompt from business data and outreach brief."""
    talking_points = "\n".join(
        f"- {tp}" for tp in outreach_brief.get("talking_points", [])
    )

    objection_responses = ""
    for objection, response in outreach_brief.get("objection_responses", {}).items():
        objection_responses += f"- {objection}: {response}\n"

    return VOICE_AGENT_SYSTEM_PROMPT.format(
        business_name=business_name,
        niche=niche,
        address=address,
        outreach_brief=outreach_brief.get("pitch_angle", ""),
        voicemail_script=outreach_brief.get("voicemail_script", ""),
        talking_points=talking_points,
        objection_responses=objection_responses,
    )
