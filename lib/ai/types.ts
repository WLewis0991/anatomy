export type ExplanationSubjectKind = "file" | "folder";

export interface ExplanationView {
  kind: ExplanationSubjectKind;
  path: string;
  body: string;
  /** True when this answer came from the stored explanation, with no model call. */
  cached: boolean;
  model: string;
  /** Hash of the content the body was written from. */
  subjectHash: string;
  /** Commit the explanation was written at, if the analysis recorded one. */
  headSha: string | null;
}

export interface ExplainRequestBody {
  kind: ExplanationSubjectKind;
  path: string;
}

export interface ExplanationResponsePayload {
  explanation: ExplanationView | null;
  stale: boolean;
  staleReason: "repository-moved" | null;
  currentHeadSha: string | null;
  tracingEnabled: boolean;
}

export interface FileRoleView {
  role: string;
  source: string;
}
