import { createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { Model } from "@earendil-works/pi-ai";
import { qwenTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-cn";
import { qwenTokenPlanProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan";
import { qwenTokenPlanIndividualProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-individual";

export { qwenTokenPlanCnProvider, qwenTokenPlanProvider, qwenTokenPlanIndividualProvider };

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

function bailianModel(id: string, baseUrl: string): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: "bailian",
    baseUrl,
    reasoning: false,
    input: ["text"],
    // ponytail: cost rates 0 — fill from bailian pricing when cost tracking matters;
    // contextWindow is a conservative default — tune per model in NS_AGENT_BAILIAN_MODELS workflows
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 8192,
  };
}

export function bailianProvider() {
  const baseUrl = process.env.NS_AGENT_BAILIAN_BASE_URL ?? DEFAULT_BASE_URL;
  const ids = (process.env.NS_AGENT_BAILIAN_MODELS ?? "qwen3-max,qwen-plus,qwen-turbo")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return createProvider({
    id: "bailian",
    name: "Aliyun Bailian (Model Studio, pay-as-you-go)",
    baseUrl,
    auth: { apiKey: envApiKeyAuth("Bailian API key", ["DASHSCOPE_API_KEY", "BAILIAN_API_KEY"]) },
    models: ids.map((id) => bailianModel(id, baseUrl)),
    api: openAICompletionsApi(),
  });
}
