// The comments API (task and project comments) returns the writer as `author` / `authorId`.
// Older frontend code read `user` / `userId`, which the API never sends, so every comment
// rendered as "Unknown User" and nobody's own comment counted as theirs. Read `author`
// first and keep `user` only as a fallback for any older payload.

type Person = {
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  name?: string | null;
} | null | undefined;

type CommentLike = {
  author?: Person;
  user?: Person;
  authorId?: string | null;
  userId?: string | null;
};

export function commentAuthorName(comment: CommentLike): string {
  const person = comment.author ?? comment.user;
  const fullName = [person?.firstName, person?.lastName].filter(Boolean).join(' ').trim();
  return fullName || person?.name || person?.email || 'Unknown User';
}

export function commentAuthorId(comment: CommentLike): string | undefined {
  return comment.authorId ?? comment.author?.id ?? comment.userId ?? comment.user?.id ?? undefined;
}
