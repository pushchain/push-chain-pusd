/**
 * Quest webhook — fires after every confirmed PUSD mint/convert/redeem.
 *
 * Uses Web Crypto (crypto.subtle) for HMAC-SHA256 because Node's
 * crypto.createHmac is not available in the browser bundle.
 *
 * The call is fire-and-forget: failures are logged but never surface to
 * the user so a webhook outage never blocks the UI.
 */

const API_BASE = (import.meta.env.VITE_PUSHCHAIN_API_ENDPOINT as string | undefined)
  ?? 'https://us-east1-push-dev-apps.cloudfunctions.net/helloWorld';

const WEBHOOK_URL = `${API_BASE}/api/v3/pusd/events`;

const SECRET = import.meta.env.VITE_PUSD_WEBHOOK_SECRET as string | undefined;

export type QuestEventType = 'MINT' | 'CONVERT' | 'REDEEM';
export type QuestEventStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export type QuestPayload = {
  eventId: string;
  eventType: QuestEventType;
  status: QuestEventStatus;
  userAddress: string;
  fromToken: string;
  fromAmount: string;
  toToken: string;
  toAmount: string;
  txHash: string;
  chainId: string;
  eventTimestamp: string;
  failureReason?: string;
};

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function reportQuestEvent(payload: QuestPayload): Promise<void> {
  if (!SECRET) return;

  const rawBody = JSON.stringify(payload);
  const timestamp = Date.now().toString();

  let signature: string;
  try {
    signature = await hmacHex(SECRET, `${timestamp}.${rawBody}`);
  } catch (err) {
    console.warn('[quest] HMAC signing failed', err);
    return;
  }

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pusd-timestamp': timestamp,
        'x-pusd-signature': signature,
      },
      body: rawBody,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[quest] webhook ${res.status}`, text);
    }
  } catch (err) {
    console.warn('[quest] webhook fetch failed', err);
  }
}
