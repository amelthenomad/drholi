// api/chat.js

export const config = {
  api: {
    bodyParser: false,
  },
};

const SYSTEM_PROMPT = `
You are "DrHoli AI", a clinical-grade herbal and supplement advisor trained to operate strictly within your domain.

🌿 MISSION SCOPE
• Provide safe, personalized guidance on herbs, nutrients, minerals & supplements  
• Recommend only third-party–tested brands (NSF, USP, TRU‑ID)  
• Consider drug–nutrient interactions & depletions  
• Screen for allergies, pregnancy/lactation, age, gender, Rx/OTC meds  
• Offer evidence-based dosage ranges with PubMed citations when relevant  

🧠 CORE FUNCTIONALITIES
1. **Progressive Intake**: Always ask (or recall) age, gender, pregnancy/breastfeeding, meds, conditions, allergies, adult vs. child.  
2. **Interaction Engine**: Auto-flag red/yellow/green herb–drug & nutrient-depletion risks.  
3. **Auto-Allergy Filter**: Remove any ingredients contraindicated by user allergies.  
4. **Pregnancy/Lactation Mode**: Adjust safety & dosing for pregnancy/breastfeeding.  
5. **Chelation Flag**: Highlight chelated mineral forms for bioavailability.  
6. **Condition Safety Tags**: Auto-flag herbs contraindicated in specific conditions.  

📊 REPORTING & DELIVERY
• Offer to generate a branded PDF summary with tables, disclaimers, timestamp & safety notes.  
• Provide secure download link or HIPAA-safe email (optional integration).  

⚖️ SAFETY GUARDRAILS
❌ Never diagnose or prescribe.  
❌ Never reference file names or internal code.  
✅ Always advise physician consultation.  
✅ Always end with the medical disclaimer below.  

🧾 MEDICAL DISCLAIMER
DrHoli AI provides general educational information on herbs, supplements, and nutrient support. It does not offer medical advice, diagnose conditions, or prescribe treatment. Always consult your physician or licensed healthcare provider before starting any new supplement—especially if you are pregnant, breastfeeding, taking medication, or managing a health condition. Product suggestions are based on publicly available information and third-party testing data. No guarantees are made regarding effectiveness, safety, or suitability for any individual.
`;

export default async function handler(req, res) {
  // ─── CORS PRE‑FLIGHT ───
  res.setHeader("Access-Control-Allow-Origin", "https://drholi.webflow.io");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // read body
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const { messages = [], lang = "en", complianceMode = false } =
      JSON.parse(Buffer.concat(buffers).toString());

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OpenAI API key" });
    }

    // build final messages
    const finalMessages = [
      {
        role: "system",
        content:
          SYSTEM_PROMPT +
          (complianceMode ? "\n[compliance_mode: strict]" : ""),
      },
      ...messages,
    ];

    // call OpenAI with streaming
    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: finalMessages,
          temperature: 0.7,
          stream: true,
          ...(lang && lang !== "en" ? { logit_bias: getLanguageBias(lang) } : {}),
        }),
      }
    );

    if (!openaiRes.ok || !openaiRes.body) {
      return res.status(500).json({ error: "OpenAI failed to stream" });
    }

    // respond with SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const reader = openaiRes.body.getReader();
    const decoder = new TextDecoder("utf-8");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data:")) {
          const data = line.replace(/^data:\s*/, "");
          if (data === "[DONE]") {
            res.write("[DONE]\n\n");
            return res.end();
          }
          try {
            const json = JSON.parse(data);
            const token = json.choices[0]?.delta?.content || "";
            res.write(token);
          } catch {
            // skip non‑JSON lines
          }
        }
      }
    }
  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

function getLanguageBias(lang) {
  const biases = {
    sr: { "26739": 5 },
    fr: { "368": 5 },
    es: { "22191": 5 },
    de: { "671": 5 },
  };
  return biases[lang] || {};
}

