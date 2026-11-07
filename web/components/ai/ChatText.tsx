import { Fragment, type ReactNode } from "react";

// The AI writes light Markdown (bold, bullet lists). Shown as real formatting, never as raw
// asterisks, and built as React nodes so nothing it writes can become HTML.
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part.replace(/(^|\s)\*([^*\s][^*]*)\*(?=\s|$|[.,!?])/g, "$1$2").replace(/^#{1,6}\s+/, "")}</Fragment>,
  );
}

export default function ChatText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (line) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="ai-text">{blocks}</div>;
}
