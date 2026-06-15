import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { config, isBedrockConfigured } from '../config/env.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

let client = null;

function getClient() {
  if (client) return client;
  const opts = { region: config.aws.region };
  // Bedrock API key (launched Jul 2025) is passed as a bearer token via the
  // AWS_BEARER_TOKEN_BEDROCK env var that the SDK reads automatically. We set it
  // here from our own config so the user only needs BEDROCK_API_KEY in .env.
  if (config.aws.bedrockApiKey) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = config.aws.bedrockApiKey;
  } else if (config.aws.accessKeyId) {
    opts.credentials = {
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
    };
  }
  client = new BedrockRuntimeClient(opts);
  return client;
}

// Call Claude on Bedrock with the Messages API body shape. Returns the raw
// assistant text (expected to be strict JSON). Retries with backoff on throttle.
export async function invokeBedrock(rawText, now = new Date()) {
  if (!isBedrockConfigured()) {
    throw new Error('bedrock_not_configured');
  }
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2000,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(rawText, now) }],
  };

  const cmd = new InvokeModelCommand({
    modelId: config.aws.bedrockModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await getClient().send(cmd);
      const payload = JSON.parse(Buffer.from(res.body).toString('utf-8'));
      // Claude on Bedrock returns { content: [{ type:'text', text }] }
      const text = payload?.content?.map((c) => c.text).join('') ?? '';
      return text;
    } catch (err) {
      lastErr = err;
      const throttled = err?.name === 'ThrottlingException' || err?.$metadata?.httpStatusCode === 429;
      if (!throttled) throw err;
      await sleep(2 ** attempt * 500); // exponential backoff
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
