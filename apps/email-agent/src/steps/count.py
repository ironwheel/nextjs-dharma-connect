"""
Count step implementation for email work orders.
Counts the number of people who have received the email and those who will receive it.
"""

import asyncio
from typing import Dict, List, Any, Tuple
from ..models import WorkOrder, Step
from ..aws_client import AWSClient
from ..eligible import check_eligibility
from ..config import STUDENT_TABLE, POOLS_TABLE
from .shared import passes_stage_filter, build_campaign_string, code_to_full_language


class CountStep:
    def __init__(self, aws_client: AWSClient):
        self.aws_client = aws_client

    async def process(self, work_order: WorkOrder, step: Step) -> bool:
        """
        Process the Count step for a work order.
        
        Args:
            work_order: The work order to process
            step: The step being processed
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Update initial progress message
            await self._update_progress(work_order, "Starting count process...")
            
            # Get campaign string
            campaign_string = build_campaign_string(work_order.eventCode, work_order.subEvent, work_order.stage, self._get_language_code(work_order))
            await self._update_progress(work_order, f"Campaign string: {campaign_string}")
            
            # Get stage record for filtering
            stage_record = self._get_stage_record(work_order.stage)
            
            # Scan both tables
            await self._update_progress(work_order, f"Scanning student table: {STUDENT_TABLE}")
            student_data = self.aws_client.scan_table(STUDENT_TABLE)
            await self._update_progress(work_order, f"Found {len(student_data)} student records")
            
            await self._update_progress(work_order, f"Scanning pools table: {POOLS_TABLE}")
            pools_data = self.aws_client.scan_table(POOLS_TABLE)
            await self._update_progress(work_order, f"Found {len(pools_data)} pool definitions")
            
            # Count recipients
            await self._update_progress(work_order, "Processing student records for eligibility...")
            received_count, will_receive_count = self._count_recipients_simple(
                student_data, pools_data, work_order, campaign_string, stage_record
            )
            
            total_count = received_count + will_receive_count
            success_message = f"Already received: {received_count}, Will send: {will_receive_count}, Total: {total_count}"
            
            await self._update_progress(work_order, success_message)
            
            # Update the step message with the counts
            step.message = success_message
            
            return True
            
        except Exception as e:
            error_message = str(e)
            print(f"[ERROR] [CountStep] Error in count process: {error_message}")
            await self._update_progress(work_order, f"Error: {error_message}")
            raise Exception(error_message)

    def _get_language_code(self, work_order: WorkOrder) -> str:
        """Get the primary language code from work order languages"""
        if work_order.languages and isinstance(work_order.languages, dict):
            # Get the first language code available
            for lang in work_order.languages.keys():
                if lang:
                    return lang.upper()
        return "EN"

    def _get_stage_record(self, stage: str) -> Dict:
        """Get the stage record from DynamoDB stages table"""
        try:
            stages_table = self.aws_client.get_table_name('stages')
            if stages_table:
                stage_record = self.aws_client.get_item(stages_table, {'stage': stage})
                return stage_record or {}
        except Exception as e:
            print(f"[WARNING] Failed to get stage record for {stage}: {e}")
        return {}

    def _count_recipients_simple(self, student_data: List[Dict], pools_data: List[Dict], 
                                work_order: WorkOrder, campaign_string: str, stage_record: Dict) -> Tuple[int, int]:
        """
        Simplified count logic - only check unsubscribe status and campaign string presence.
        Adds language eligibility logic as described by user.
        """
        received_count = 0
        will_receive_count = 0
        selected_lang_codes = set(work_order.languages.keys())
        has_english = 'EN' in selected_lang_codes
        selected_full_names = set(code_to_full_language(code).lower() for code in selected_lang_codes)
        
        for student in student_data:
            # Skip if unsubscribe is true
            if student.get('unsubscribe', False):
                continue
            
            # Check if already received the email
            emails = student.get('emails', {})
            has_received = campaign_string in emails
            if has_received:
                received_count += 1
                continue
            
            # Language eligibility check
            if not has_english:
                written_lang = student.get('writtenLangPref')
                if not written_lang or written_lang.lower() not in selected_full_names:
                    continue
            
            # For "will receive" count, apply all filters
            pool_name = work_order.config.get('pool') if hasattr(work_order, 'config') and work_order.config else None
            if not pool_name:
                continue
                
            is_eligible = check_eligibility(
                pool_name, student, work_order.eventCode, pools_data
            )
            
            if not is_eligible:
                continue
            
            # Apply stage-specific filtering using shared function
            if passes_stage_filter(stage_record, self._create_eligible_object(student, work_order.eventCode, pools_data)):
                will_receive_count += 1
        
        return received_count, will_receive_count

    def _create_eligible_object(self, student: Dict, event_code: str, pools_data: List[Dict]):
        """Create an object with check_eligibility method for the shared function"""
        class EligibleChecker:
            def __init__(self, student, event_code, pools_data):
                self.student = student
                self.event_code = event_code
                self.pools_data = pools_data
            
            def check_eligibility(self, pool_name):
                return check_eligibility(pool_name, self.student, self.event_code, self.pools_data)
        
        return EligibleChecker(student, event_code, pools_data)

    async def _update_progress(self, work_order: WorkOrder, message: str):
        """Update the work order progress message."""
        if self.aws_client:
            try:
                # Get current steps and update the Count step message
                current_work_order = self.aws_client.get_work_order(work_order.id)
                if current_work_order:
                    steps = current_work_order.steps.copy()
                    for i, s in enumerate(steps):
                        if s.name == 'Count':
                            steps[i] = Step(
                                name='Count',
                                status=s.status,
                                message=message,
                                isActive=s.isActive,
                                startTime=s.startTime,
                                endTime=s.endTime
                            )
                            break
                    
                    # Convert steps to plain dicts and update
                    plain_steps = []
                    for s in steps:
                        plain_steps.append({
                            'name': s.name,
                            'status': s.status.value if hasattr(s.status, 'value') else s.status,
                            'message': s.message,
                            'isActive': s.isActive,
                            'startTime': s.startTime,
                            'endTime': s.endTime
                        })
                    
                    self.aws_client.update_work_order({
                        'id': work_order.id,
                        'updates': {'steps': plain_steps}
                    })
                    print(f"[PROGRESS] {message}")
            except Exception as e:
                print(f"[WARNING] Failed to update progress message: {e}")
        else:
            print(f"[PROGRESS] {message}") 