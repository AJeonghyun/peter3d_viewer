"""Pydantic request payloads for the public API."""

from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from backend import config


class TeamUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=30)
    identity_text: Optional[str] = Field(default=None, max_length=120)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    symbol: Optional[str] = Field(default=None, max_length=20)


class GrowthCreate(BaseModel):
    source: str = Field(min_length=1, max_length=60)
    note: str = Field(default="", max_length=200)
    talent_delta: int = Field(default=0, ge=-10000, le=10000)
    stats: Dict[str, int] = Field(default_factory=dict)


class ModelAssetApply(BaseModel):
    team_ids: List[int] = Field(min_length=1, max_length=config.TEAM_COUNT)


class SeatingPresetPayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=80)
    time_label: str = Field(default="", max_length=80)
    group_order: List[int] = Field(
        min_length=config.TEAM_COUNT, max_length=config.TEAM_COUNT
    )


class ActiveSeatingPresetPayload(BaseModel):
    preset_id: str = Field(min_length=1, max_length=80)


class SpriteApprovalPayload(BaseModel):
    force: bool = False


class SpriteFramePatchPayload(BaseModel):
    frames: List[int] = Field(
        min_length=1,
        max_length=config.GARMENT_FRAME_COUNT,
    )


class RetreatScenePositionPayload(BaseModel):
    x: float = Field(ge=2, le=98)
    bottom: float = Field(ge=-4, le=70)
    scale: float = Field(ge=0.35, le=1.8)
    rotation: float = Field(default=0, ge=-180, le=180)
    flipX: bool = False
    visible: bool = True
    poseId: str = Field(default="idle", min_length=1, max_length=40)


class RetreatSceneLayoutPayload(BaseModel):
    layout: Dict[str, RetreatScenePositionPayload]
