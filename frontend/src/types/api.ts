export type StatKey = 'courage' | 'wisdom' | 'faith' | 'love';

export interface Team {
  id: number;
  name: string;
  identity_text: string;
  color: string;
  symbol: string;
  courage: number;
  wisdom: number;
  faith: number;
  love: number;
  talents: number;
  title: string;
  image_url: string | null;
  model_url: string | null;
  model_asset_id: string | null;
  conversion_status: string;
  updated_at: string;
}

export interface ConversionJob {
  id: string;
  team_id: number | null;
  asset_only?: boolean;
  asset_name?: string | null;
  status: string;
  error: string | null;
  glb_url: string | null;
  pipeline_profile?: string | null;
  credits_used?: number | null;
  fallback_used?: boolean;
  metrics?: Record<string, unknown> | null;
  glb_bytes?: number | null;
  glb_triangles?: number | null;
  glb_animations?: number | null;
}

export interface ModelAsset {
  id: string;
  name: string;
  source_image_url: string | null;
  glb_url: string;
  pipeline_profile: string;
  glb_bytes: number | null;
  glb_triangles: number | null;
  glb_animations: number | null;
  team_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface PipelineProfile {
  id: string;
  label: string;
  description: string;
  estimated_credits: number;
}

export interface TripoBilling {
  configured: boolean;
  balance: number | null;
  frozen: number | null;
  tracked_credits: number;
  workers: number;
  profiles: PipelineProfile[];
  error?: string;
}

export interface GrowthPayload {
  source: string;
  note: string;
  talent_delta: number;
  stats: Partial<Record<StatKey, number>>;
}
