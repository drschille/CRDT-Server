import type * as Automerge from '@automerge/automerge';
import type { BoardDoc, FilteredBoard, UserId } from './types.js';

export function filterForUser(doc: Automerge.Doc<BoardDoc>, userId: UserId): FilteredBoard {
  return {
    posts: doc.posts.filter((post) => post.visibility === 'public' || post.authorId === userId),
  };
}
