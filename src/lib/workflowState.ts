import { WorkflowState } from '../domain/models/types';

// API calls resolve to `{ error }` on failure (e.g. a 403 from the local-only
// middleware or a 500). Only a real WorkflowState may replace the UI's state,
// otherwise every render that reads state.constitutionPhase would crash.
export function isWorkflowState(value: unknown): value is WorkflowState {
  const v = value as WorkflowState | null;
  return !!v && typeof v === 'object' && !!v.constitutionPhase && Array.isArray(v.features);
}
