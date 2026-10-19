import { ChatOpenRouter } from "@langchain/openrouter";
import { createDeepAgent } from "deepagents";

const internetSearch = { type: "openrouter:web_search" };

const researchInstructions = `You are an expert researcher. Your job is to conduct thorough research and then write a polished report.

You have access to OpenRouter's web search server tool as your primary means of gathering information. Search before you answer, and write the report from what the search returned.`;

const model = new ChatOpenRouter({
  model: "nvidia/nemotron-3-ultra-550b-a55b:free",
});

const agent = createDeepAgent({
  model,
  tools: [internetSearch],
  systemPrompt: researchInstructions,
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "What is LangGraph?" }],
});

console.log(result.messages[result.messages.length - 1].content);
