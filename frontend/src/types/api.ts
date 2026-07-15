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
  conversion_status: string;
  updated_at: string;
}

export interface ConversionJob {
  id: string;
  team_id: number;
  status: string;
  error: string | null;
  glb_url: string | null;
}

export interface GrowthPayload {
  source: string;
  note: string;
  talent_delta: number;
  stats: Partial<Record<StatKey, number>>;
}
