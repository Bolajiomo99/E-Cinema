import Link from "next/link";
import UploadStart from "@/components/studio/UploadStart";
import { session } from "@/lib/licensing";
import { myStudio, studioPage } from "@/lib/studio";
import { ago, can, type Upload } from "@/lib/studio-types";

// Start a new film upload, or carry on with a draft (Figma 35:290 is the upload itself).
export const metadata = { title: "Upload · Studio · E-Cinema", robots: { index: false } };

export default async function StudioUploadsPage() {
  const s = await session();
  const [mine, r] = await Promise.all([myStudio(s), studioPage<{ uploads: Upload[] }>(s, "uploads")]);
  const uploads = r?.uploads ?? [];
  const now = new Date().getTime();
  const edit = can(mine?.studio?.role ?? "viewer", "edit");
  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Upload a film</h1>
          <p>Send your master, audio stems, subtitles and trailer. Big files carry on after a dropped connection.</p>
        </div>
      </header>
      <div className="pt-row a">
        <section className="bp-panel">
          <h2>New film</h2>
          {edit ? <UploadStart /> : <p className="pt-hint">Only the owner and admins can start an upload.</p>}
        </section>
        <section className="bp-panel">
          <h2>Drafts</h2>
          {uploads.length ? (
            <ul className="stup-drafts">
              {uploads.map((u) => {
                const done = u.files.filter((f) => f.status === "uploaded").length;
                return (
                  <li key={u.id}>
                    <div><b>{u.title}</b><small>{u.files.length ? `${done} of ${u.files.length} files uploaded` : "No files yet"} · saved {ago(u.updatedAt, now)}</small></div>
                    <Link className="vf-btn sm" href={`/studio/upload/${u.id}`}>{edit ? "Continue" : "View"}</Link>
                  </li>
                );
              })}
            </ul>
          ) : <p className="pt-empty">Drafts you start show here, so you can come back to them.</p>}
        </section>
      </div>
    </div>
  );
}
