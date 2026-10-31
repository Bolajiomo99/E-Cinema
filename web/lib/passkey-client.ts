// Browser side of passkeys, using the built-in WebAuthn JSON helpers (no third-party script).

type PKC = typeof PublicKeyCredential & {
  parseCreationOptionsFromJSON?: (o: unknown) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (o: unknown) => PublicKeyCredentialRequestOptions;
};

export function passkeysSupported() {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  const p = window.PublicKeyCredential as PKC;
  return typeof p.parseCreationOptionsFromJSON === "function" && typeof p.parseRequestOptionsFromJSON === "function";
}

async function post(path: string, body: unknown) {
  const res = await fetch(`/api/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Passkey failed, please try again");
  return data;
}

function friendly(e: unknown): Error {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError") return new Error("The passkey request was cancelled or timed out.");
  if (name === "InvalidStateError") return new Error("This device already has a passkey for your account.");
  return e instanceof Error ? e : new Error("Passkey failed, please try again");
}

export async function addPasskey() {
  if (!passkeysSupported()) throw new Error("This browser does not support passkeys yet.");
  const { challengeId, options } = await post("passkeys/register/begin", {});
  try {
    const publicKey = (PublicKeyCredential as PKC).parseCreationOptionsFromJSON!(options.publicKey);
    const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
    return await post("passkeys/register/finish", { challengeId, credential: cred.toJSON() });
  } catch (e) {
    throw friendly(e);
  }
}

export async function signInWithPasskey() {
  if (!passkeysSupported()) throw new Error("This browser does not support passkeys yet.");
  const { challengeId, options } = await post("passkeys/login/begin", {});
  try {
    const publicKey = (PublicKeyCredential as PKC).parseRequestOptionsFromJSON!(options.publicKey);
    const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential;
    return await post("passkeys/login/finish", { challengeId, credential: cred.toJSON() });
  } catch (e) {
    throw friendly(e);
  }
}
