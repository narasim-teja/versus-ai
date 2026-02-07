import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { config } from "./config";

let sdk: W3SSdk | null = null;

/**
 * Initialize the Circle Web SDK with app settings and authentication.
 */
export function initCircleSdk(
  userToken: string,
  encryptionKey: string
): W3SSdk {
  sdk = new W3SSdk();

  sdk.setAppSettings({ appId: config.circleAppId });
  sdk.setAuthentication({ userToken, encryptionKey });

  return sdk;
}

/**
 * Get the current Circle SDK instance.
 */
export function getCircleSdk(): W3SSdk | null {
  return sdk;
}

/**
 * Execute a Circle challenge (PIN setup, wallet creation, etc.).
 * Rejects if the challenge status indicates failure.
 */
export function executeChallenge(
  challengeId: string
): Promise<{ type: string; status: string }> {
  return new Promise((resolve, reject) => {
    if (!sdk) {
      reject(new Error("Circle SDK not initialized"));
      return;
    }

    sdk.execute(challengeId, (error, result) => {
      if (error) {
        reject(new Error(error.message ?? "Challenge failed"));
        return;
      }

      const status = result?.status ?? "unknown";
      const type = result?.type ?? "unknown";

      // Only resolve on COMPLETE; reject on any other terminal status
      if (status !== "COMPLETE" && status !== "IN_PROGRESS" && status !== "PENDING") {
        reject(new Error(`Challenge ${status.toLowerCase()}`));
        return;
      }

      resolve({ type, status });
    });
  });
}
