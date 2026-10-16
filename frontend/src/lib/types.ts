export interface Filters {
  start?: string;
  end?: string;
  project: number[];
  model: number[];
  harness: number[];
}

export interface Rate {
  value: number | null;
  k: number;
  n: number;
  ci_low: number | null;
  ci_high: number | null;
}

export interface Project { id: number; name: string; description: string; is_synthetic: boolean }
export interface AgentModel {
  id: number; name: string; provider: string; input_price: number | null; output_price: number | null;
  cache_write_price: number | null; cache_read_price: number | null; is_synthetic: boolean;
}
export interface Harness { id: number; name: string; display_name: string; is_synthetic: boolean }

export interface Meta {
  api_version: string;
  range: { start: string; end: string };
  projects: Project[];
  models: AgentModel[];
  harnesses: Harness[];
  categories: string[];
  difficulties: string[];
  counts: { tasks: number; usage: number; synthetic_tasks: number };
  thresholds: { min_drift_n: number; drift_threshold: number; min_cell_n: number };
}

export interface TaskMetrics {
  attempted: number; in_progress: number; resolved: number; agent_reported: number; accepted: number; verified: number;
  failed: number; success_rate: Rate; first_pass_rate: Rate; rework_rate: Rate; intervention_rate: Rate;
  overclaim_rate: Rate; verification_rate: Rate; avg_rework_cycles: number | null; human_minutes_total: number; review_minutes_total: number; intervention_total: number;
  human_minutes_missing: number; human_minutes_per_accepted_median: number | null; human_minutes_on_failed: number;
  time_to_accept_hours_median: number | null; time_to_accept_hours_p75: number | null;
}

export interface UsageMetrics {
  records: number; sessions: number; tokens: number; input_tokens: number; output_tokens: number; cache_tokens: number;
  agent_minutes: number; api_equiv_cost: number; api_equiv_unknown_records: number; actual_spend: number;
  spend_unknown_records: number; idle_subscription_cost: number; linked_records: number;
}

export interface Task {
  id: number; project_id: number; model_id: number | null; harness_id: number | null; harness_version: string | null;
  title: string; description: string; category: string; difficulty: string; outcome: string; created_at: string;
  agent_reported_complete: boolean; agent_reported_at: string | null; human_accepted: boolean; accepted_at: string | null;
  verified: boolean; verified_at: string | null; verification_method: string | null; rework_cycles: number;
  intervention_count: number; human_minutes: number | null; review_minutes: number | null;
  reference_human_minutes: number | null; is_synthetic: boolean;
  usage_count?: number; tokens?: number; actual_cost?: number; api_equiv_cost?: number | null; evidence_count?: number;
}

export interface Usage {
  id: number; source: string; granularity: string; harness_id: number; model_id: number | null; project_id: number | null;
  task_id: number | null; import_batch_id: number | null; session_key: string | null; usage_date: string;
  agent_minutes: number | null; input_tokens: number; output_tokens: number; cache_creation_tokens: number;
  cache_read_tokens: number; total_tokens: number; billing: string; reported_cost: number | null;
  api_equiv_cost: number | null; price_status: string; raw_model_name: string | null; is_synthetic: boolean;
}

export interface TaskDetail extends Task {
  criteria: { id: number; text: string; met: boolean }[];
  deliverables: { id: number; kind: string; title: string; url: string | null }[];
  evidence: { id: number; kind: string; summary: string; url: string | null; created_at: string }[];
  history: { id: number; changed_at: string; field: string; old_value: string | null; new_value: string | null }[];
  usage: Usage[];
  computed: Record<string, any>;
}

export interface Subscription {
  id: number; name: string; harness_id: number; monthly_cost: number; start_date: string; end_date: string | null;
  notes: string; is_synthetic: boolean;
}
