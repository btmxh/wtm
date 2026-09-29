const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

function apiKey(): string {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set (check .env)");
  return key;
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface NoulResult {
  answers: Record<string, number>;
  usage: Usage;
}

// Asks one or more yes/no Noul questions against the same state in a single
// request - batching questions this way costs barely more than asking one.
export async function askNouls(
  state: unknown,
  questions: Record<string, NoulQuestion>,
  signal?: AbortSignal,
): Promise<NoulResult> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({ state, model: MODEL, questions }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TypeSafe API failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    answers: Record<string, { noul: number }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const answers: Record<string, number> = {};
  for (const [id, answer] of Object.entries(data.answers)) answers[id] = answer.noul;
  return {
    answers,
    usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
  };
}
