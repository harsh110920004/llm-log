import "dotenv/config";

const API_KEY =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY;

const MODEL =
    process.env.AI_MODEL ||
    "gemini-2.5-flash";

let clientPromise = null;

async function getClient() {
    if (!API_KEY) {
        return null;
    }

    if (!clientPromise) {
        clientPromise = import("@google/genai")
            .then(({ GoogleGenAI }) =>
                new GoogleGenAI({
                    apiKey: API_KEY
                })
            );
    }

    return clientPromise;
}

function cleanJson(text) {
    if (!text) return {};

    let value = text.trim();

    if (value.startsWith("```")) {
        value = value
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "");
    }

    try {
        return JSON.parse(value);
    } catch {
        const start =
            value.indexOf("{");

        const end =
            value.lastIndexOf("}");

        if (
            start !== -1 &&
            end !== -1
        ) {
            try {
                return JSON.parse(
                    value.slice(
                        start,
                        end + 1
                    )
                );
            } catch {
                return {};
            }
        }

        return {};
    }
}

async function generate(prompt, options = {}) {
    const ai = await getClient();

    if (!ai) {
        return null;
    }

    const response =
        await ai.models.generateContent({
            model: MODEL,
            contents: prompt,
            config: {
                temperature:
                    options.temperature ?? 0.1,
                maxOutputTokens:
                    options.maxOutputTokens ?? 1800
            }
        });

    return response.text || "";
}

export async function analyzeWithAI(summary) {
    const fallback = {
        summary:
            `Detected ${summary.counts.total} log entries with ${summary.counts.ERROR + summary.counts.CRITICAL} errors.`,

        severity:
            summary.incidentRisk,

        rootCause:
            summary.topErrors[0]?.message ||
            "No dominant root cause detected.",

        affectedServices:
            summary.topServices
                .slice(0, 10)
                .map(x => x.name),

        errors:
            summary.topErrors
                .slice(0, 10)
                .map(x => ({
                    message: x.message,
                    count: x.count
                })),

        recommendations: [
            "Investigate the highest-frequency error.",
            "Check affected services.",
            "Compare the incident with recent deployments."
        ],

        confidence:
            0.35
    };

    const prompt = `
You are an expert Site Reliability Engineer.

Analyze the following log intelligence.

DO NOT invent facts.
Only use evidence contained in the data.

Return ONLY valid JSON.

Required structure:

{
  "summary": "short incident summary",
  "severity": "LOW|MEDIUM|HIGH|CRITICAL",
  "rootCause": "most likely root cause",
  "affectedServices": ["service"],
  "errors": [
    {
      "message": "error",
      "count": 1,
      "impact": "description"
    }
  ],
  "recommendations": ["action"],
  "confidence": 0.0
}

LOG INTELLIGENCE:

${JSON.stringify(summary)}
`;

    try {
        const text =
            await generate(
                prompt,
                {
                    temperature: 0.1,
                    maxOutputTokens: 1400
                }
            );

        if (!text) {
            return fallback;
        }

        const result =
            cleanJson(text);

        return {
            summary:
                result.summary ||
                fallback.summary,

            severity:
                result.severity ||
                fallback.severity,

            rootCause:
                result.rootCause ||
                fallback.rootCause,

            affectedServices:
                Array.isArray(
                    result.affectedServices
                )
                    ? result.affectedServices
                    : fallback.affectedServices,

            errors:
                Array.isArray(
                    result.errors
                )
                    ? result.errors
                    : fallback.errors,

            recommendations:
                Array.isArray(
                    result.recommendations
                )
                    ? result.recommendations
                    : fallback.recommendations,

            confidence:
                Number.isFinite(
                    Number(result.confidence)
                )
                    ? Number(result.confidence)
                    : fallback.confidence
        };

    } catch (error) {

        console.error(
            "AI analysis failed:",
            error.message
        );

        return fallback;
    }
}

export async function chatWithAI(
    question,
    context,
    history = []
) {
    const fallback =
        "I could not reach the AI model. The relevant log evidence has still been identified.";

    const prompt = `
You are an AI SRE assistant.

Answer the user's question using ONLY the provided log evidence.

Rules:

- Do not invent events.
- Mention uncertainty when evidence is insufficient.
- Reference line numbers when useful.
- Explain technical reasoning clearly.
- Prefer actionable debugging advice.
- If the question asks for root cause, distinguish evidence from inference.

QUESTION:

${question}

PREVIOUS CHAT:

${JSON.stringify(history)}

RELEVANT LOG EVIDENCE:

${JSON.stringify(context)}
`;

    try {

        const text =
            await generate(
                prompt,
                {
                    temperature: 0.2,
                    maxOutputTokens: 1200
                }
            );

        return text || fallback;

    } catch (error) {

        console.error(
            "AI chat failed:",
            error.message
        );

        return fallback;
    }
}

export async function investigateIncident(
    intelligence
) {
    const fallback = {
        verdict:
            intelligence.prediction?.level ||
            "UNKNOWN",

        investigation:
            "Local log intelligence was used because the AI model was unavailable.",

        rootCause:
            intelligence.rootCause?.[0]
                ?.category ||
            "Unknown",

        blastRadius:
            `${intelligence.blastRadius?.score || 0}/100`,

        actions:
            intelligence.fixes?.map(
                x => x.action
            ) || [],

        verification: [
            "Re-run the affected workload.",
            "Verify the dominant error disappears.",
            "Confirm the error rate returns toward baseline."
        ],

        prevention: [
            "Add monitoring for the detected failure signal.",
            "Add a regression test for the dominant failure."
        ],

        confidence: 0.35
    };

    const prompt = `
You are an autonomous senior SRE investigating a production incident.

Use ONLY the evidence below.

Do not invent infrastructure, deployments, users,
timestamps or causes that are not supported.

Return ONLY valid JSON.

{
  "verdict": "...",
  "investigation": "...",
  "rootCause": "...",
  "blastRadius": "...",
  "actions": ["..."],
  "verification": ["..."],
  "prevention": ["..."],
  "confidence": 0.0
}

INCIDENT DATA:

${JSON.stringify(intelligence)}
`;

    try {

        const text =
            await generate(
                prompt,
                {
                    temperature: 0.05,
                    maxOutputTokens: 1800
                }
            );

        if (!text) {
            return fallback;
        }

        const result =
            cleanJson(text);

        return {
            verdict:
                result.verdict ||
                fallback.verdict,

            investigation:
                result.investigation ||
                fallback.investigation,

            rootCause:
                result.rootCause ||
                fallback.rootCause,

            blastRadius:
                result.blastRadius ||
                fallback.blastRadius,

            actions:
                Array.isArray(
                    result.actions
                )
                    ? result.actions
                    : fallback.actions,

            verification:
                Array.isArray(
                    result.verification
                )
                    ? result.verification
                    : fallback.verification,

            prevention:
                Array.isArray(
                    result.prevention
                )
                    ? result.prevention
                    : fallback.prevention,

            confidence:
                Number.isFinite(
                    Number(result.confidence)
                )
                    ? Number(result.confidence)
                    : fallback.confidence
        };

    } catch (error) {

        console.error(
            "Investigation failed:",
            error.message
        );

        return fallback;
    }
}

export async function generateRegressionTests(
    incident
) {
    const fallback = [
        "Verify the dominant error no longer occurs.",
        "Verify affected endpoints return successful responses.",
        "Verify affected services remain healthy.",
        "Verify error rate returns toward baseline."
    ];

    const prompt = `
You are a senior test engineer.

Generate regression tests for the production incident below.

Only use evidence from the incident.

Return ONLY a JSON array of strings.

Each test must be concrete and implementable.

INCIDENT:

${JSON.stringify(incident)}
`;

    try {

        const text =
            await generate(
                prompt,
                {
                    temperature: 0.1,
                    maxOutputTokens: 1000
                }
            );

        if (!text) {
            return fallback;
        }

        let cleaned =
            text.trim();

        if (cleaned.startsWith("```")) {
            cleaned =
                cleaned
                    .replace(
                        /^```json\s*/i,
                        ""
                    )
                    .replace(
                        /^```\s*/i,
                        ""
                    )
                    .replace(
                        /\s*```$/i,
                        ""
                    );
        }

        const result =
            JSON.parse(cleaned);

        return Array.isArray(result)
            ? result
            : fallback;

    } catch (error) {

        console.error(
            "Test generation failed:",
            error.message
        );

        return fallback;
    }
}

export async function generatePostmortem(
    incident
) {
    const fallback = {
        title:
            "Production Incident",

        summary:
            "Incident analysis generated from available log evidence.",

        impact:
            JSON.stringify(
                incident.blastRadius
            ),

        rootCause:
            incident.rootCause?.[0]
                ?.category ||
            "Unknown",

        timeline:
            incident.timeline || [],

        contributingFactors: [],

        correctiveActions:
            incident.fixes?.map(
                x => x.action
            ) || [],

        prevention: []
    };

    const prompt = `
Create a professional engineering postmortem.

Use ONLY the incident evidence.

Never invent facts.

Return ONLY valid JSON:

{
  "title": "...",
  "summary": "...",
  "impact": "...",
  "rootCause": "...",
  "timeline": [
    {
      "time": "...",
      "event": "..."
    }
  ],
  "contributingFactors": ["..."],
  "correctiveActions": ["..."],
  "prevention": ["..."]
}

INCIDENT:

${JSON.stringify(incident)}
`;

    try {

        const text =
            await generate(
                prompt,
                {
                    temperature: 0.1,
                    maxOutputTokens: 1800
                }
            );

        if (!text) {
            return fallback;
        }

        const result =
            cleanJson(text);

        return {
            title:
                result.title ||
                fallback.title,

            summary:
                result.summary ||
                fallback.summary,

            impact:
                result.impact ||
                fallback.impact,

            rootCause:
                result.rootCause ||
                fallback.rootCause,

            timeline:
                Array.isArray(
                    result.timeline
                )
                    ? result.timeline
                    : fallback.timeline,

            contributingFactors:
                Array.isArray(
                    result.contributingFactors
                )
                    ? result.contributingFactors
                    : fallback.contributingFactors,

            correctiveActions:
                Array.isArray(
                    result.correctiveActions
                )
                    ? result.correctiveActions
                    : fallback.correctiveActions,

            prevention:
                Array.isArray(
                    result.prevention
                )
                    ? result.prevention
                    : fallback.prevention
        };

    } catch (error) {

        console.error(
            "Postmortem failed:",
            error.message
        );

        return fallback;
    }
}