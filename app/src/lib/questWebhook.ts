const API_BASE = (import.meta.env.VITE_PUSHCHAIN_API_ENDPOINT as string | undefined)
  ?? 'https://us-east1-push-dev-apps.cloudfunctions.net/helloWorld';

const WEBHOOK_URL = `${API_BASE}/api/v3/pusd/events`;

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

export type PUSDSigner = {
  address: string;
  chain: string;
  sign: (msgBytes: Uint8Array) => Promise<Uint8Array | string>;
};

function isSolanaChain(chain: string): boolean {
  return chain.startsWith('solana:');
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(bytes: Uint8Array): string {
  let leading = 0;
  for (const b of bytes) { if (b !== 0) break; leading++; }
  let n = bytes.reduce((acc, b) => acc * 256n + BigInt(b), 0n);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  return '1'.repeat(leading) + out;
}

function encodeSig(raw: Uint8Array | string, chain: string): string {
  if (typeof raw === 'string') return raw;
  if (isSolanaChain(chain)) return toBase58(raw);
  return '0x' + Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildSignInMessage(address: string, chain: string): { text: string; message: string } {
  const domain = 'pusd.push.org';
  const uri = typeof window !== 'undefined' ? window.location.origin : 'https://pusd.push.org';
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const issuedAt = new Date().toISOString();
  const statement = 'Sign in to pusd.push.org';

  if (isSolanaChain(chain)) {
    const payload = { domain, address, statement, uri, nonce, issuedAt };
    const text = [
      `${domain} wants you to sign in with your Solana account:`,
      address, '',
      statement, '',
      `URI: ${uri}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
    ].join('\n');
    return { text, message: JSON.stringify(payload) };
  }

  const chainId = Number(chain.split(':').pop()) || 42101;
  const payload = { domain, address, statement, uri, version: '1', chainId, nonce, issuedAt };
  const text = [
    `${domain} wants you to sign in with your Ethereum account:`,
    address, '',
    statement, '',
    `URI: ${uri}`, `Version: 1`, `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`, `Issued At: ${issuedAt}`,
  ].join('\n');
  return { text, message: JSON.stringify(payload) };
}

type SignInSession = {
  caip10Address: string;
  signature: string;
  message: string;
};

const STORAGE_PREFIX = 'pusd:quest:session:';
const memCache = new Map<string, SignInSession>();
const inflightSessions = new Map<string, Promise<SignInSession>>();

function loadSession(key: string): SignInSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as SignInSession) : null;
  } catch { return null; }
}

function saveSession(key: string, session: SignInSession): void {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(session)); } catch {}
}

async function getOrCreateSession(signer: PUSDSigner): Promise<SignInSession> {
  const key = `${signer.chain}:${signer.address.toLowerCase()}`;

  const mem = memCache.get(key);
  if (mem) return mem;

  const persisted = loadSession(key);
  if (persisted) { memCache.set(key, persisted); return persisted; }

  const inflight = inflightSessions.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    const { text, message } = buildSignInMessage(signer.address, signer.chain);
    const raw = await signer.sign(new TextEncoder().encode(text));
    const signature = encodeSig(raw, signer.chain);
    const session: SignInSession = {
      caip10Address: `${signer.chain}:${signer.address}`,
      signature,
      message,
    };
    memCache.set(key, session);
    saveSession(key, session);
    return session;
  })();

  inflightSessions.set(key, promise);
  promise.finally(() => inflightSessions.delete(key));
  return promise;
}

export async function reportQuestEvent(
  payload: QuestPayload,
  signer?: PUSDSigner,
): Promise<void> {
  if (!signer) return;


  let session: SignInSession;
  try {
    session = await getOrCreateSession(signer);
  } catch {
    console.warn('[quest] sign-in rejected or signer unavailable');
    return;
  }

  const body = JSON.stringify(payload);
  const timestamp = Date.now().toString();

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pusd-timestamp': timestamp,
        'x-wallet-address': session.caip10Address,
        'x-pusd-signature': session.signature,
        'x-message': session.message,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[quest] webhook ${res.status}`, text);
    }
  } catch (err) {
    console.warn('[quest] webhook fetch failed', err);
  }
}
