"""
Test step implementation for email work orders.
Sends test emails to selected testers in all languages.
"""

import asyncio
import time
from typing import Dict, List, Any
from ..models import WorkOrder, Step, StepStatus
from ..aws_client import AWSClient
from ..email_sender import send_email
from ..config import STUDENT_TABLE, POOLS_TABLE, PROMPTS_TABLE, EVENTS_TABLE


async def async_interruptible_sleep(total_seconds, work_order, aws_client, check_interval=1):
    slept = 0
    while slept < total_seconds:
        await asyncio.sleep(min(check_interval, total_seconds - slept))
        slept += min(check_interval, total_seconds - slept)
        # Reload work order and check stopRequested
        latest = aws_client.get_work_order(work_order.id)
        if latest and getattr(latest, 'stopRequested', False):
            raise InterruptedError('Step interrupted by stop request')

class TestStep:
    def __init__(self, aws_client: AWSClient, logging_config=None):
        self.aws_client = aws_client
        self.logging_config = logging_config

    OFFERING_REMINDER_PREFIX = {
        "EN": "Offering Reminder: ",
        "FR": "Rappel d'offrande : ",
        "SP": "Recordatorio de ofrenda: ",
        "DE": "Spenden-Erinnerung: ",
        "IT": "Promemoria dell'offerta: ",
        "CZ": "Připomenutí příspěvku: ",
        "PT": "Lembrete de oferta: "
    }

    async def process(self, work_order: WorkOrder, step: Step) -> bool:
        """
        Process the Test step for a work order.
        
        Args:
            work_order: The work order to process
            step: The step being processed
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Update initial progress message
            await self._update_progress(work_order, "Starting test email process...")
            
            # Validate that testers are selected
            if not work_order.testers or len(work_order.testers) == 0:
                raise Exception("No testers selected for test emails")
            
            await self._update_progress(work_order, f"Found {len(work_order.testers)} testers")
            
            # Get required data
            await self._update_progress(work_order, "Loading required data...")
            
            # Get testers' student data
            testers_data = []
            for tester_id in work_order.testers:
                student_data = self.aws_client.get_student(tester_id)
                if not student_data:
                    raise Exception(f"Tester {tester_id} not found in student table")
                testers_data.append(student_data)
            
            # Get pools data
            pools_data = self.aws_client.scan_table(POOLS_TABLE)
            await self._update_progress(work_order, f"Loaded {len(pools_data)} pool definitions")
            
            # Get prompts data for current event and default aid
            prompts_data = self.aws_client.scan_table(PROMPTS_TABLE)
            await self._update_progress(work_order, f"Loaded {len(prompts_data)} prompt definitions")
            
            # Get event data
            event_data = self.aws_client.get_event(work_order.eventCode)
            if not event_data:
                raise Exception(f"Event {work_order.eventCode} not found")
            await self._update_progress(work_order, f"Loaded event data for {work_order.eventCode}")
            
            # QA Check: Registration Link Availability
            # If the work order requires a registration link, ensure the event is marked as ready
            if getattr(work_order, 'regLinkPresent', False):
                sub_events = event_data.get('subEvents', {})
                sub_event_config = sub_events.get(work_order.subEvent, {})
                if not sub_event_config.get('regLinkAvailable', False):
                    raise ValueError("Registration form not ready")

            
            # Validate that S3 HTML paths are available
            if not work_order.s3HTMLPaths:
                raise Exception("No S3 HTML paths found. Prepare step must be completed first.")
            
            # Send test emails
            emails_sent = 0
            total_emails = len(testers_data) * len(work_order.languages)
            
            await self._update_progress(work_order, f"Sending {total_emails} test emails...")
            
            for tester in testers_data:
                for lang in work_order.languages.keys():
                    if not work_order.languages[lang]:
                        continue  # Skip disabled languages
                    
                    # Check for stop request before processing each email
                    latest_work_order = self.aws_client.get_work_order(work_order.id)
                    if latest_work_order and getattr(latest_work_order, 'stopRequested', False):
                        await self._update_progress(work_order, "Step interrupted by stop request.")
                        step.status = StepStatus.INTERRUPTED
                        step.message = "Step interrupted by stop request."
                        return False
                    
                    # Also check for new stop messages in SQS (every 3 emails)
                    if (emails_sent % 3) == 0:
                        if self.aws_client.check_for_stop_messages(work_order.id):
                            await self._update_progress(work_order, "Step interrupted by stop request.")
                            step.status = StepStatus.INTERRUPTED
                            step.message = "Step interrupted by stop request."
                            return False
                    
                    # Get HTML content from S3
                    if lang not in work_order.s3HTMLPaths:
                        await self._update_progress(work_order, f"Warning: No S3 path for language {lang}, skipping")
                        continue
                    
                    s3_url = work_order.s3HTMLPaths[lang]
                    html_content = self.aws_client.get_s3_object_content(s3_url)
                    if not html_content:
                        raise Exception(f"Failed to retrieve HTML content from S3 for language {lang}, URL: {s3_url}")
                    
                    # Get subject for this language
                    subject = work_order.subjects.get(lang, f"Test email for {lang}")
                    if work_order.stage == 'offering-reminder':
                        prefix = self.OFFERING_REMINDER_PREFIX.get(lang, "Offering Reminder: ")
                        subject = f"{prefix}{subject}"
                    test_subject = f"TEST: {subject}"
                    
                    # Send the test email
                    try:
                        success = send_email(
                            html=html_content,
                            subject=test_subject,
                            language=lang,
                            account=work_order.account,
                            student=tester,
                            event=event_data,
                            pools_array=pools_data,
                            prompts_array=prompts_data,
                            dryrun=False
                        )
                        
                        if success:
                            emails_sent += 1
                            await self._update_progress(work_order, f"Sent test email {emails_sent}/{total_emails} to {tester.get('email')} in {lang}")
                        else:
                            raise Exception(f"Failed to send test email to {tester.get('email')} in {lang}")
                    
                    except Exception as e:
                        raise Exception(f"Error sending test email to {tester.get('email')} in {lang}: {str(e)}")
                    
                    # Small delay between emails
                    try:
                        await async_interruptible_sleep(0.1, work_order, self.aws_client)
                    except InterruptedError:
                        await self._update_progress(work_order, "Step interrupted by stop request.")
                        step.status = StepStatus.INTERRUPTED
                        step.message = "Step interrupted by stop request."
                        return False
            
            success_message = f"Test step completed successfully. Sent {emails_sent} test emails to {len(testers_data)} testers."
            await self._update_progress(work_order, success_message)
            
            # Update the step message with the results
            step.message = success_message
            
            return True
            
        except InterruptedError:
            await self._update_progress(work_order, "Step interrupted by stop request.")
            step.status = StepStatus.INTERRUPTED
            step.message = "Step interrupted by stop request."
            return False
        except Exception as e:
            error_message = str(e)
            self.log('error', f"[ERROR] [TestStep] Error in test process: {error_message}")
            await self._update_progress(work_order, f"Error: {error_message}")
            raise Exception(error_message)

    async def _update_progress(self, work_order: WorkOrder, message: str):
        """Update the work order progress message."""
        if self.aws_client:
            try:
                # Get current steps and update the Test step message
                current_work_order = self.aws_client.get_work_order(work_order.id)
                if current_work_order:
                    steps = current_work_order.steps.copy()
                    for i, s in enumerate(steps):
                        if s.name == 'Test':
                            steps[i] = Step(
                                name='Test',
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
                    self.log('progress', f"[PROGRESS] {message}")
            except Exception as e:
                self.log('warning', f"[WARNING] Failed to update progress message: {e}")
        else:
            self.log('progress', f"[PROGRESS] {message}")

    def log(self, level, message):
        """Log a message if the level is enabled."""
        if self.logging_config:
            self.logging_config.log(level, message)
        else:
            # Fallback to always logging if no config provided
            print(message) 