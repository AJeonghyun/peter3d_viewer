export type StatKey = 'courage' | 'wisdom' | 'faith' | 'love';

export type SpriteQualityStatus = 'unchecked' | 'passed' | 'warning' | 'failed';
export type ShowcaseCaptureStatus =
  | 'empty'
  | 'generating'
  | 'processing'
  | 'preparing'
  | 'quality_review'
  | 'illustrating'
  | 'illustration_saving'
  | 'garment_review'
  | 'composing'
  | 'reviewing'
  | 'saving'
  | 'review'
  | 'ready'
  | 'failed';
export type ShowcaseGarmentPartKey = 'upper' | 'lower' | 'left_shoe' | 'right_shoe';

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
  size_ratio?: {
    width: number;
    height: number;
    area: number;
  } | null;
  anchor_delta?: {
    center_x: number;
    baseline: number;
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

export interface ShowcaseCaptureQuality {
  status?: SpriteQualityStatus;
  summary?: string;
  issues?: string[];
  score?: number;
  warnings?: string[];
  corrected?: boolean;
  [key: string]: unknown;
}

export interface ShowcaseGarmentPart {
  key?: ShowcaseGarmentPartKey;
  label?: string;
  status?: 'empty' | 'processing' | 'ready' | 'failed';
  preview_url?: string | null;
  image_url?: string | null;
  extracted_url?: string | null;
  source_url?: string | null;
  quality?: ShowcaseCaptureQuality | string | null;
  error?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export type ShowcaseGarmentParts = Partial<Record<ShowcaseGarmentPartKey, ShowcaseGarmentPart>>;

export interface ShowcaseSpriteContract {
  id?: string;
  version?: number | string;
  layout?: '5x5' | '4x3' | string;
  rows?: number;
  columns?: number;
  frame_count?: number;
  frame_width?: number;
  frame_height?: number;
  display_scale?: number;
  safe_frame?: 'square' | string;
  atlas_url?: string | null;
  [key: string]: unknown;
}

export interface ShowcaseSpriteVersion {
  id: string | number;
  team_id?: number;
  sprite_url?: string | null;
  atlas_url?: string | null;
  contract?: ShowcaseSpriteContract | null;
  quality?: SpriteQualityReport | ShowcaseCaptureQuality | null;
  status?: string;
  created_at?: string | null;
  approved_at?: string | null;
  restored_at?: string | null;
  note?: string | null;
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
  showcase_capture_url?: string | null;
  showcase_capture_source_url?: string | null;
  showcase_capture_status?: ShowcaseCaptureStatus;
  showcase_capture_quality?: ShowcaseCaptureQuality | null;
  showcase_capture_corrected_url?: string | null;
  showcase_corrected_capture_url?: string | null;
  showcase_garment_parts?: ShowcaseGarmentParts | null;
  showcase_sprite_url: string | null;
  showcase_sprite_active_url: string | null;
  showcase_sprite_status: ShowcaseCaptureStatus;
  showcase_sprite_error: string | null;
  showcase_sprite_model: string | null;
  showcase_sprite_contract?: ShowcaseSpriteContract | null;
  showcase_sprite_version_id?: string | number | null;
  showcase_sprite_active_version_id?: string | number | null;
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

export interface ShowcaseCaptureResponse {
  team: Team;
  version?: ShowcaseSpriteVersion;
  quality?: ShowcaseCaptureQuality;
  reference?: {
    contract: string;
    template_size: number[];
    mode: 'full-body-master-edit' | 'illustrated-full-body-master-edit';
    corrected_url: string;
    regions: ShowcaseGarmentPartKey[];
  };
  can_process?: boolean;
  status?: string;
}

export interface ShowcaseComposeResponse {
  team: Team;
  version: ShowcaseSpriteVersion;
  qa?: SpriteQualityReport;
  atlas_url?: string;
  status: string;
  next_action: 'generate' | 'patch' | 'review' | 'wait' | 'retry' | 'complete' | 'failed';
  retry_after_seconds?: number;
  frame_patch?: {
    frames: number[];
    completed_frames: number[];
    remaining_frames: number[];
    source_version_id?: string | number | null;
  };
  contract: string | ShowcaseSpriteContract;
}

export interface ShowcaseVersionListResponse {
  team_id: number;
  active_version_id: string | number | null;
  candidate_version_id: string | number | null;
  versions: ShowcaseSpriteVersion[];
}

export interface ShowcaseRestoreResponse {
  team: Team;
  version: ShowcaseSpriteVersion;
  status: string;
}

export interface GrowthPayload {
  source: string;
  note: string;
  talent_delta: number;
  stats: Partial<Record<StatKey, number>>;
}
