import { FilteredBoard, UserId } from './types.js';

type ReadableBoard = { posts: FilteredBoard['posts'] };

export function filterForUser(doc: ReadableBoard, userId: UserId): FilteredBoard {
  return {
    posts: doc.posts.filter((post) => post.visibility === 'public' || post.authorId === userId)
  };
}
