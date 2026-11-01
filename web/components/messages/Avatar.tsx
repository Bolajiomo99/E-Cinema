import { avatarColor, initials } from "@/lib/chat-types";

export default function Avatar({ id, name, size = 44, online, group }: { id: string; name: string; size?: number; online?: boolean; group?: boolean }) {
  return (
    <span className={`msg-av${group ? " group" : ""}`} style={{ width: size, height: size, background: avatarColor(id) }} aria-hidden>
      {initials(name)}
      {online && <i />}
    </span>
  );
}
