import * as Automerge from '@automerge/automerge';
import { randomUUID } from 'node:crypto';
import type { BoardDoc, PostId, UserId, Visibility } from './types.js';

const MAX_TEXT_LENGTH = 4000;

function validateText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Text must not be empty.');
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new Error('Text exceeds maximum length.');
  }
  return trimmed;
}

function requirePost(doc: Automerge.Doc<BoardDoc>, id: PostId) {
  const index = doc.posts.findIndex((post) => post.id === id);
  if (index === -1) {
    throw new Error('Post not found.');
  }
  return index;
}

export function addPost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  text: string,
  visibility: Visibility = 'public',
): Automerge.Doc<BoardDoc> {
  const body = validateText(text);
  return Automerge.change(doc, 'add_post', (d) => {
    d.posts.push({
      id: randomUUID(),
      authorId: userId,
      text: body,
      createdAt: new Date().toISOString(),
      editedAt: undefined,
      likes: {},
      visibility,
    });
  });
}

export function editPost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  id: PostId,
  text: string,
): Automerge.Doc<BoardDoc> {
  const body = validateText(text);
  const index = requirePost(doc, id);
  const post = doc.posts[index];
  if (post.authorId !== userId) {
    throw new Error('Only the author can edit this post.');
  }
  return Automerge.change(doc, 'edit_post', (d) => {
    d.posts[index].text = body;
    d.posts[index].editedAt = new Date().toISOString();
  });
}

export function deletePost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  id: PostId,
): Automerge.Doc<BoardDoc> {
  const index = requirePost(doc, id);
  const post = doc.posts[index];
  if (post.authorId !== userId) {
    throw new Error('Only the author can delete this post.');
  }
  return Automerge.change(doc, 'delete_post', (d) => {
    d.posts.splice(index, 1);
  });
}

export function likePost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  id: PostId,
): Automerge.Doc<BoardDoc> {
  const index = requirePost(doc, id);
  return Automerge.change(doc, 'like_post', (d) => {
    d.posts[index].likes[userId] = true;
  });
}

export function unlikePost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  id: PostId,
): Automerge.Doc<BoardDoc> {
  const index = requirePost(doc, id);
  return Automerge.change(doc, 'unlike_post', (d) => {
    delete d.posts[index].likes[userId];
  });
}
