from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

class StepStatus(str, Enum):
    READY = 'ready'
    WORKING = 'working'
    COMPLETE = 'complete'
    ERROR = 'error'
    INTERRUPTED = 'interrupted'

class Step(BaseModel):
    name: str
    status: StepStatus
    message: str
    isActive: bool
    startTime: Optional[str] = None
    endTime: Optional[str] = None

class WorkOrder(BaseModel):
    id: str
    eventCode: str
    subEvent: str
    stage: str
    languages: Dict[str, bool]
    subjects: Dict[str, str]
    account: str
    createdBy: str
    steps: List[Step]
    createdAt: str
    updatedAt: str
    locked: bool = False
    lockedBy: Optional[str] = None
    stopRequested: bool = False

class WorkOrderUpdate(BaseModel):
    updates: Dict[str, Any]
    id: str
    userPid: str = 'system' 