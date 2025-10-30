import type { BoardDoc, FilteredBoard, FilteredPost, UserId } from './types.js';

type ReadableBoard = { posts: BoardDoc['posts'] };

export function filterForUser(doc: ReadableBoard, userId: UserId): FilteredBoard {
  return {
    posts: doc.posts
      .filter((post) => post.visibility === 'public' || post.authorId === userId)
      .map(toFilteredPost)
  };
}

function toFilteredPost(post: BoardDoc['posts'][number]): FilteredPost {
  return {
    id: post.id,
    authorId: post.authorId,
    text: post.text.toString(),
    createdAt: post.createdAt,
    editedAt: post.editedAt,
    lastEditedBy: post.lastEditedBy,
    likes: post.likes,
    visibility: post.visibility
  };
}
