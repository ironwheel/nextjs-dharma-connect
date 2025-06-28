"""
Send-Continuously step implementation for email work orders.
Continuously sends emails to eligible students until the sendUntil date is reached.
"""

import asyncio
import time
from datetime import datetime, timezone
from typing import Dict, List, Any
from ..models import WorkOrder, Step, StepStatus
from ..aws_client import AWSClient
from ..email import send_email
from ..eligible import check_eligibility
from ..config import STUDENT_TABLE, POOLS_TABLE, PROMPTS_TABLE, EVENTS_TABLE, EMAIL_BURST_SIZE, EMAIL_RECOVERY_SLEEP_SECS, EMAIL_CONTINUOUS_SLEEP_SECS
from .shared import build_campaign_string, passes_stage_filter, code_to_full_language, find_eligible_students


async def async_interruptible_sleep(total_seconds, work_order, aws_client, check_interval=1):
    slept = 0
    while slept < total_seconds:
        await asyncio.sleep(min(check_interval, total_seconds - slept))
        slept += min(check_interval, total_seconds - slept)
        # Reload work order and check stopRequested
        latest = aws_client.get_work_order(work_order.id)
        if latest and getattr(latest, 'stopRequested', False):
            raise InterruptedError('Step interrupted by stop request')


class SendContinuouslyStep:
    def __init__(self, aws_client: AWSClient):
        self.aws_client = aws_client

    async def process(self, work_order: WorkOrder, step: Step) -> bool:
        """
        Process the Send-Continuously step for a work order.
        
        Args:
            work_order: The work order to process
            step: The step being processed
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Update initial progress message
            await self._update_progress(work_order, "Starting continuous send process...")
            
            # Validate sendUntil date
            if not work_order.sendUntil:
                raise Exception("sendUntil date is required for continuous sending")
            
            send_until_date = datetime.fromisoformat(work_order.sendUntil.replace('Z', '+00:00'))
            start_time = datetime.now(timezone.utc)
            
            await self._update_progress(work_order, f"Continuous sending until {work_order.sendUntil}")
            
            # Get required data (do this once before language loop)
            await self._update_progress(work_order, "Loading required data...")
            
            # Get pools data
            pools_data = self.aws_client.scan_table(POOLS_TABLE)
            await self._update_progress(work_order, f"Loaded {len(pools_data)} pool definitions")
            
            # Get prompts data
            prompts_data = self.aws_client.scan_table(PROMPTS_TABLE)
            await self._update_progress(work_order, f"Loaded {len(prompts_data)} prompt definitions")
            
            # Get event data
            event_data = self.aws_client.get_event(work_order.eventCode)
            if not event_data:
                raise Exception(f"Event {work_order.eventCode} not found")
            await self._update_progress(work_order, f"Loaded event data for {work_order.eventCode}")
            
            # Validate that S3 HTML paths are available
            if not work_order.s3HTMLPaths:
                raise Exception("No S3 HTML paths found. Prepare step must be completed first.")
            
            # Continuous sending loop
            cycle_count = 0
            total_emails_sent = 0
            
            while datetime.now(timezone.utc) < send_until_date:
                # Check for stop request before starting each cycle
                latest_work_order = self.aws_client.get_work_order(work_order.id)
                if latest_work_order and getattr(latest_work_order, 'stopRequested', False):
                    await self._update_progress(work_order, "Step interrupted by stop request.")
                    step.status = StepStatus.INTERRUPTED
                    step.message = "Step interrupted by stop request."
                    return False
                
                cycle_count += 1
                await self._update_progress(work_order, f"Starting cycle {cycle_count}...")
                
                # Scan student table (fresh scan each cycle)
                student_data = self.aws_client.scan_table(STUDENT_TABLE)
                await self._update_progress(work_order, f"Cycle {cycle_count}: Loaded {len(student_data)} student records")
                
                # Process each language in the work order
                cycle_emails_sent = 0
                
                for lang in work_order.languages.keys():
                    if not work_order.languages[lang]:
                        continue  # Skip disabled languages
                    
                    await self._update_progress(work_order, f"Cycle {cycle_count}: Processing {lang} language...")
                    
                    # Get campaign string for this language
                    campaign_string = build_campaign_string(work_order.eventCode, work_order.subEvent, work_order.stage, lang)
                    await self._update_progress(work_order, f"Cycle {cycle_count}: Campaign string for {lang}: {campaign_string}")
                    
                    # Find eligible students for this language
                    eligible_students = find_eligible_students(
                        student_data, pools_data, work_order, campaign_string, self._get_stage_record(work_order.stage), lang, self._create_eligible_object
                    )
                    
                    await self._update_progress(work_order, f"Cycle {cycle_count}: Found {len(eligible_students)} eligible students for {lang}")
                    
                    if len(eligible_students) == 0:
                        await self._update_progress(work_order, f"Cycle {cycle_count}: No eligible students found for {lang}")
                        continue
                    
                    # Send emails for this language
                    for i, student in enumerate(eligible_students):
                        # Check for stop request before processing each student
                        latest_work_order = self.aws_client.get_work_order(work_order.id)
                        if latest_work_order and getattr(latest_work_order, 'stopRequested', False):
                            await self._update_progress(work_order, "Step interrupted by stop request.")
                            step.status = StepStatus.INTERRUPTED
                            step.message = "Step interrupted by stop request."
                            return False
                        
                        # Also check for new stop messages in SQS (every 5 students)
                        if i % 5 == 0:
                            if self.aws_client.check_for_stop_messages(work_order.id):
                                await self._update_progress(work_order, "Step interrupted by stop request.")
                                step.status = StepStatus.INTERRUPTED
                                step.message = "Step interrupted by stop request."
                                return False
                        
                        try:
                            success = await self._send_student_email(
                                student, lang, work_order, event_data, pools_data, prompts_data, campaign_string
                            )
                            if success:
                                cycle_emails_sent += 1
                                total_emails_sent += 1
                        except Exception as e:
                            # Email failure is terminal - stop processing and report error
                            error_message = f"Email sending failed for {lang}: {str(e)}"
                            await self._update_progress(work_order, error_message)
                            raise Exception(error_message)
                        
                        # Progress update
                        if (i + 1) % 10 == 0:
                            await self._update_progress(work_order, f"Cycle {cycle_count}: Processed {i + 1}/{len(eligible_students)} students for {lang}, sent {cycle_emails_sent} emails")
                        
                        # Burst control
                        if (i + 1) % EMAIL_BURST_SIZE == 0 and i + 1 < len(eligible_students):
                            await self._update_progress(work_order, f"Cycle {cycle_count}: Burst limit reached for {lang}, sleeping for {EMAIL_RECOVERY_SLEEP_SECS} seconds...")
                            try:
                                await async_interruptible_sleep(EMAIL_RECOVERY_SLEEP_SECS, work_order, self.aws_client)
                            except InterruptedError:
                                await self._update_progress(work_order, "Step interrupted by stop request.")
                                step.status = StepStatus.INTERRUPTED
                                step.message = "Step interrupted by stop request."
                                return False
                    
                    await self._update_progress(work_order, f"Cycle {cycle_count}: Completed {lang} language")
                
                await self._update_progress(work_order, f"Cycle {cycle_count}: Sent {cycle_emails_sent} emails")
                
                # Check if we've reached the sendUntil date
                if datetime.now(timezone.utc) >= send_until_date:
                    break
                
                # Sleep before next cycle
                await self._update_progress(work_order, f"Cycle {cycle_count} complete, sleeping for {EMAIL_CONTINUOUS_SLEEP_SECS} seconds...")
                try:
                    await async_interruptible_sleep(EMAIL_CONTINUOUS_SLEEP_SECS, work_order, self.aws_client)
                except InterruptedError:
                    await self._update_progress(work_order, "Step interrupted by stop request.")
                    step.status = StepStatus.INTERRUPTED
                    step.message = "Step interrupted by stop request."
                    return False
            
            # Calculate runtime
            end_time = datetime.now(timezone.utc)
            runtime = end_time - start_time
            days = runtime.days
            hours, remainder = divmod(runtime.seconds, 3600)
            minutes, seconds = divmod(remainder, 60)
            
            success_message = f"Continuous sending completed. Ran for {days}d {hours}h {minutes}m {seconds}s, completed {cycle_count} cycles, sent {total_emails_sent} total emails."
            await self._update_progress(work_order, success_message)
            
            # Update the step message with the results
            step.message = success_message
            
            return True
            
        except Exception as e:
            error_message = str(e)
            print(f"[ERROR] [SendContinuouslyStep] Error in continuous send process: {error_message}")
            await self._update_progress(work_order, f"Error: {error_message}")
            raise Exception(error_message)

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

    async def _send_student_email(self, student: Dict, language: str, work_order: WorkOrder, 
                                 event_data: Dict, pools_data: List[Dict], prompts_data: List[Dict], 
                                 campaign_string: str) -> bool:
        """
        Send an email to a specific student in a specific language.
        
        Args:
            student: Student record
            language: Language code
            work_order: Work order being processed
            event_data: Event data
            pools_data: Pools data
            prompts_data: Prompts data
            campaign_string: Campaign string
            
        Returns:
            True if successful, raises Exception if failed
        """
        try:
            # Get HTML content from S3
            if language not in work_order.s3HTMLPaths:
                raise Exception(f"No S3 path found for language {language}")
            
            s3_url = work_order.s3HTMLPaths[language]
            html_content = self.aws_client.get_s3_object_content(s3_url)
            if not html_content:
                raise Exception(f"Failed to retrieve HTML content from S3 for language {language}, URL: {s3_url}")
            
            # Get subject for this language
            subject = work_order.subjects.get(language, f"Email for {language}")
            
            # Send the email
            success = send_email(
                html=html_content,
                subject=subject,
                language=language,
                account=work_order.account,
                student=student,
                event=event_data,
                pools_array=pools_data,
                prompts_array=prompts_data,
                dryrun=False
            )
            
            if not success:
                raise Exception(f"send_email() returned False for student {student.get('email')} in language {language}")
            
            # Record the campaign string in the student's emails field
            emails = student.get('emails', {})
            emails[campaign_string] = True
            
            # Update the student record in DynamoDB
            self.aws_client.update_student_emails(student['id'], emails)
            
            return True
            
        except Exception as e:
            error_msg = f"Error sending email to {student.get('email')} in {language}: {str(e)}"
            print(f"[ERROR] {error_msg}")
            raise Exception(error_msg)

    async def _update_progress(self, work_order: WorkOrder, message: str):
        """Update the work order progress message."""
        if self.aws_client:
            try:
                # Get current steps and update the Send-Continuously step message
                current_work_order = self.aws_client.get_work_order(work_order.id)
                if current_work_order:
                    steps = current_work_order.steps.copy()
                    for i, s in enumerate(steps):
                        if s.name == 'Send-Continuously':
                            steps[i] = Step(
                                name='Send-Continuously',
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