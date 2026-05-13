export interface NoteDraft {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  pinned?: boolean;
  groupId?: string;
}

export interface NoteGroup {
  id: string;
  name: string;
  createdAt: string;
  collapsed?: boolean;
}
