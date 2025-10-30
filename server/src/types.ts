export type PostId = string;
export type UserId = string;

export type Visibility = 'public' | 'private';

export interface Post {
  id: PostId;
  authorId: UserId;
  text: string;
  createdAt: string;
  editedAt?: string;
  likes: Record<UserId, true>;
  visibility: Visibility;
}

export interface BoardDoc {
  posts: Post[];
}

export interface FilteredBoard extends BoardDoc {}
