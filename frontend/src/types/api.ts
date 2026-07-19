export type StatKey = 'courage' | 'wisdom' | 'faith' | 'love';

export type SpriteQualityStatus = 'unchecked' | 'passed' | 'warning' | 'failed';

export interface SpriteQualityFrame {
  frame: number;
  row: number;
  column: number;
  status: 'passed' | 'warning' | 'failed';
  margins: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null;
  issues: string[];
}

export interface SpriteAiQualityFrame {
  frame: number;
  severity: 'warning' | 'failed';
  issue: string;
}

export interface SpriteQualityReport {
  status: Exclude<SpriteQualityStatus, 'unchecked'>;
  can_approve: boolean;
  summary: string;
  deterministic: {
    status: 'passed' | 'warning' | 'failed';
    summary: string;
    safe_margin_px?: number;
    frames: SpriteQualityFrame[];
    issues: string[];
  };
  ai: {
    status: 'passed' | 'warning' | 'failed' | 'unavailable';
    summary: string;
    issues: string[];
    frames: SpriteAiQualityFrame[];
    model: string;
  };
}

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
  showcase_image_url: string | null;
  showcase_sprite_url: string | null;
  showcase_sprite_active_url: string | null;
  showcase_sprite_status: 'empty' | 'generating' | 'review' | 'ready' | 'failed';
  showcase_sprite_error: string | null;
  showcase_sprite_model: string | null;
  showcase_sprite_quality_status: SpriteQualityStatus;
  showcase_sprite_quality: SpriteQualityReport | null;
  showcase_sprite_qa_model: string | null;
  showcase_sprite_updated_at: string | null;
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
