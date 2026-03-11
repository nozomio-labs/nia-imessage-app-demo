import { NiaSDK } from "nia-ai-ts";

let sdk: NiaSDK | null = null;

export function getNia(): NiaSDK {
  if (!sdk) {
    sdk = new NiaSDK({
      apiKey: process.env.NIA_API_KEY!,
      baseUrl: process.env.NIA_API_URL || "https://apigcp.trynia.ai/v2",
    });
  }
  return sdk;
}
