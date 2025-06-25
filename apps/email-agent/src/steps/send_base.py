"""
Base class for email sending steps (Dry-Run and Send-Once).
Provides shared functionality for scanning students and sending emails.
"""

import asyncio
import time
from typing import Dict, List, Any, Tuple
from ..models import WorkOrder, Step, StepStatus
from ..aws_client import AWSClient
from ..email import send_email
from ..eligible import check_eligibility
from ..config import STUDENT_TABLE, POOLS_TABLE, PROMPTS_TABLE, EVENTS_TABLE, EMAIL_BURST_SIZE, EMAIL_RECOVERY_SLEEP_SECS


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
    def __init__(self, aws_client: AWSClient, step_name: str, dryrun: bool):
        self.aws_client = aws_client
        self.step_name = step_name
        self.dryrun = dryrun
    
    LANG_CODE_TO_NAME = {
        "EN": "English",
        "FR": "French",
        "ES": "Spanish",
        "DE": "German",
        "IT": "Italian",
        "CZ": "Czech",
        "PT": "Portuguese"
    }
    LANG_NAME_TO_CODE = {v: k for k, v in LANG_CODE_TO_NAME.items()}

    OFFERING_REMINDER_PREFIX = {
        "EN": "Offering Reminder: ",
        "FR": "Rappel d'offrande : ",
        "SP": "Recordatorio de ofrenda: ",
        "DE": "Spenden-Erinnerung: ",
        "IT": "Promemoria dell'offerta: ",
        "CZ": "Připomenutí příspěvku: ",
        "PT": "Lembrete de oferta: "
    }

    def code_to_full_language(self, code):
        return self.LANG_CODE_TO_NAME.get(code.upper(), code)

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
            await self._update_progress(work_order, f"Starting {self.step_name.lower()} process...")
            
            # Get campaign string
            campaign_string = self._build_campaign_string(work_order)
            await self._update_progress(work_order, f"Campaign string: {campaign_string}")
            
            # Get required data
            await self._update_progress(work_order, "Loading required data...")
            
            # Scan student table
            student_data = self.aws_client.scan_table(STUDENT_TABLE)
            await self._update_progress(work_order, f"Loaded {len(student_data)} student records")
            
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
            
            # Find eligible students
            await self._update_progress(work_order, "Finding eligible students...")
            eligible_students = self._find_eligible_students(
                student_data, pools_data, work_order, campaign_string
            )

            # For Dry-Run, store the recipient preview in the work order
            if self.dryrun:
                dry_run_recipients = [
                    {
                        "id": s.get("id"),
                        "name": f"{s.get('first', '')} {s.get('last', '')}".strip(),
                        "email": s.get("email")
                    }
                    for s in eligible_students
                ]
                self.aws_client.update_work_order({
                    "id": work_order.id,
                    "updates": {"dryRunRecipients": dry_run_recipients}
                })

            await self._update_progress(work_order, f"Found {len(eligible_students)} eligible students")
            
            # Send emails
            emails_sent = 0
            total_emails = len(eligible_students) * len(work_order.languages)
            
            await self._update_progress(work_order, f"Sending {total_emails} emails...")
            
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
                
                # Send English email (always)
                if 'EN' in work_order.languages and work_order.languages['EN']:
                    try:
                        success = await self._send_student_email(
                            student, 'EN', work_order, event_data, pools_data, prompts_data, campaign_string
                        )
                        if success:
                            emails_sent += 1
                    except Exception as e:
                        # Email failure is terminal - stop processing and report error
                        error_message = f"Email sending failed: {str(e)}"
                        await self._update_progress(work_order, error_message)
                        raise Exception(error_message)
                
                # Send writtenLangPref email if different from English
                written_lang = student.get('writtenLangPref')
                if written_lang and written_lang != 'English':
                    lang_code = self.LANG_NAME_TO_CODE.get(written_lang)
                    if lang_code and lang_code in work_order.languages and work_order.languages[lang_code]:
                        try:
                            success = await self._send_student_email(
                                student, lang_code, work_order, event_data, pools_data, prompts_data, campaign_string
                            )
                            if success:
                                emails_sent += 1
                        except Exception as e:
                            error_message = f"Email sending failed: {str(e)}"
                            await self._update_progress(work_order, error_message)
                            raise Exception(error_message)
                
                # Progress update
                if (i + 1) % 10 == 0:
                    await self._update_progress(work_order, f"Processed {i + 1}/{len(eligible_students)} students, sent {emails_sent} emails")
                
                # Burst control (only for Send-Once and Send-Continuously)
                if not self.dryrun:
                    if (i + 1) % EMAIL_BURST_SIZE == 0 and i + 1 < len(eligible_students):
                        await self._update_progress(work_order, f"Burst limit reached, sleeping for {EMAIL_RECOVERY_SLEEP_SECS} seconds...")
                        try:
                            await async_interruptible_sleep(EMAIL_RECOVERY_SLEEP_SECS, work_order, self.aws_client)
                        except InterruptedError:
                            await self._update_progress(work_order, "Step interrupted by stop request.")
                            step.status = StepStatus.INTERRUPTED
                            step.message = "Step interrupted by stop request."
                            return False
            
            if self.dryrun:
                success_message = f"Dry-Run completed successfully. {emails_sent} emails would have been sent."
            else:
                success_message = f"{self.step_name} completed successfully. Sent {emails_sent} emails to {len(eligible_students)} students."
            await self._update_progress(work_order, success_message)
            step.message = success_message
            return True
            
        except Exception as e:
            error_message = str(e)
            print(f"[ERROR] [{self.step_name}Step] Error in {self.step_name.lower()} process: {error_message}")
            await self._update_progress(work_order, f"Error: {error_message}")
            raise Exception(error_message)

    def _build_campaign_string(self, work_order: WorkOrder) -> str:
        """
        Build the campaign string from work order data.
        Format: {eventCode}_{subEvent}_{stage}_{languageCode}
        """
        event_code = work_order.eventCode or ""
        sub_event = work_order.subEvent or ""
        stage = work_order.stage or ""

        # Stage fixup
        if stage == 'eligible' or stage == 'offering-reminder' or stage == 'reg-reminder':
            stage = 'reg'
        
        # Get language code from languages dict, default to "EN"
        language_code = "EN"
        if work_order.languages and isinstance(work_order.languages, dict):
            # Get the first language code available
            for lang in work_order.languages.keys():
                if lang:
                    language_code = lang.upper()
                    break
        
        campaign_string = f"{event_code}_{sub_event}_{stage}_{language_code}"
        return campaign_string

    def _find_eligible_students(self, student_data: List[Dict], pools_data: List[Dict], 
                               work_order: WorkOrder, campaign_string: str) -> List[Dict]:
        """
        Find eligible students using the same logic as count.py, with language eligibility logic.
        """
        eligible_students = []
        selected_lang_codes = set(work_order.languages.keys())
        has_english = 'EN' in selected_lang_codes
        selected_full_names = set(self.code_to_full_language(code).lower() for code in selected_lang_codes)
        
        for student in student_data:
            if student.get('unsubscribe', False):
                continue
            emails = student.get('emails', {})
            has_received = campaign_string in emails
            if has_received:
                continue
            # Language eligibility check
            if not has_english:
                written_lang = student.get('writtenLangPref')
                if not written_lang or written_lang.lower() not in selected_full_names:
                    continue
            pool_name = work_order.config.get('pool') if hasattr(work_order, 'config') and work_order.config else None
            if not pool_name:
                continue
            is_eligible = check_eligibility(
                pool_name, student, work_order.eventCode, pools_data
            )
            if not is_eligible:
                continue
            if self._passes_stage_filter(student, work_order):
                eligible_students.append(student)
        return eligible_students

    def _passes_stage_filter(self, student: Dict, work_order: WorkOrder) -> bool:
        """
        Apply stage-specific filtering logic.
        
        Args:
            student: Student record to check
            work_order: Work order being processed
            
        Returns:
            True if student passes stage filter, False otherwise
        """
        stage = work_order.stage
        event_code = work_order.eventCode
        
        # For std or reg stages, anyone who passed previous filters is eligible
        if stage in ['std', 'eligible']:
            return True
        
        # Get the program data for this event
        programs = student.get('programs', {})
        program = programs.get(event_code, {})

        if stage == 'reg':
            # join: true, withdrawn: false|undefined
            return (program.get('join', False) and 
                   not program.get('withdrawn', False))
        
        if stage == 'accept':
            # join: true, accepted: true, withdrawn: false|undefined
            return (program.get('join', False) and 
                   program.get('accepted', False) and 
                   not program.get('withdrawn', False))
        
        if stage == 'reg-confirm':
            # join: true, withdrawn: false|undefined, offeringHistory.<subevent>.offeringIntent: exists
            if not (program.get('join', False) and not program.get('withdrawn', False)):
                return False
            
            # Check if offeringIntent exists for the subevent
            sub_event = work_order.subEvent
            if not sub_event:
                return False
                
            offering_history = program.get('offeringHistory', {})
            subevent_data = offering_history.get(sub_event, {})
            return 'offeringIntent' in subevent_data
        
        if stage == 'offering-reminder':
            # join: true, withdrawn: false|undefined, offeringHistory.<subevent>.offeringIntent: does not exist
            if not (program.get('join', False) and not program.get('withdrawn', False)):
                return False
            
            # Check if offeringIntent exists for the subevent
            sub_event = work_order.subEvent
            if not sub_event:
                return False
                
            offering_history = program.get('offeringHistory', {})
            subevent_data = offering_history.get(sub_event, {})
            return 'offeringIntent' not in subevent_data
        
        # For other stages, return False
        return False

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
            if work_order.stage == 'offering-reminder':
                prefix = self.OFFERING_REMINDER_PREFIX.get(language, "Offering Reminder: ")
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
                # Get current steps and update the step message
                current_work_order = self.aws_client.get_work_order(work_order.id)
                if current_work_order:
                    steps = current_work_order.steps.copy()
                    for i, s in enumerate(steps):
                        if s.name == self.step_name:
                            steps[i] = Step(
                                name=self.step_name,
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