"use client";

import { useRouter } from "next/navigation";
import type { Post } from "@/lib/community-types";
import { useToast } from "./Feed";
import PostCard from "./PostCard";

export default function SinglePost({ post, me }: { post: Post; me: { id: string; name: string; lang: string } }) {
  const [say, toast] = useToast();
  const router = useRouter();
  return (
    <>
      <PostCard post={post} me={me} say={say} openComments onGone={() => router.push(post.community ? `/community/${post.community.slug}` : "/community")} />
      {toast}
    </>
  );
}
