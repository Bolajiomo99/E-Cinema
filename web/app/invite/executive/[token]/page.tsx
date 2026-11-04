import { accountApi, currentAccount } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { ROLE_LABEL } from "@/lib/exec-types";
import InviteFlow, { type InviteView } from "@/components/exec/InviteFlow";

const OFFICER: Record<string, string> = { coo: "Chief Operating Officer", cfo: "Chief Financial Officer", cto: "Chief Technology Officer", cmo: "Chief Marketing Officer" };

const hoursUntil = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 3_600_000));

export const metadata = { title: "You are invited · E-Cinema Executive", robots: { index: false } };
export const dynamic = "force-dynamic";

// Executive invite (Figma 99:1696): there is no sign-up page; this one-time link is the way in.
export default async function ExecInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = /^[A-Za-z0-9_-]{20,80}$/.test(token);
  const r = ok ? await accountApi("GET", `/v1/exec-invites/${token}`) : { status: 404, body: null };
  const me = await currentAccount();
  let passkeys = 0;
  if (me) {
    const k = await accountApi("GET", "/v1/passkeys", undefined, await session());
    passkeys = k.status === 200 ? ((k.body as { passkeys?: unknown[] })?.passkeys?.length ?? 0) : 0;
  }
  const inv = r.status === 200 ? (r.body as { email: string; name: string; role: string; by: string; expiresAt: string; gone: boolean; emailConfirmed: boolean; codeSentAt: string | null }) : null;
  const view: InviteView | null = inv && {
    email: inv.email, name: inv.name, role: OFFICER[inv.role] ? `Cabinet · ${OFFICER[inv.role]}` : ROLE_LABEL[inv.role] ?? "Executive",
    by: inv.by || "The CEO", hoursLeft: hoursUntil(inv.expiresAt), gone: inv.gone,
    emailConfirmed: inv.emailConfirmed, codeSent: Boolean(inv.codeSentAt),
    signedInAs: me?.email ?? "", face: Boolean(me?.faceVerified), passkey: passkeys > 0,
  };
  return <InviteFlow token={token} v={view} />;
}
