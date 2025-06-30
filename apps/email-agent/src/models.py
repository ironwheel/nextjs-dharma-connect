from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from datetime import datetime, timezone
import json

class StepStatus(str, Enum):
    READY = 'ready'
    WORKING = 'working'
    COMPLETE = 'complete'
    ERROR = 'error'
    INTERRUPTED = 'interrupted'
    EXCEPTION = 'exception'  # New status for agent crashes
    SLEEPING = 'sleeping'  # Add sleeping state

class Step:
    """Represents a step in a work order"""
    def __init__(self, name: str, status: StepStatus = StepStatus.READY, message: str = "", isActive: bool = False, startTime: Optional[str] = None, endTime: Optional[str] = None):
        self.name = name
        if isinstance(status, dict):
            if 'S' in status:
                status_value = status['S']
                self.status = StepStatus(status_value)
            else:
                self.status = StepStatus.READY
        elif isinstance(status, str):
            self.status = StepStatus(status)
        elif isinstance(status, StepStatus):
            self.status = status
        else:
            self.status = StepStatus.READY
        
        if isinstance(message, dict):
            if 'S' in message:
                message_value = message['S']
                self.message = message_value
            else:
                self.message = ""
        else:
            self.message = str(message) if message else ""
        
        self.isActive = isActive
        self.startTime = startTime
        self.endTime = endTime

    def dict(self) -> Dict:
        """Convert to regular dictionary format"""
        return {
            'name': self.name,
            'status': self.status.value,
            'message': self.message,
            'isActive': self.isActive,
            'startTime': self.startTime,
            'endTime': self.endTime
        }

    def to_dict(self) -> Dict:
        """Convert to DynamoDB format"""
        return {
            'name': {'S': self.name},
            'status': {'S': self.status.value},
            'message': {'S': self.message},
            'isActive': {'BOOL': self.isActive},
            'startTime': {'NULL': True} if self.startTime is None else {'S': self.startTime},
            'endTime': {'NULL': True} if self.endTime is None else {'S': self.endTime}
        }

    @classmethod
    def from_dict(cls, data: Dict) -> 'Step':
        """Create from either regular JSON or DynamoDB format"""
        # Helper function to safely extract values
        def extract_value(field_data, field_name):
            if isinstance(field_data, dict):
                if 'S' in field_data:
                    return field_data['S']
                elif 'BOOL' in field_data:
                    return field_data['BOOL']
                elif 'NULL' in field_data:
                    return None
                else:
                    return str(field_data)
            else:
                return field_data
        
        # Extract each field safely
        name = extract_value(data.get('name'), 'name')
        status = extract_value(data.get('status'), 'status')
        message = extract_value(data.get('message'), 'message')
        isActive = extract_value(data.get('isActive'), 'isActive')
        startTime = extract_value(data.get('startTime'), 'startTime')
        endTime = extract_value(data.get('endTime'), 'endTime')
        
        # Convert status to StepStatus enum
        if isinstance(status, str):
            try:
                status_enum = StepStatus(status)
            except ValueError:
                status_enum = StepStatus.READY
        else:
            status_enum = StepStatus.READY
        
        # Convert isActive to boolean
        if isinstance(isActive, bool):
            is_active_bool = isActive
        else:
            is_active_bool = bool(isActive) if isActive is not None else False
        
        return cls(
            name=name,
            status=status_enum,
            message=str(message) if message else "",
            isActive=is_active_bool,
            startTime=startTime,
            endTime=endTime
        )

    def __str__(self) -> str:
        """String representation"""
        return f"Step(name={self.name}, status={self.status.value}, message={self.message}, isActive={self.isActive})"

class WorkOrderStatus(str, Enum):
    PENDING = 'pending'
    IN_PROGRESS = 'in_progress'
    COMPLETED = 'completed'
    ERROR = 'error'
    INTERRUPTED = 'interrupted'

class WorkOrder:
    """Represents a work order for email processing"""
    def __init__(self, id: str, email: str, steps: List[Step], status: WorkOrderStatus = WorkOrderStatus.PENDING):
        self.id = id
        self.email = email
        self.steps = steps
        self.status = status
        self.stopRequested = False
        self.locked = False
        self.locked_by = None
        self.locked_at = None
        self.created_at = datetime.now(timezone.utc)
        self.updated_at = datetime.now(timezone.utc)
        # Additional fields from DynamoDB
        self.eventCode = None
        self.stage = None
        self.subEvent = None
        self.account = None
        self.subjects = {}
        self.languages = {}
        self.createdBy = None
        self.replyTo = None
        self.fromName = None
        self.zoomId = None  # Add zoomId field
        self.inPerson = None  # Add inPerson field
        self.config = {}  # Add config field for pool and other configuration
        self.testers = []  # Add testers field for test step
        self.sendContinuously = False  # Add sendContinuously field
        self.sendUntil = None  # Add sendUntil field
        self.s3HTMLPaths = {}  # Add s3HTMLPaths field for storing S3 paths
        self.dryRunRecipients = []  # Add dryRunRecipients field for Dry-Run step
        self.sendRecipients = []  # Add sendRecipients field for Send step

    def dict(self) -> Dict:
        """Convert to regular dictionary format"""
        return {
            'id': self.id,
            'email': self.email,
            'steps': [step.dict() for step in self.steps],
            'status': self.status.value,
            'stopRequested': self.stopRequested,
            'locked': self.locked,
            'lockedBy': self.locked_by,
            'lockedAt': self.locked_at.isoformat() if self.locked_at else None,
            'createdAt': self.created_at.isoformat(),
            'updatedAt': self.updated_at.isoformat(),
            'eventCode': self.eventCode,
            'stage': self.stage,
            'subEvent': self.subEvent,
            'account': self.account,
            'subjects': self.subjects,
            'languages': self.languages,
            'createdBy': self.createdBy,
            'replyTo': self.replyTo,
            'fromName': self.fromName,
            'zoomId': self.zoomId,
            'inPerson': self.inPerson,
            'config': self.config,
            'testers': self.testers,
            'sendContinuously': self.sendContinuously,
            'sendUntil': self.sendUntil,
            's3HTMLPaths': self.s3HTMLPaths,
            'dryRunRecipients': self.dryRunRecipients,
            'sendRecipients': self.sendRecipients
        }

    def to_dict(self) -> Dict:
        """Convert to DynamoDB format"""
        return {
            'id': {'S': self.id},
            'email': {'S': self.email},
            'steps': {'L': [step.to_dict() for step in self.steps]},
            'status': {'S': self.status.value},
            'stopRequested': {'BOOL': self.stopRequested},
            'locked': {'BOOL': self.locked},
            'lockedBy': {'S': self.locked_by} if self.locked_by else {'NULL': True},
            'lockedAt': {'NULL': True} if self.locked_at is None else {'S': self.locked_at.isoformat()},
            'createdAt': {'S': self.created_at.isoformat()},
            'updatedAt': {'S': self.updated_at.isoformat()},
            'eventCode': {'S': self.eventCode} if self.eventCode else {'NULL': True},
            'stage': {'S': self.stage} if self.stage else {'NULL': True},
            'subEvent': {'S': self.subEvent} if self.subEvent else {'NULL': True},
            'account': {'S': self.account} if self.account else {'NULL': True},
            'subjects': {'M': {k: {'S': v} for k, v in self.subjects.items()}} if self.subjects else {'NULL': True},
            'languages': {'M': {k: {'BOOL': v} for k, v in self.languages.items()}} if self.languages else {'NULL': True},
            'createdBy': {'S': self.createdBy} if self.createdBy else {'NULL': True},
            'replyTo': {'S': self.replyTo} if self.replyTo else {'NULL': True},
            'fromName': {'S': self.fromName} if self.fromName else {'NULL': True},
            'zoomId': {'S': self.zoomId} if self.zoomId else {'NULL': True},
            'inPerson': {'BOOL': self.inPerson} if self.inPerson is not None else {'NULL': True},
            'config': {'M': {k: {'S': v} for k, v in self.config.items()}} if self.config else {'NULL': True},
            'testers': {'L': [{'S': tester} for tester in self.testers]} if self.testers else {'NULL': True},
            'sendContinuously': {'BOOL': self.sendContinuously},
            'sendUntil': {'NULL': True} if self.sendUntil is None else {'S': self.sendUntil},
            's3HTMLPaths': {'M': {k: {'S': v} for k, v in self.s3HTMLPaths.items()}} if self.s3HTMLPaths else {'NULL': True},
            'dryRunRecipients': {'L': [{'S': recipient} for recipient in self.dryRunRecipients]} if self.dryRunRecipients else {'NULL': True},
            'sendRecipients': {'L': [{'S': recipient} for recipient in self.sendRecipients]} if self.sendRecipients else {'NULL': True}
        }

    def __str__(self) -> str:
        """String representation"""
        return f"WorkOrder(id={self.id}, status={self.status.value}, steps={[step.dict() for step in self.steps]})"

    @classmethod
    def from_dict(cls, data: Dict) -> 'WorkOrder':
        """Create from either regular JSON or DynamoDB format"""
        # Handle both DynamoDB format and regular dict format
        if 'M' in data:
            data = data['M']
        
        # Convert steps from either format
        steps = []
        if 'steps' in data:
            steps_data = data['steps']
            
            # Handle DynamoDB format
            if isinstance(steps_data, dict) and 'L' in steps_data:
                steps_data = steps_data['L']
            
            for step_data in steps_data:
                if isinstance(step_data, dict):
                    steps.append(Step.from_dict(step_data))

        try:
            # Handle both DynamoDB and regular JSON formats
            if isinstance(data.get('id'), dict) and 'S' in data['id']:
                # DynamoDB format
                work_order = cls(
                    id=data['id']['S'],
                    email=data.get('email', {}).get('S', ''),
                    steps=steps,
                    status=WorkOrderStatus(data.get('status', {}).get('S', 'pending'))
                )
                
                # Set additional fields from DynamoDB format with better error handling
                work_order.eventCode = data.get('eventCode', {}).get('S')
                work_order.stage = data.get('stage', {}).get('S')
                work_order.subEvent = data.get('subEvent', {}).get('S')
                work_order.account = data.get('account', {}).get('S')
                
                # Handle subjects with better error handling
                subjects_data = data.get('subjects', {})
                if isinstance(subjects_data, dict) and 'M' in subjects_data:
                    try:
                        work_order.subjects = {}
                        for k, v in subjects_data['M'].items():
                            if isinstance(v, dict) and 'S' in v:
                                work_order.subjects[k] = v['S']
                            else:
                                work_order.subjects[k] = str(v)
                    except Exception as e:
                        print(f"[DEBUG] Error parsing subjects: {e}, subjects_data: {subjects_data}")
                        work_order.subjects = {}
                else:
                    work_order.subjects = {}
                
                # Handle languages with better error handling
                languages_data = data.get('languages', {})
                if isinstance(languages_data, dict) and 'M' in languages_data:
                    try:
                        work_order.languages = {}
                        for k, v in languages_data['M'].items():
                            if isinstance(v, dict) and 'BOOL' in v:
                                work_order.languages[k] = v['BOOL']
                            else:
                                work_order.languages[k] = bool(v)
                    except Exception as e:
                        print(f"[DEBUG] Error parsing languages: {e}, languages_data: {languages_data}")
                        work_order.languages = {}
                else:
                    work_order.languages = {}
                
                work_order.createdBy = data.get('createdBy', {}).get('S')
                work_order.replyTo = data.get('replyTo', {}).get('S')
                work_order.fromName = data.get('fromName', {}).get('S')
                work_order.zoomId = data.get('zoomId', {}).get('S')
                work_order.inPerson = data.get('inPerson', {}).get('BOOL')
                
                # Handle config with better error handling
                config_data = data.get('config', {})
                if isinstance(config_data, dict) and 'M' in config_data:
                    try:
                        work_order.config = {}
                        for k, v in config_data['M'].items():
                            if isinstance(v, dict) and 'S' in v:
                                work_order.config[k] = v['S']
                            else:
                                work_order.config[k] = str(v)
                    except Exception as e:
                        print(f"[DEBUG] Error parsing config: {e}, config_data: {config_data}")
                        work_order.config = {}
                else:
                    work_order.config = {}
                    
                return work_order
            else:
                # Regular JSON format
                work_order = cls(
                    id=data['id'],
                    email=data.get('email', ''),
                    steps=steps,
                    status=WorkOrderStatus(data.get('status', 'pending'))
                )
                # Set additional fields from regular format
                work_order.eventCode = data.get('eventCode')
                work_order.stage = data.get('stage')
                work_order.subEvent = data.get('subEvent')
                work_order.account = data.get('account')
                work_order.subjects = data.get('subjects', {})
                work_order.languages = data.get('languages', {})
                work_order.createdBy = data.get('createdBy')
                work_order.replyTo = data.get('replyTo')
                work_order.fromName = data.get('fromName')
                work_order.zoomId = data.get('zoomId')
                work_order.inPerson = data.get('inPerson', False)
                work_order.config = data.get('config', {})
                work_order.testers = data.get('testers', [])
                work_order.sendContinuously = data.get('sendContinuously', False)
                send_until = data.get('sendUntil')
                if isinstance(send_until, str):
                    try:
                        dt = datetime.fromisoformat(send_until)
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        work_order.sendUntil = dt
                    except Exception as e:
                        print(f"[DEBUG] Error parsing sendUntil: {e}, value: {send_until}")
                        work_order.sendUntil = None
                elif isinstance(send_until, datetime):
                    if send_until.tzinfo is None:
                        work_order.sendUntil = send_until.replace(tzinfo=timezone.utc)
                    else:
                        work_order.sendUntil = send_until
                else:
                    work_order.sendUntil = None
                work_order.s3HTMLPaths = data.get('s3HTMLPaths', {})
                work_order.dryRunRecipients = data.get('dryRunRecipients', [])
                work_order.sendRecipients = data.get('sendRecipients', [])
                return work_order
        except Exception as e:
            print(f"Error creating WorkOrder: {e}")
            print(f"Data structure: {data}")
            raise

class WorkOrderUpdate(BaseModel):
    updates: Dict[str, Any]
    id: str
    userPid: str = 'system' 