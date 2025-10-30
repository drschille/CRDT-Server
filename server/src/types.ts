import type { Text } from '@automerge/automerge';

export type PostId = string;
export type UserId = string;

export type Visibility = 'public' | 'private';

export interface Post {
  id: PostId;
  authorId: UserId;
  text: Text;
  createdAt: string;
  editedAt?: string;
  likes: Record<UserId, true>;
  visibility: Visibility;
}

export interface BoardDoc extends Record<string, unknown> {
  posts: Post[];
}

export interface FilteredPost {
  id: PostId;
  authorId: UserId;
  text: string;
  createdAt: string;
  editedAt?: string;
  likes: Record<UserId, true>;
  visibility: Visibility;
}

export interface FilteredBoard {
  posts: FilteredPost[];
}
