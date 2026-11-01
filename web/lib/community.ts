import "server-only";
import { accountApi } from "@/lib/auth";
import type { Group, GroupParty, Person, Post, ProfilePage, Tag } from "@/lib/community-types";

// Server reads for the Community pages.
export async function groups(session: string): Promise<Group[]> {
  const r = await accountApi("GET", "/v1/me/communities", undefined, session);
  return r.status === 200 ? ((r.body as { communities: Group[] }).communities ?? []) : [];
}
export async function group(session: string, slug: string): Promise<{ community: Group & { countries?: string[] }; parties: GroupParty[] } | null> {
  const r = await accountApi("GET", `/v1/me/communities/${slug}`, undefined, session);
  return r.status === 200 ? (r.body as { community: Group; parties: GroupParty[] }) : null;
}
export async function posts(session: string, query: URLSearchParams): Promise<{ posts: Post[]; more: boolean }> {
  const r = await accountApi("GET", `/v1/me/posts?${query}`, undefined, session);
  return r.status === 200 ? { posts: (r.body as { posts: Post[] }).posts ?? [], more: (r.body as { more: boolean }).more } : { posts: [], more: false };
}
export async function post(session: string, id: string): Promise<Post | null> {
  const r = await accountApi("GET", `/v1/me/posts/${id}`, undefined, session);
  return r.status === 200 ? (r.body as Post) : null;
}
export async function side(session: string): Promise<{ country: string; trending: Tag[]; people: Person[] }> {
  const r = await accountApi("GET", "/v1/me/community-side", undefined, session);
  return r.status === 200 ? (r.body as { country: string; trending: Tag[]; people: Person[] }) : { country: "", trending: [], people: [] };
}
export async function person(session: string, id: string): Promise<{ id: string; name: string; country: string; following: boolean; followers: number; follows: number; posts: number } | null> {
  const r = await accountApi("GET", `/v1/me/people/${id}`, undefined, session);
  return r.status === 200 ? (r.body as { id: string; name: string; country: string; following: boolean; followers: number; follows: number; posts: number }) : null;
}
export async function profilePage(session: string, who: string): Promise<ProfilePage | null> {
  const r = await accountApi("GET", `/v1/me/people/${encodeURIComponent(who)}/page`, undefined, session);
  return r.status === 200 ? (r.body as ProfilePage) : null;
}
