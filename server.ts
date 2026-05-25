import cors from "cors";
import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

dotenv.config();




const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "AEPMA Backend",
  });
});

// Initialize AWS Bedrock Client
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});


/**
 * Helper to call Gemma 3 on Bedrock using the Messages API format
 */


async function generateWithGemma(
  prompt: any,
  isJson: boolean = true
) {
  try {
    // Ensure prompt is always a string
    const promptText =
      typeof prompt === "string"
        ? prompt
        : JSON.stringify(prompt, null, 2);

    //console.log("========== GEMMA REQUEST ==========");
    //console.log("PROMPT TYPE:", typeof prompt);
    //console.log("PROMPT TEXT:", promptText);

    const finalPrompt = isJson
      ? `${promptText}

Return ONLY a valid JSON object.
Do not use markdown.
Do not wrap the response in code blocks.
`
      : promptText;

    /*console.log(
      JSON.stringify(
        {
          modelId: "google.gemma-3-4b-it-v1:0",
          messages: [
            {
              role: "user",
              content: [
                {
                  text: finalPrompt,
                },
              ],
            },
          ],
        },
        null,
        2
      )
    );*/

    const command = new ConverseCommand({
      modelId: "google.gemma-3-4b-it",

      messages: [
        {
          role: "user",
          content: [
            {
              text: finalPrompt,
            },
          ],
        },
      ],

      inferenceConfig: {
        maxTokens: 2048,
        temperature: 0.3,
        topP: 0.9,
      },
    });

    const response = await bedrockClient.send(command);

    //console.log("========== GEMMA RESPONSE ==========");
    //console.log(JSON.stringify(response, null, 2));

    let text = "";

    if (
      response.output?.message?.content &&
      response.output.message.content.length > 0
    ) {
      const firstBlock =
        response.output.message.content[0];

      if ("text" in firstBlock) {
        text = firstBlock.text || "";
      }
    }

    if (!text) {
      throw new Error(
        "Empty response received from Gemma"
      );
    }

    if (isJson) {
      const cleaned = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      try {
        return JSON.parse(cleaned);
      } catch (parseError) {
        console.error(
          "Failed to parse JSON response:"
        );
        console.error(cleaned);
        throw parseError;
      }
    }

    return text.trim();
  } catch (error) {
    console.error(
      "Gemma Generation Error:",
      error
    );
    throw error;
  }
}

// ----------------- ENTERPRISE AI BACKEND SERVICE ROUTING -----------------

app.get("/test-bedrock", async (_, res) => {
  try {
    const response = await bedrockClient.send(
      new ConverseCommand({
        modelId: "google.gemma-3-4b-it-v1:0",
        messages: [
          {
            role: "user",
            content: [
              {
                text: "Say hello"
              }
            ]
          }
        ]
      })
    );

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json(err);
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "express"
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// 2. Predictive Maintenance
app.post("/api/ai/predictive-maintenance", async (req, res) => {
  const { assetId, assetName, category, temperature, vibration, runHours, loadFactor } = req.body;
  try {
    const prompt = `Analyze telemetry for asset ${assetId} (${assetName}):
Temp: ${temperature}°C, Vibration: ${vibration}mm/s, Load: ${loadFactor}%.
Return JSON: { "status": "NORMAL|WARNING|CRITICAL", "riskScore": number, "failureProbability": "string", "predictedFailureMode": "string", "maintenanceRecommendation": "string", "timeToFailureEst": "string" }`;

    const parsed = await generateWithGemma(prompt);
    res.json({ ...parsed, assetId, isSimulated: false, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.json({ status: "WARNING", riskScore: 50, assetId, isSimulated: true });
  }
});

// 3. Voice-to-Ticket
app.post("/api/ai/voice-to-ticket", async (req, res) => {
  const { voiceTranscript, industry } = req.body;
  try {
    const prompt = `Convert transcript to maintenance ticket for ${industry}: "${voiceTranscript}"
Return JSON: { "summarizedTitle": "string", "detectedCategory": "string", "autoPriority": "string", "severityRating": number, "structuredSummary": "string", "suggestedAssignment": "string" }`;

    const parsed = await generateWithGemma(prompt);
    res.json({ ...parsed, isSimulated: false });
  } catch (error) {
    res.status(500).json({ error: "Voice processing failed" });
  }
});

// 4. Issue Diagnosis
app.post("/api/ai/issue-diagnosis", async (req, res) => {
  const { ticketTitle, ticketDescription, assetDetails } = req.body;
  try {
    const prompt = `Diagnose: ${ticketTitle}. Desc: ${ticketDescription}. 
Return JSON: { "rootCauses": [], "troubleshootingSteps": [], "recommendedSpares": [{"partName":"", "partNumber":"", "estimatedCost":""}], "technicianSkillMatch": "", "confidenceScore": "" }`;

    const parsed = await generateWithGemma(prompt);
    res.json({ ...parsed, isSimulated: false });
  } catch (error) {
    res.status(500).json({ error: "Diagnosis failed" });
  }
});

// 5. Copilot Bot
app.post("/api/ai/copilot", async (req, res) => {
  const { messages, industryContext, role } = req.body;
  const history = (messages || []).map((m: any) => `${m.role}: ${m.content}`).join("\n");

  try {
    const prompt = `You are AEPMA Copilot for ${role} in ${industryContext}. 
Give technical advice based on this history:
${history}`;

    const responseText = await generateWithGemma(prompt, false);
    res.json({ response: responseText, isSimulated: false, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: "Copilot error" });
  }
});

// 6. Reports Summary
app.post("/api/ai/summary", async (req, res) => {
  const { stats, organizationName } = req.body;
  try {
    const prompt = `Generate report for ${organizationName} based on stats: ${JSON.stringify(stats)}.
Return JSON: { "executiveSummary": "string", "energySavingsScore": "string", "criticalRisks": [] }`;

    const parsed = await generateWithGemma(prompt);
    res.json({ ...parsed, isSimulated: false });
  } catch (error) {
    res.status(500).json({ error: "Summary failed" });
  }
});

// ----------------- BOOTSTRAP -----------------

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[AEPMA Server] running on http://localhost:${PORT} using Gemma 3 via Bedrock Messages API`);
  });
}

startServer();
