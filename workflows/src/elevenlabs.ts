// ElevenLabs text to speech for dubbed dialogue.
const BASE = () => process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io";

// ElevenLabs explains refusals in detail.status / detail.message; never includes the key.
async function why(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { detail?: { status?: string; message?: string } | string };
  const d = body.detail;
  return typeof d === "string" ? d.slice(0, 200) : `${d?.status ?? ""} ${d?.message ?? ""}`.trim().slice(0, 200);
}

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY is not set");
  return k;
}

// Uses the voice given, else ELEVENLABS_VOICE_ID, else the first ready-made voice on the account.
export async function pickVoice(voiceId?: string): Promise<string> {
  if (voiceId) return voiceId;
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  const res = await fetch(`${BASE()}/v1/voices`, { headers: { "xi-api-key": key() }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ElevenLabs voices -> ${res.status} ${await why(res)}`);
  const { voices } = (await res.json()) as { voices: { voice_id: string; category?: string }[] };
  const voice = voices.find((v) => v.category === "premade") ?? voices[0];
  if (!voice) throw new Error("no ElevenLabs voices on this account");
  return voice.voice_id;
}

export async function speak(p: {
  voiceId: string;
  text: string;
  previousText?: string;
  nextText?: string;
}): Promise<Uint8Array> {
  const res = await fetch(`${BASE()}/v1/text-to-speech/${encodeURIComponent(p.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key(), "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: p.text,
      model_id: "eleven_multilingual_v2",
      previous_text: p.previousText,
      next_text: p.nextText,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs speech -> ${res.status} ${await why(res)}`);
  return new Uint8Array(await res.arrayBuffer());
}
