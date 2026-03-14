VOICE_AGENT_SYSTEM_PROMPT = """You are a friendly, professional marketing \
consultant calling small businesses in Chicago about digital marketing services.

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
4. If they agree to a meeting, collect their preferred time and confirm \
virtual vs in-person.
5. If they decline, ask if you can follow up in 30 days.
6. If they ask if you're AI, be honest: "I'm an AI assistant calling on \
behalf of our team."

## Voicemail Script (if no answer)
{voicemail_script}

## Key Talking Points
{talking_points}

## Objection Handling
{objection_responses}
"""

NOF_VOICE_AGENT_SYSTEM_PROMPT = """You are a friendly, professional grant \
facilitator calling small businesses in Chicago about the City's Neighborhood \
Opportunity Fund grant program.

## Business Context
Business: {business_name}
Type: {niche}
Location: {address}

## Grant Opportunity
You may qualify for up to {estimated_grant} through the City of Chicago's \
Neighborhood Opportunity Fund. Your business is located on {corridor_name}, \
which is {corridor_type} for this program.

## Outreach Brief
{outreach_brief}

## Grant Talking Points
{grant_talking_points}

## Instructions
1. Introduce yourself naturally. Lead with the grant opportunity.
2. Keep the conversation conversational, not scripted.
3. Explain that you help businesses navigate the NOF application process.
4. As part of the grant process, we also help businesses establish their \
digital presence (required for grant applications).
5. If they show interest, propose a 15-minute virtual call to discuss \
eligibility and next steps.
6. If they agree to a meeting, collect their preferred time and confirm \
virtual vs in-person.
7. If they decline, ask if you can follow up in 30 days with more information.
8. If they ask if you're AI, be honest: "I'm an AI assistant calling on \
behalf of our grant facilitation team."

## Voicemail Script (if no answer)
{voicemail_script}

## Objection Handling
{objection_responses}
"""


def build_agent_prompt(
    business_name: str,
    niche: str,
    address: str,
    outreach_brief: dict,
    nof_context: dict | None = None,
) -> str:
    """Build the voice agent system prompt from business data and outreach brief.

    Args:
        business_name: Name of the business
        niche: Business type/category
        address: Business address
        outreach_brief: Dictionary containing pitch_angle, voicemail_script,
            talking_points, objection_responses
        nof_context: Optional NOF grant context with keys: corridor_name,
            corridor_type, estimated_grant, grant_talking_points

    Returns:
        Formatted system prompt string for the voice agent
    """
    objection_responses = ""
    for objection, response in outreach_brief.get("objection_responses", {}).items():
        objection_responses += f"- {objection}: {response}\n"

    if nof_context:
        # Use NOF grant-focused template
        grant_talking_points = "\n".join(
            f"- {tp}" for tp in nof_context.get("grant_talking_points", [])
        )

        return NOF_VOICE_AGENT_SYSTEM_PROMPT.format(
            business_name=business_name,
            niche=niche,
            address=address,
            corridor_name=nof_context.get("corridor_name", "an eligible corridor"),
            corridor_type=nof_context.get("corridor_type", "eligible"),
            estimated_grant=nof_context.get("estimated_grant", "$250,000"),
            outreach_brief=outreach_brief.get("pitch_angle", ""),
            grant_talking_points=grant_talking_points,
            voicemail_script=outreach_brief.get("voicemail_script", ""),
            objection_responses=objection_responses,
        )
    else:
        # Use standard marketing template
        talking_points = "\n".join(
            f"- {tp}" for tp in outreach_brief.get("talking_points", [])
        )

        return VOICE_AGENT_SYSTEM_PROMPT.format(
            business_name=business_name,
            niche=niche,
            address=address,
            outreach_brief=outreach_brief.get("pitch_angle", ""),
            voicemail_script=outreach_brief.get("voicemail_script", ""),
            talking_points=talking_points,
            objection_responses=objection_responses,
        )
