import os
import requests
import time
import re
import boto3
from typing import Dict, Any, Optional
from ..models import WorkOrder, Step
from ..aws_client import AWSClient

class PrepareStep:
    """Handles the preparation step for email campaigns.
    
    This step is responsible for:
    1. Retrieving HTML content from Mailchimp templates
    2. QA checking the content
    3. Uploading to S3 for later use
    4. Updating embeddedEmails in the events table
    """
    
    def __init__(self, aws_client: AWSClient, logging_config=None):
        """Initialize the prepare step handler using environment variables."""
        self.aws_client = aws_client
        self.api_key = os.getenv('MAILCHIMP_API_KEY')
        self.server_prefix = os.getenv('MAILCHIMP_SERVER_PREFIX')
        self.audience_name = os.getenv('MAILCHIMP_AUDIENCE')
        self.reply_to = os.getenv('MAILCHIMP_REPLY_TO')
        self.s3_bucket = os.getenv('S3_BUCKET')
        self.logging_config = logging_config
        
        if not all([self.api_key, self.server_prefix, self.audience_name, self.reply_to, self.s3_bucket]):
            raise ValueError("Missing required environment variables: MAILCHIMP_API_KEY, MAILCHIMP_SERVER_PREFIX, MAILCHIMP_AUDIENCE, MAILCHIMP_REPLY_TO, S3_BUCKET")
        
        self.headers = {'Authorization': f'Bearer {self.api_key}'}

    def log(self, level, message):
        """Log a message if the level is enabled."""
        if self.logging_config:
            self.logging_config.log(level, message)
        else:
            # Fallback to always logging if no config provided
            print(message)

    async def process(self, work_order: WorkOrder, step: Step) -> bool:
        """
        Process the Prepare step for a work order.
        
        Args:
            work_order: The work order to process
            step: The current step being executed
            
        Returns:
            bool: True if the step completed successfully
            
        Raises:
            Exception: If any error occurs during processing
        """
        # Update initial progress message
        await self._update_progress(work_order, "Starting prepare step...")

        # Debug: Print Mailchimp config values before any API call
        self.log('debug', f"[DEBUG] MAILCHIMP_API_KEY: {self.api_key}")
        self.log('debug', f"[DEBUG] MAILCHIMP_SERVER_PREFIX: {self.server_prefix}")
        self.log('debug', f"[DEBUG] MAILCHIMP_AUDIENCE: {self.audience_name}")
        self.log('debug', f"[DEBUG] MAILCHIMP_REPLY_TO: {self.reply_to}")
        self.log('debug', f"[DEBUG] S3_BUCKET: {self.s3_bucket}")

        # Process each language in the work order
        for lang in work_order.languages.keys():
            if not work_order.languages[lang]:
                continue  # Skip disabled languages

            template_name = f"{work_order.eventCode}-{work_order.subEvent}-{work_order.stage}-{lang}"
            object_name = template_name + ".html"
            s3_key = f"{work_order.eventCode}/{object_name}"

            # Update progress for this language
            await self._update_progress(work_order, f"Processing {lang} language...")

            # Get list ID for the audience
            await self._update_progress(work_order, f"Getting Mailchimp audience for {lang}...")
            list_id = self._get_list_id_by_name(self.audience_name)
            
            # Get template and create campaign
            await self._update_progress(work_order, f"Finding Mailchimp template for {lang}...")
            template = self._list_templates(template_name)
            if not template:
                raise ValueError(f"Template '{template_name}' not found")

            # Use default values if fromName or replyTo are not set
            from_name = work_order.fromName or "Sakyong Lineage"
            reply_to = work_order.replyTo or self.reply_to

            try:
                # Create campaign
                await self._update_progress(work_order, f"Creating test campaign for {lang}...")
                campaign_id = self._create_campaign(
                    template['id'], 
                    list_id,
                    reply_to,
                    from_name
                )

                # Get and clean HTML content
                await self._update_progress(work_order, f"Retrieving HTML content for {lang}...")
                html = self._get_campaign_content(campaign_id)
                self._delete_campaign(campaign_id)
                html = self._clean_html(html)

                # Perform QA checks
                await self._update_progress(work_order, f"Performing QA checks for {lang}...")
                self._perform_qa(html, work_order, lang)

                # Upload to S3
                await self._update_progress(work_order, f"Uploading {lang} template to S3...")
                self._upload_to_s3(s3_key, html)
                
                # Update embeddedEmails in events table
                await self._update_progress(work_order, f"Updating embeddedEmails for {lang}...")
                if self.aws_client:
                    s3_url = f"https://{self.s3_bucket}.s3.amazonaws.com/{s3_key}"
                    
                    success = self.aws_client.update_event_embedded_emails(
                        work_order.eventCode,
                        work_order.subEvent,
                        work_order.stage,
                        lang,
                        s3_url
                    )
                    if not success:
                        error_msg = f"Failed to update embeddedEmails for {lang} - this is a critical error"
                        self.log('error', f"[ERROR] {error_msg}")
                        self.log('error', f"[ERROR] This failure indicates the events table update failed")
                        self.log('error', f"[ERROR] Event details: {work_order.eventCode}/{work_order.subEvent}/{work_order.stage}/{lang}")
                        raise ValueError(error_msg)
                    
                    # Also store the S3 path in the work order for later use by other steps
                    await self._update_progress(work_order, f"Storing S3 path for {lang} in work order...")
                    current_work_order = self.aws_client.get_work_order(work_order.id)
                    if current_work_order:
                        s3_html_paths = current_work_order.s3HTMLPaths.copy()
                        s3_html_paths[lang] = s3_url
                        
                        self.aws_client.update_work_order({
                            'id': work_order.id,
                            'updates': {'s3HTMLPaths': s3_html_paths}
                        })
                else:
                    error_msg = f"No AWS client available - cannot update embeddedEmails for {lang}"
                    self.log('error', f"[ERROR] {error_msg}")
                    self.log('error', f"[ERROR] This is a critical error as embeddedEmails update is required")
                    raise ValueError(error_msg)
                
                await self._update_progress(work_order, f"Successfully completed {lang} language")
            except Exception as e:
                error_message = str(e)
                self.log('error', f"[ERROR] Error processing language {lang}: {error_message}")
                # Don't update progress message here - let the error be handled by the caller
                raise ValueError(f"Failed to process language {lang}: {error_message}")

        # Final success message
        await self._update_progress(work_order, "Prepare step completed successfully")
        step.message = "Prepare step completed successfully"
        if hasattr(step, 'status'):
            step.status = getattr(step, 'status', None) or 'complete'
        return True

    async def _update_progress(self, work_order: WorkOrder, message: str):
        """Update the work order progress message."""
        if self.aws_client:
            try:
                # Get current steps and update the Prepare step message
                current_work_order = self.aws_client.get_work_order(work_order.id)
                if current_work_order:
                    steps = current_work_order.steps.copy()
                    for i, s in enumerate(steps):
                        if s.name == 'Prepare':
                            steps[i] = Step(
                                name='Prepare',
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

    def _get_list_id_by_name(self, audience_name: str) -> str:
        """Get Mailchimp list ID by audience name."""
        url = f"https://{self.server_prefix}.api.mailchimp.com/3.0/lists"
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        lists = response.json().get('lists', [])
        for lst in lists:
            if lst['name'] == audience_name:
                return lst['id']
        raise ValueError(f"Audience '{audience_name}' not found")

    def _list_templates(self, template_name: str) -> Optional[Dict[str, Any]]:
        """List Mailchimp templates and find the matching one."""
        base_url = f"https://{self.server_prefix}.api.mailchimp.com/3.0/templates"
        offset = 0
        count = 100
        while True:
            response = requests.get(f"{base_url}?offset={offset}&count={count}", headers=self.headers)
            response.raise_for_status()
            templates = response.json().get('templates', [])
            for tpl in templates:
                if tpl['name'] == template_name:
                    return tpl
            if len(templates) < count:
                break
            offset += count
        return None

    def _create_campaign(self, template_id: str, list_id: str, reply_to: str, from_name: str) -> str:
        """Create a Mailchimp campaign."""
        url = f"https://{self.server_prefix}.api.mailchimp.com/3.0/campaigns"
        payload = {
            "type": "regular",
            "recipients": {"list_id": list_id},
            "settings": {
                "subject_line": "Temp QA Campaign",
                "title": "Temp QA",
                "from_name": from_name,
                "reply_to": reply_to,
                "template_id": template_id
            }
        }
        response = requests.post(url, json=payload, headers=self.headers)
        if response.status_code != 200:
            raise ValueError(f"Failed to create campaign: {response.text}")
        return response.json()['id']

    def _get_campaign_content(self, campaign_id: str) -> str:
        """Get HTML content from a Mailchimp campaign."""
        url = f"https://{self.server_prefix}.api.mailchimp.com/3.0/campaigns/{campaign_id}/content"
        for _ in range(5):
            response = requests.get(url, headers=self.headers)
            if response.status_code == 200:
                return response.json().get('html', '')
            time.sleep(2)
        raise ValueError("Campaign HTML unavailable")

    def _delete_campaign(self, campaign_id: str):
        """Delete a Mailchimp campaign."""
        url = f"https://{self.server_prefix}.api.mailchimp.com/3.0/campaigns/{campaign_id}"
        requests.delete(url, headers=self.headers)

    def _clean_html(self, raw_html: str) -> str:
        """Clean HTML by removing the last center block."""
        last_center_start = raw_html.rfind('<center>')
        if last_center_start == -1:
            return raw_html
        
        center_end_tag = '</center>'
        last_center_end = raw_html.find(center_end_tag, last_center_start)
        if last_center_end == -1:
            return raw_html
        
        return raw_html[:last_center_start] + raw_html[last_center_end + len(center_end_tag):]

    def _perform_qa(self, html: str, work_order: WorkOrder, language: str):
        """Perform QA checks on the HTML content."""
        # Check for #if / #endif balance
        directive_lines = re.findall(r'#(if|else|endif)\b', html)
        stack = []

        for directive in directive_lines:
            if directive == 'if':
                stack.append('#if')
            elif directive == 'endif':
                if not stack or stack[-1] != '#if':
                    raise ValueError("QA Failure: unmatched '#endif' found")
                stack.pop()

        if stack:
            raise ValueError("QA Failure: missing '#endif' for one or more '#if'")
        
        # Check for ||name|| only if salutationByName is True (or field doesn't exist for backwards compatibility)
        salutation_by_name = getattr(work_order, 'salutationByName', True)
        if salutation_by_name:
            if "||name||" not in html:
                raise ValueError("QA Failure: missing '||name||' in HTML")

        # Get stage record to check QA fields
        stage_record = self._get_stage_record(work_order.stage)
        
        # Check zoom ID if qaStepCheckZoomId is enabled
        if stage_record.get('qaStepCheckZoomId', False):
            self.log('debug', f"[DEBUG] QA Check - Stage: {work_order.stage}, inPerson: {work_order.inPerson}, zoomId: {work_order.zoomId}")
            if work_order.inPerson:
                # Skip zoom ID check for in-person events
                self.log('debug', f"[DEBUG] In-person event detected, skipping zoom ID check")
            elif not work_order.zoomId:
                raise ValueError("QA Failure: zoom ID required for stage")
            else:
                zoom_links = re.findall(r'https://[^\s"]*zoom\.us/[^\s"]*', html)
                if not any(work_order.zoomId in link for link in zoom_links):
                    raise ValueError("QA Failure: zoom link with zoom ID not found")

        # Check registration links if regLinkPresent is enabled
        reg_link_present = getattr(work_order, 'regLinkPresent', True)
        if reg_link_present:
            reg_links = re.findall(r'https://(?:reg|csf)\.slsupport\.link/[^\s"]+', html)
            
            if not reg_links:
                raise ValueError("QA Failure: no registration links found")
            
            # Check for aid parameter with either ? or & prefix
            aid_ok = any(f"&aid={work_order.eventCode}" in link or f"?aid={work_order.eventCode}" in link for link in reg_links)
            # Check for pid parameter with either ? or & prefix
            pid_ok = any("?pid=123456789" in link or "&pid=123456789" in link for link in reg_links)
            
            if not aid_ok:
                # Find what aid values are actually present
                aid_values_found = []
                for link in reg_links:
                    aid_matches = re.findall(r'[?&]aid=([^&"]+)', link)
                    aid_values_found.extend(aid_matches)
                
                if aid_values_found:
                    raise ValueError(f"QA Failure: registration link has wrong 'aid' value. Expected '{work_order.eventCode}', found: {list(set(aid_values_found))}")
                else:
                    raise ValueError(f"QA Failure: registration link missing 'aid' parameter. Expected '{work_order.eventCode}'")
            
            if not pid_ok:
                # Find what pid values are actually present
                pid_values_found = []
                for link in reg_links:
                    pid_matches = re.findall(r'[?&]pid=([^&"]+)', link)
                    pid_values_found.extend(pid_matches)
                
                if pid_values_found:
                    raise ValueError(f"QA Failure: registration link has wrong 'pid' value. Expected '123456789', found: {list(set(pid_values_found))}")
                else:
                    raise ValueError("QA Failure: registration link missing 'pid' parameter. Expected '123456789'")

    def _upload_to_s3(self, key: str, html: str):
        """Upload HTML content to S3."""
        # Use boto3 client directly with region from config
        s3 = boto3.client('s3', region_name=os.getenv('AWS_REGION', 'us-east-1'))
        s3.put_object(Bucket=self.s3_bucket, Key=key, Body=html, ContentType='text/html')

    def _get_stage_record(self, stage: str) -> Dict:
        """Get the stage record from DynamoDB stages table"""
        try:
            if self.aws_client:
                stages_table = self.aws_client.get_table_name('stages')
                if stages_table:
                    stage_record = self.aws_client.get_item(stages_table, {'stage': stage})
                    return stage_record or {}
        except Exception as e:
            self.log('warning', f"[WARNING] Failed to get stage record for {stage}: {e}")
        return {} 