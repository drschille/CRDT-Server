import * as Automerge from '@automerge/automerge';
import { randomUUID } from 'node:crypto';
import { BoardDoc, PostId, UserId, Visibility } from './types.js';

function requireNonEmptyText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error('Text must be non-empty');
  }
  return trimmed;
}

export function addPost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  rawText: string,
  visibility: Visibility = 'public'
): Automerge.Doc<BoardDoc> {
  const text = requireNonEmptyText(rawText);
  return Automerge.change(doc, 'add_post', (draft) => {
    draft.posts.push({
      id: randomUUID(),
      authorId: userId,
      text,
      createdAt: new Date().toISOString(),
      editedAt: undefined,
      likes: {},
      visibility
    });
  });
}

export function editPost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  postId: PostId,
  rawText: string
): Automerge.Doc<BoardDoc> {
  const text = requireNonEmptyText(rawText);
  return Automerge.change(doc, 'edit_post', (draft) => {
    const post = draft.posts.find((p) => p.id === postId);
    if (!post) {
      throw new Error('Post not found');
    }
    if (post.authorId !== userId) {
      throw new Error('Forbidden');
    }
    post.text = text;
    post.editedAt = new Date().toISOString();
  });
}

export function deletePost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  postId: PostId
): Automerge.Doc<BoardDoc> {
  return Automerge.change(doc, 'delete_post', (draft) => {
    const index = draft.posts.findIndex((p) => p.id === postId);
    if (index === -1) {
      throw new Error('Post not found');
    }
    if (draft.posts[index]?.authorId !== userId) {
      throw new Error('Forbidden');
    }
    draft.posts.splice(index, 1);
  });
}

export function likePost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  postId: PostId
): Automerge.Doc<BoardDoc> {
  return Automerge.change(doc, 'like_post', (draft) => {
    const post = draft.posts.find((p) => p.id === postId);
    if (!post) {
      throw new Error('Post not found');
    }
    post.likes[userId] = true;
  });
}

export function unlikePost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  postId: PostId
): Automerge.Doc<BoardDoc> {
  return Automerge.change(doc, 'unlike_post', (draft) => {
    const post = draft.posts.find((p) => p.id === postId);
    if (!post) {
      throw new Error('Post not found');
    }
    delete post.likes[userId];
  });
}
