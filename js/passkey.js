// Face ID / Touch ID / Windows Hello for The Lair (passkeys).
// The phone keeps the private key; the helper only ever sees a signed answer to a one-time question.
export const EDGE = 'https://api.ibadhasan.com';

const toB64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export async function passkeySupported() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}

async function post(path, body, token) {
  let res;
  try {
    res = await fetch(EDGE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  } catch { throw new Error('No internet connection.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data;
}

// Friendly messages for what the phone says when Face ID is cancelled or fails
function explain(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return Object.assign(new Error('Face ID was cancelled.'), { cancelled: true });
  if (e?.name === 'InvalidStateError') return new Error('Face ID is already set up on this device.');
  if (e?.name === 'SecurityError') return new Error('Face ID only works on ibadhasan.com.');
  return e instanceof Error ? e : new Error('Face ID did not work.');
}

// Set up Face ID on this device (needs a signed-in session)
export async function registerPasskey(token) {
  const o = await post('/auth/passkey/register-options', {}, token);
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      ...o,
      challenge: fromB64url(o.challenge),
      user: { ...o.user, id: fromB64url(o.user.id) },
      excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: fromB64url(c.id) })),
    } });
  } catch (e) { throw explain(e); }
  const r = cred.response;
  await post('/auth/passkey/register', {
    id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
    response: {
      clientDataJSON: toB64url(r.clientDataJSON), attestationObject: toB64url(r.attestationObject),
      transports: r.getTransports?.() || [],
    },
  }, token);
}

// Sign in with Face ID. Returns { token, expires } like the password sign-in.
export async function loginWithPasskey() {
  const o = await post('/auth/passkey/login-options', {});
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: {
      ...o,
      challenge: fromB64url(o.challenge),
      allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: fromB64url(c.id) })),
    } });
  } catch (e) { throw explain(e); }
  const r = cred.response;
  return post('/auth/passkey/login', {
    id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
    response: {
      clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.authenticatorData),
      signature: toB64url(r.signature), userHandle: r.userHandle ? toB64url(r.userHandle) : undefined,
    },
  });
}
