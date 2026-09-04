export type RelationshipKind = 'continuation' | 'contrast' | 'change' | 'tension' | 'shared_origin';
export type ConfidenceBand = 'possible' | 'supported';

export interface NoteEvidence {
  noteId: string;
  revision: number;
  excerpt: string;
  occurredAt: string;
}

export interface NoteRelationship {
  relationshipId: string;
  source: NoteEvidence;
  candidate: NoteEvidence;
  kind: RelationshipKind;
  headline: string;
  explanation: string;
  confidence: ConfidenceBand;
  generatedAt: string;
}

export interface RelationshipContext {
  relationship: NoteRelationship;
  notes: Array<{ noteId: string; title: string; occurredAt: string; excerpt: string }>;
}

export type RelationshipFeedback = 'helpful' | 'not_relevant' | 'hide_pair';
