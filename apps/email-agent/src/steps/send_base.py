"""
Base class for email sending steps (Dry-Run and Send-Once).
Provides shared functionality for scanning students and sending emails.
"""

import asyncio
import time
from typing import Dict, List, Any, Tuple
from datetime import datetime, timezone
from ..models import WorkOrder, Step, StepStatus
from ..aws_client import AWSClient
from ..email_sender import send_email
from ..eligible import check_eligibility
from ..config import STUDENT_TABLE, POOLS_TABLE, PROMPTS_TABLE, EVENTS_TABLE, EMAIL_BURST_SIZE, EMAIL_RECOVERY_SLEEP_SECS, SMTP_24_HOUR_SEND_LIMIT
from .shared import passes_stage_filter, build_campaign_string, code_to_full_language, get_stage_prefix, find_eligible_students


async def async_interruptible_sleep(total_seconds, work_order, aws_client, check_interval=1):
    slept = 0
    while slept < total_seconds:
        await asyncio.sleep(min(check_interval, total_seconds - slept))
        slept += min(check_interval, total_seconds - slept)
        # Reload work order and check stopRequested
        latest = aws_client.get_work_order(work_order.id)
        if latest and getattr(latest, 'stopRequested', False):
            raise InterruptedError('Step interrupted by stop request')

class SendBaseStep:
    def __init__(self, aws_client: AWSClient, step_name: str, dryrun: bool, logging_config=None):
        self.aws_client = aws_client
        self.step_name = step_name  # Display name (e.g., "Send-Once", "Send-Continuously", "Dry-Run")
        self.actual_step_name = "Send"  # Actual step name in work order (always "Send")
        self.dryrun = dryrun
        self.logging_config = logging_config

    def log(self, level, message):
        """Log a message if the level is enabled."""
        if self.logging_config:
            self.logging_config.log(level, message)
        else:
            # Fallback to always logging if no config provided
            print(message)

    async def process(self, work_order: WorkOrder, step: Step) -> bool:
        """
        Process the sending step for a work order.
        
        Args:
            work_order: The work order to process
            step: The step being processed
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Update initial progress message
            await self._update_progress(work_order, f"Starting {self.step_name.lower()} process...", step.name)
            
            # For actual sends (not dry-runs), check the 24-hour send limit for this account
            if not self.dryrun and work_order.account:
                await self._update_progress(work_order, f"Checking 24-hour send limit for account '{work_order.account}'...", step.name)
                emails_sent_in_last_24h = self.aws_client.count_emails_sent_by_account_in_last_24_hours(work_order.account)
                self.log('progress', f"[LIMIT-CHECK] Account '{work_order.account}' has sent {emails_sent_in_last_24h} emails in the last 24 hours (limit: {SMTP_24_HOUR_SEND_LIMIT})")
                
                if emails_sent_in_last_24h >= SMTP_24_HOUR_SEND_LIMIT:
                    error_message = f"24-hour send limit reached for account '{work_order.account}'. Sent {emails_sent_in_last_24h}/{SMTP_24_HOUR_SEND_LIMIT} emails in the last 24 hours. Please wait before sending more emails."
                    await self._update_progress(work_order, error_message, step.name)
                    raise Exception(error_message)
                
                remaining = SMTP_24_HOUR_SEND_LIMIT - emails_sent_in_last_24h
                await self._update_progress(work_order, f"Account '{work_order.account}' has {remaining} emails remaining in 24-hour limit", step.name)
            
            # Get stage record for filtering and prefix
            stage_record = self._get_stage_record(work_order.stage)
            
            # Get required data (do this once before language loop)
            await self._update_progress(work_order, "Loading required data...", step.name)
            
            # Scan student table
            student_data = self.aws_client.scan_table(STUDENT_TABLE)
            await self._update_progress(work_order, f"Loaded {len(student_data)} student records", step.name)
            
            # Get pools data
            pools_data = self.aws_client.scan_table(POOLS_TABLE)
            await self._update_progress(work_order, f"Loaded {len(pools_data)} pool definitions", step.name)
            
            # Get prompts data
            prompts_data = self.aws_client.scan_table(PROMPTS_TABLE)
            await self._update_progress(work_order, f"Loaded {len(prompts_data)} prompt definitions", step.name)
            
            # Get event data
            event_data = self.aws_client.get_event(work_order.eventCode)
            if not event_data:
                raise Exception(f"Event {work_order.eventCode} not found")
            await self._update_progress(work_order, f"Loaded event data for {work_order.eventCode}", step.name)
            
            # Validate that S3 HTML paths are available
            if not work_order.s3HTMLPaths:
                raise Exception("No S3 HTML paths found. Prepare step must be completed first.")
            
            # Process each language in the work order
            total_emails_sent = 0
            
            for lang in work_order.languages.keys():
                if not work_order.languages[lang]:
                    continue  # Skip disabled languages
                
                # Check send limit before starting each language (for non-dry-runs)
                if not self.dryrun and work_order.account and total_emails_sent > 0:
                    emails_sent_in_last_24h = self.aws_client.count_emails_sent_by_account_in_last_24_hours(work_order.account)
                    if emails_sent_in_last_24h >= SMTP_24_HOUR_SEND_LIMIT:
                        error_message = f"24-hour send limit reached before processing {lang}. Sent {emails_sent_in_last_24h}/{SMTP_24_HOUR_SEND_LIMIT} emails in the last 24 hours. Stopping to avoid exceeding limit."
                        await self._update_progress(work_order, error_message, step.name)
                        self.log('progress', f"[LIMIT-CHECK] Skipping remaining languages. Total sent in 24h: {emails_sent_in_last_24h}/{SMTP_24_HOUR_SEND_LIMIT}")
                        raise Exception(error_message)
                
                await self._update_progress(work_order, f"Processing {lang} language...", step.name)
                
                # Get campaign string for this language
                campaign_string = build_campaign_string(work_order.eventCode, work_order.subEvent, work_order.stage, lang)
                await self._update_progress(work_order, f"Campaign string for {lang}: {campaign_string}", step.name)
                
                # For dry runs, delete existing recipient records before beginning
                if self.dryrun:
                    await self._update_progress(work_order, f"Clearing existing dry run records for {lang}...", step.name)
                    self.aws_client.delete_dryrun_recipients(campaign_string)
                
                # Find eligible students for this language
                await self._update_progress(work_order, f"Finding eligible students for {lang}...", step.name)
                eligible_students = find_eligible_students(
                    student_data, pools_data, work_order, campaign_string, stage_record, lang, self._create_eligible_object
                )
                
                await self._update_progress(work_order, f"Found {len(eligible_students)} eligible students for {lang}", step.name)
                
                # Instead, append each recipient to the new tables as they are processed

                # Send emails for this language
                emails_sent = 0
                total_emails_for_lang = len(eligible_students)
                
                await self._update_progress(work_order, f"Sending {total_emails_for_lang} emails for {lang}...", step.name)
                
                for i, student in enumerate(eligible_students):
                    # Check for stop request before processing each student
                    latest_work_order = self.aws_client.get_work_order(work_order.id)
                    if latest_work_order and getattr(latest_work_order, 'stopRequested', False):
                        await self._update_progress(work_order, "Step interrupted by stop request.", step.name)
                        step.status = StepStatus.INTERRUPTED
                        step.message = "Step interrupted by stop request."
                        return False
                    
                    # Also check for new stop messages in SQS (every 5 students)
                    if i % 5 == 0:
                        if self.aws_client.check_for_stop_messages(work_order.id):
                            await self._update_progress(work_order, "Step interrupted by stop request.", step.name)
                            step.status = StepStatus.INTERRUPTED
                            step.message = "Step interrupted by stop request."
                            return False
                    
                    # Periodic send limit check (every 10 emails for non-dry-runs)
                    if not self.dryrun and work_order.account and i > 0 and i % 10 == 0:
                        emails_sent_in_last_24h = self.aws_client.count_emails_sent_by_account_in_last_24_hours(work_order.account)
                        if emails_sent_in_last_24h >= SMTP_24_HOUR_SEND_LIMIT:
                            error_message = f"24-hour send limit reached during sending for account '{work_order.account}'. Sent {emails_sent_in_last_24h}/{SMTP_24_HOUR_SEND_LIMIT} emails in the last 24 hours. Stopping to avoid exceeding limit."
                            await self._update_progress(work_order, error_message, step.name)
                            self.log('progress', f"[LIMIT-CHECK] Stopping send for {lang} after {emails_sent} emails. Total sent in 24h: {emails_sent_in_last_24h}/{SMTP_24_HOUR_SEND_LIMIT}")
                            # Mark this as reaching the limit but still successful for the emails sent so far
                            raise Exception(error_message)
                    
                    try:
                        success = await self._send_student_email(
                            student, lang, work_order, event_data, pools_data, prompts_data, campaign_string, stage_record
                        )
                        if success:
                            emails_sent += 1
                            total_emails_sent += 1
                            # Append to send_recipients table
                            entry = {
                                "name": f"{student.get('first', '')} {student.get('last', '')}".strip(),
                                "email": student.get("email"),
                                "sendtime": datetime.now(timezone.utc).isoformat()
                            }
                            if self.dryrun:
                                self.aws_client.append_dryrun_recipient(campaign_string, entry)
                            else:
                                self.aws_client.append_send_recipient(campaign_string, entry, work_order.account)
                    except Exception as e:
                        # Email failure is terminal - stop processing and report error
                        error_message = f"Email sending failed for {lang}: {str(e)}"
                        await self._update_progress(work_order, error_message, step.name)
                        raise Exception(error_message)
                    
                    # Progress update
                    if (i + 1) % 10 == 0:
                        await self._update_progress(work_order, f"Processed {i + 1}/{len(eligible_students)} students for {lang}, sent {emails_sent} emails", step.name)
                    
                    # Burst control (only for Send-Once and Send-Continuously)
                    if not self.dryrun:
                        if (i + 1) % EMAIL_BURST_SIZE == 0 and i + 1 < len(eligible_students):
                            self.log('progress', f"[BURST] Starting burst control sleep for {EMAIL_RECOVERY_SLEEP_SECS} seconds...")
                            await self._update_progress(work_order, f"Burst limit reached for {lang}, sleeping for {EMAIL_RECOVERY_SLEEP_SECS} seconds...", step.name)
                            try:
                                await async_interruptible_sleep(EMAIL_RECOVERY_SLEEP_SECS, work_order, self.aws_client)
                                self.log('progress', f"[BURST] Burst control sleep completed, resuming email sending...")
                            except InterruptedError:
                                await self._update_progress(work_order, "Step interrupted by stop request.", step.name)
                                step.status = StepStatus.INTERRUPTED
                                step.message = "Step interrupted by stop request."
                                return False
                
                await self._update_progress(work_order, f"Completed {lang} language, sent {emails_sent} emails", step.name)
            
            # Final send limit verification (for non-dry-runs)
            if not self.dryrun and work_order.account:
                final_count = self.aws_client.count_emails_sent_by_account_in_last_24_hours(work_order.account)
                self.log('progress', f"[LIMIT-CHECK] Final verification - Account '{work_order.account}' has sent {final_count}/{SMTP_24_HOUR_SEND_LIMIT} emails in the last 24 hours")
            
            if self.dryrun:
                success_message = f"Dry-Run completed successfully. {total_emails_sent} emails would have been sent."
            else:
                success_message = f"{self.step_name} completed successfully. Sent {total_emails_sent} total emails."
            await self._update_progress(work_order, success_message, step.name)
            step.message = success_message
            return True
            
        except Exception as e:
            error_message = str(e)
            self.log('error', f"[ERROR] [{self.step_name}Step] Error in {self.step_name.lower()} process: {error_message}")
            await self._update_progress(work_order, f"Error: {error_message}", step.name)
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

    def _create_eligible_object(self, student: Dict, event_code: str, pools_data: List[Dict], sub_event: str):
        """Create an object with check_eligibility method for the shared function"""
        class EligibleChecker:
            def __init__(self, student, event_code, pools_data, sub_event):
                self.student = student
                self.event_code = event_code
                self.pools_data = pools_data
                self.sub_event = sub_event
            
            def check_eligibility(self, pool_name):
                return check_eligibility(pool_name, self.student, self.event_code, self.pools_data, self.sub_event)
        
        return EligibleChecker(student, event_code, pools_data, sub_event)

    async def _send_student_email(self, student: Dict, language: str, work_order: WorkOrder, 
                                 event_data: Dict, pools_data: List[Dict], prompts_data: List[Dict], 
                                 campaign_string: str, stage_record: Dict) -> bool:
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
            stage_record: Stage record from DynamoDB
            
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
            
            # Apply stage-specific prefix if defined
            prefix = get_stage_prefix(stage_record, language)
            if prefix:
                subject = f"{prefix}{subject}"

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
                dryrun=self.dryrun
            )
            
            if not success:
                raise Exception(f"send_email() returned False for student {student.get('email')} in language {language}")
            
            if not self.dryrun:
                # Record the campaign string in the student's emails field with ISO 8601 timestamp
                emails = student.get('emails', {})
                emails[campaign_string] = datetime.utcnow().isoformat()
                
                # Update the student record in DynamoDB
                self.aws_client.update_student_emails(student['id'], emails)
            
            return True
            
        except Exception as e:
            error_msg = f"Error sending email to {student.get('email')} in {language}: {str(e)}"
            self.log('error', f"[ERROR] {error_msg}")
            raise Exception(error_msg)

    async def _update_progress(self, work_order: WorkOrder, message: str, step_name: str = None):
        """Update the work order progress message."""
        # Use the provided step_name or fall back to self.actual_step_name for backward compatibility
        target_step_name = step_name or self.actual_step_name
        
        if self.aws_client:
            try:
                # Get current steps and update the step message
                current_work_order = self.aws_client.get_work_order(work_order.id)
                if current_work_order:
                    steps = current_work_order.steps.copy()
                    for i, s in enumerate(steps):
                        if s.name == target_step_name:
                            steps[i] = Step(
                                name=target_step_name,
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