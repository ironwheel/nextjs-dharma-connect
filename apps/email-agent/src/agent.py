import asyncio
import json
import uuid
import boto3
import os
from typing import Optional
from datetime import datetime, timezone, timedelta
import time

from .aws_client import AWSClient
from .config import config, EMAIL_CONTINUOUS_SLEEP_SECS
from .models import WorkOrder, Step, StepStatus
from .step_processor import StepProcessor

class EmailAgent:
    def __init__(self, poll_interval: int = 2, stop_check_interval: int = 1, logging_config=None):
        self.aws_client = AWSClient(logging_config=logging_config)
        self.step_processor = StepProcessor(self.aws_client, logging_config=logging_config)
        self.poll_interval = poll_interval
        self.stop_check_interval = stop_check_interval
        self.current_work_order: WorkOrder = None
        self.stop_requested = False
        # Use a unique agent ID for locking
        self.agent_id = f"agent_{datetime.utcnow().timestamp()}"
        self.is_running = False
        # Track WebSocket connections for monitoring
        self.last_connection_count = 0
        self.connection_display_interval = 30  # Display connections every 30 seconds
        self.last_connection_display = time.time()
        self.connection_cleanup_interval = 60  # Clean up connections every 60 seconds
        self.last_connection_cleanup = time.time()
        self.sleep_queue = []
        self.sleep_queue_limit = 8
        
        # Logging configuration
        self.logging_config = logging_config

        # Purge the entire pipeline on startup
        self._purge_pipeline()

    def _purge_pipeline(self):
        """Purges SQS queue and verifies WebSocket connections."""
        try:
            self.aws_client.sqs.purge_queue(QueueUrl=config.sqs_queue_url)
            self.log('progress', "SQS queue purged successfully.")
        except Exception as e:
            self.log('error', f"[ERROR] Failed to purge SQS queue: {e}")

        # The AWSClient constructor already handles connection verification.
        # No need to call it again here.

        # Unlock work orders after purging and connection checks
        try:
            unlocked_count = self.aws_client.unlock_all_work_orders()
            if unlocked_count > 0:
                self.log('progress', f"Force-unlocked {unlocked_count} work orders.")
        except Exception as e:
            self.log('error', f"[ERROR] Error unlocking work orders: {e}")
        
    def _check_websocket_connections(self):
        """Check and display WebSocket connections if they've changed or it's time to display."""
        current_time = time.time()
        current_connections = self.aws_client.get_active_websocket_connections()
        current_count = len(current_connections)
        
        # Clean up stale connections periodically
        if current_time - self.last_connection_cleanup >= self.connection_cleanup_interval:
            cleaned_count = self.aws_client.cleanup_stale_connections()
            if cleaned_count > 0:
                # Re-fetch connections after cleanup
                current_connections = self.aws_client.get_active_websocket_connections()
                current_count = len(current_connections)
            self.last_connection_cleanup = current_time
        
        # Display if connections changed or if it's time for periodic display
        should_display = (
            current_count != self.last_connection_count or
            current_time - self.last_connection_display >= self.connection_display_interval
        )
        
        if should_display:
            # Show connection change notification if count changed
            if current_count != self.last_connection_count:
                if current_count > self.last_connection_count:
                    self.log('websocket', f"\n[WEBSOCKET] New connection detected! Total: {current_count}")
                elif current_count < self.last_connection_count:
                    self.log('websocket', f"\n[WEBSOCKET] Connection lost! Total: {current_count}")
            
            self.aws_client.display_websocket_connections()
            self.last_connection_count = current_count
            self.last_connection_display = current_time

    async def start(self, terminate_after_initialization=False):
        """Start the email agent."""
        self.is_running = True
        self.log('progress', f"Email agent started with ID: {self.agent_id}")
        
        # Display initial WebSocket connections
        self.log('websocket', "\n[WEBSOCKET] Initial connection status:")
        self.aws_client.display_websocket_connections()
        
        # Unlock any locked work orders from previous runs
        try:
            unlocked_count = self.aws_client.unlock_all_work_orders()
            if unlocked_count > 0:
                self.log('progress', f"Force-unlocked {unlocked_count} work orders.")
        except Exception as e:
            self.log('error', f"[ERROR] Error unlocking work orders on startup: {e}")

        # Reconstruct sleep queue from Sleeping work orders
        self.log('progress', "[SLEEP-QUEUE] Reconstructing sleep queue from Sleeping work orders...")
        all_work_orders = self.aws_client.scan_table(self.aws_client.table.name)
        self.log('debug', f"[SLEEP-QUEUE] Scanned {len(all_work_orders)} total work orders")
        now = datetime.now(timezone.utc)
        sleeping_count = 0
        for wo in all_work_orders:
            state = wo.get('state')
            sleep_until = wo.get('sleepUntil')
            self.log('debug', f"[SLEEP-QUEUE] Work order {wo.get('id', 'unknown')}: state={state}, sleepUntil={sleep_until}")
            if state == 'Sleeping' and sleep_until:
                sleeping_count += 1
                try:
                    sleep_until_dt = datetime.fromisoformat(sleep_until)
                    self.log('debug', f"[SLEEP-QUEUE] Found sleeping work order {wo['id']} with sleepUntil={sleep_until_dt}")
                    
                    # If sleepUntil is in the past, update it to now + sendInterval
                    if sleep_until_dt <= now:
                        self.log('debug', f"[SLEEP-QUEUE] Sleep time is in the past, updating work order {wo['id']}")
                        # Get the current work order to update the Send step properly
                        current_work_order = self.aws_client.get_work_order(wo['id'])
                        if current_work_order:
                            # Use sendInterval from work order if available, otherwise use EMAIL_CONTINUOUS_SLEEP_SECS
                            sleep_interval = getattr(current_work_order, 'sendInterval', EMAIL_CONTINUOUS_SLEEP_SECS)
                            new_sleep_until = now + timedelta(seconds=sleep_interval)
                            new_sleep_message = f"Sleeping until {new_sleep_until.isoformat()}"
                            
                            steps = current_work_order.steps.copy()
                            # Find and update the Send step
                            for i, step in enumerate(steps):
                                if self.extract_s(step.name) == 'Send':
                                    steps[i] = Step(
                                        name='Send',
                                        status=StepStatus.SLEEPING,
                                        message=new_sleep_message,
                                        isActive=True,
                                        startTime=step.startTime,
                                        endTime=step.endTime
                                    )
                                    break
                            
                            # Convert steps to plain dicts
                            plain_steps = [self.step_to_plain_dict(s) for s in steps]
                            
                            self.aws_client.update_work_order({
                                'id': wo['id'],
                                'updates': {
                                    'sleepUntil': new_sleep_until.isoformat(),
                                    'steps': plain_steps
                                }
                            })
                            sleep_until_dt = new_sleep_until
                            self.log('progress', f"[SLEEP-QUEUE] Updated past sleepUntil for work order {wo['id']} to {new_sleep_until.isoformat()}")
                    
                    # Lock the work order and add to sleep queue
                    self.aws_client.lock_work_order(wo['id'], self.agent_id)
                    if len(self.sleep_queue) < self.sleep_queue_limit:
                        self.sleep_queue.append({'work_order_id': wo['id'], 'sleep_until': sleep_until_dt})
                        self.log('debug', f"[SLEEP-QUEUE] Added work order {wo['id']} to sleep queue with sleep_until={sleep_until_dt}")
                    else:
                        self.log('warning', f"[SLEEP-QUEUE] Sleep queue limit reached, cannot add work order {wo['id']}")
                except Exception as e:
                    self.log('error', f"[SLEEP-QUEUE] Error parsing sleepUntil for work order {wo['id']}: {e}")
        
        self.log('progress', f"[SLEEP-QUEUE] Found {sleeping_count} sleeping work orders, initialized queue with {len(self.sleep_queue)} work orders.")

        # If terminate_after_initialization is True, exit after initialization
        if terminate_after_initialization:
            self.log('progress', "Initialization complete. Terminating as requested.")
            return

        while self.is_running:
            try:
                # Check WebSocket connections
                self._check_websocket_connections()

                # --- Sleep queue polling ---
                now = datetime.now(timezone.utc)
                to_wake = [entry for entry in self.sleep_queue if entry['sleep_until'] <= now]
                for entry in to_wake:
                    work_order_id = entry['work_order_id']
                    work_order = self.aws_client.get_work_order(work_order_id)
                    if work_order:
                        self.log('progress', f"[SLEEP-QUEUE] Waking work order {work_order_id} from sleep queue.")
                        # Unlock the work order before processing so the processing lock can work
                        self.aws_client.unlock_work_order(work_order_id)
                        await self._handle_start_request(work_order_id, work_order, 'Send')
                    self.sleep_queue = [e for e in self.sleep_queue if e['work_order_id'] != work_order_id]

                # Remove interrupted work orders from sleep queue
                interrupted_ids = []
                for entry in self.sleep_queue:
                    work_order = self.aws_client.get_work_order(entry['work_order_id'])
                    if work_order and getattr(work_order, 'stopRequested', False):
                        self.log('progress', f"[SLEEP-QUEUE] Removing interrupted work order {entry['work_order_id']} from sleep queue.")
                        interrupted_ids.append(entry['work_order_id'])
                self.sleep_queue = [e for e in self.sleep_queue if e['work_order_id'] not in interrupted_ids]

                # --- SQS polling ---
                messages = self.aws_client.receive_sqs_messages()
                if len(messages) > 0:
                    self.log('progress', f"[SQS-POLL] Processing {len(messages)} message(s)...")
                for message in messages:
                    try:
                        # Process the message
                        body = json.loads(message['Body'])
                        
                        # Validate message format
                        if not all(key in body for key in ['workOrderId', 'stepName', 'action']):
                            self.log('error', f"[SQS-RECEIVE] ERROR: Invalid message format. Expected workOrderId, stepName, action. Got: {list(body.keys())}")
                            # Delete invalid message
                            try:
                                self.aws_client.delete_sqs_message(message['ReceiptHandle'])
                                self.log('progress', f"[SQS-DELETE] Successfully deleted invalid format message")
                            except Exception as e:
                                self.log('warning', f"[SQS-DELETE] WARNING: Failed to delete invalid format message: {e}")
                            continue
                        
                        work_order_id = body['workOrderId']
                        step_name = body['stepName']
                        action = body['action']
                        
                        # Validate action
                        if action not in ['start', 'stop']:
                            self.log('error', f"[SQS-RECEIVE] ERROR: Invalid action '{action}'. Expected 'start' or 'stop'")
                            # Delete invalid message
                            try:
                                self.aws_client.delete_sqs_message(message['ReceiptHandle'])
                                self.log('progress', f"[SQS-DELETE] Successfully deleted invalid action message")
                            except Exception as e:
                                self.log('warning', f"[SQS-DELETE] WARNING: Failed to delete invalid action message: {e}")
                            continue

                        # Get the work order
                        work_order = self.aws_client.get_work_order(work_order_id)
                        
                        if not work_order:
                            self.log('error', f"[SQS-RECEIVE] ERROR: Work order not found: {work_order_id}")
                            # Delete message for non-existent work order
                            try:
                                self.aws_client.delete_sqs_message(message['ReceiptHandle'])
                                self.log('progress', f"[SQS-DELETE] Successfully deleted message for non-existent work order {work_order_id}")
                            except Exception as e:
                                self.log('warning', f"[SQS-DELETE] WARNING: Failed to delete message for non-existent work order {work_order_id}: {e}")
                            continue

                        # Handle stop requests
                        if action == 'stop':
                            await self._handle_stop_request(work_order_id, work_order, step_name)
                            # Always delete stop messages after processing
                            try:
                                self.aws_client.delete_sqs_message(message['ReceiptHandle'])
                                self.log('progress', f"[SQS-DELETE] Successfully deleted stop message for work order {work_order_id}")
                            except Exception as e:
                                self.log('warning', f"[SQS-DELETE] WARNING: Failed to delete stop message for work order {work_order_id}: {e}")
                                # Continue even if deletion fails - the message will eventually expire
                            continue

                        # Handle start requests
                        if action == 'start':
                            # Delete start message immediately after validation but before processing
                            # This prevents receipt handle expiration during long-running email operations
                            try:
                                self.aws_client.delete_sqs_message(message['ReceiptHandle'])
                                self.log('progress', f"[SQS-DELETE] Successfully deleted start message for work order {work_order_id}")
                            except Exception as e:
                                self.log('warning', f"[SQS-DELETE] WARNING: Failed to delete start message for work order {work_order_id}: {e}")
                                # Continue processing even if deletion fails - the message will eventually expire
                            
                            # Now process the start request
                            success = await self._handle_start_request(work_order_id, work_order, step_name)
                            continue

                    except Exception as e:
                        self.log('error', f"[SQS-RECEIVE] ERROR: Error processing message: {e}")
                        import traceback
                        self.log('error', f"[SQS-RECEIVE] ERROR: Full traceback: {traceback.format_exc()}")
                        self.log('warning', f"[SQS-RECEIVE] Message will remain in queue for retry")
                        # Don't delete message on unexpected errors

                # Wait before next poll
                await asyncio.sleep(self.poll_interval)

            except Exception as e:
                self.log('error', f"Error in main loop: {e}")
                await asyncio.sleep(self.poll_interval)

    async def stop(self):
        """Stop the email agent."""
        self.is_running = False
        if self.current_work_order:
            # Unlock the current work order
            self.aws_client.unlock_work_order(self.current_work_order.id)
        self.log('progress', "Email agent stopped")

    def extract_s(self, val):
        if isinstance(val, dict) and 'S' in val:
            return val['S']
        return val

    def step_to_plain_dict(self, step):
        def extract_s(val):
            if isinstance(val, dict) and 'S' in val:
                return val['S']
            if isinstance(val, dict) and 'BOOL' in val:
                return val['BOOL']
            if isinstance(val, dict) and 'NULL' in val:
                return None
            return val
        return {
            'name': extract_s(step.name),
            'status': extract_s(step.status.value if isinstance(step.status, StepStatus) else step.status),
            'message': extract_s(step.message),
            'isActive': extract_s(step.isActive),
            'startTime': extract_s(step.startTime),
            'endTime': extract_s(step.endTime)
        }

    async def _handle_stop_request(self, work_order_id: str, work_order: WorkOrder, step_name: str):
        """Handle a stop request for a specific step in a work order."""
        self.log('debug', f"[DEBUG] Handling stop request for work order: {work_order_id}, step: {step_name}")
        
        try:
            # Set stopRequested flag in DynamoDB
            self.aws_client.update_work_order({
                'id': work_order_id,
                'updates': {'stopRequested': True}
            })

            # Find the requested step
            step = None
            step_index = -1
            for i, s in enumerate(work_order.steps):
                if self.extract_s(s.name) == step_name:
                    step = s
                    step_index = i
                    break
            
            if step is None:
                self.log('debug', f"[DEBUG] ERROR: Step {step_name} not found in work order {work_order_id}")
                return
            
            # Validate current step status
            current_status = self.extract_s(step.status)
            if current_status not in [StepStatus.WORKING, StepStatus.SLEEPING]:
                self.log('debug', f"[DEBUG] ERROR: Step {step_name} is not working or sleeping (status: {current_status}) - ignoring stop request")
                # Don't update the step status since it's already in the correct state
                return
            
            # Check if this agent is currently processing this work order
            if (self.current_work_order and 
                self.current_work_order.id == work_order_id and 
                self.current_work_order.steps):
                
                # Find the currently active step
                active_step = None
                for s in self.current_work_order.steps:
                    if self.extract_s(s.name) == step_name and s.isActive and self.extract_s(s.status) == StepStatus.WORKING:
                        active_step = s
                        break
                
                if active_step:
                    # Agent is actively processing this work order
                    self.log('debug', f"[DEBUG] Agent is actively processing {step_name} step, stopping it")
                    
                    # Update the step status to interrupted
                    await self._update_step_status(work_order, step_name, StepStatus.INTERRUPTED, f"{step_name} step stopped by user")
                    
                    # Unlock the work order since we're stopping
                    self.aws_client.unlock_work_order(work_order_id)
                    self.current_work_order = None
                    
                    self.log('debug', f"[DEBUG] Successfully stopped {step_name} step")
                else:
                    # Agent has the work order but step is not active
                    self.log('debug', f"[DEBUG] Agent has work order but {step_name} step is not active, sending idle response")
                    await self._update_step_status(work_order, step_name, StepStatus.INTERRUPTED, f"Agent was idle when {step_name} step was stopped by user")
            else:
                # Agent is not processing this work order - check if it's sleeping
                if current_status == StepStatus.SLEEPING:
                    self.log('debug', f"[DEBUG] Work order {work_order_id} is sleeping, removing from sleep queue and stopping")
                    
                    # Remove from sleep queue if present
                    self.sleep_queue = [e for e in self.sleep_queue if e['work_order_id'] != work_order_id]
                    
                    # Update the step status to interrupted
                    await self._update_step_status(work_order, step_name, StepStatus.INTERRUPTED, f"{step_name} step stopped by user while sleeping")
                    
                    # Unlock the work order since we're stopping
                    self.aws_client.unlock_work_order(work_order_id)
                    
                    self.log('debug', f"[DEBUG] Successfully stopped sleeping {step_name} step")
                else:
                    # Agent is not processing this work order and it's not sleeping
                    self.log('debug', f"[DEBUG] Agent is not processing work order {work_order_id}, sending idle response")
                    await self._update_step_status(work_order, step_name, StepStatus.INTERRUPTED, f"Agent was idle when {step_name} step was stopped by user")
                
        except Exception as e:
            self.log('debug', f"[DEBUG] ERROR: Exception during stop request: {str(e)}")
            await self._update_step_status(work_order, step_name, StepStatus.EXCEPTION, f"Exception during stop: {str(e)}")

    async def _handle_start_request(self, work_order_id: str, work_order: WorkOrder, step_name: str) -> bool:
        """Handle a start request for a specific step in a work order."""
        self.log('debug', f"[DEBUG] Handling start request for work order: {work_order_id}, step: {step_name}")
        
        try:
            # Clear stopRequested flag in DynamoDB
            self.aws_client.update_work_order({
                'id': work_order_id,
                'updates': {'stopRequested': False}
            })

            # Find the requested step
            step = None
            step_index = -1
            for i, s in enumerate(work_order.steps):
                if self.extract_s(s.name) == step_name:
                    step = s
                    step_index = i
                    break
            
            if step is None:
                self.log('debug', f"[DEBUG] ERROR: Step {step_name} not found in work order {work_order_id}")
                await self._update_step_status(work_order, step_name, StepStatus.ERROR, f"Step {step_name} not found")
                return False
            
            # Validate step order - can only start first step or step after completed step
            if step_index > 0:
                prev_step = work_order.steps[step_index - 1]
                prev_status = self.extract_s(prev_step.status)
                if prev_status != StepStatus.COMPLETE:
                    self.log('debug', f"[DEBUG] ERROR: Cannot start {step_name} step. Previous step {self.extract_s(prev_step.name)} is not complete (status: {prev_status})")
                    await self._update_step_status(work_order, step_name, StepStatus.ERROR, f"Cannot start {step_name} step. Previous step must be complete.")
                    return False
            
            # Validate current step status
            current_status = self.extract_s(step.status)
            if current_status == StepStatus.WORKING:
                self.log('debug', f"[DEBUG] ERROR: Step {step_name} is already working - ignoring duplicate start request")
                # Don't update the step status since it's already correct
                return False
            elif current_status not in [StepStatus.READY, StepStatus.COMPLETE, StepStatus.INTERRUPTED, StepStatus.ERROR, StepStatus.EXCEPTION, StepStatus.SLEEPING]:
                self.log('debug', f"[DEBUG] ERROR: Step {step_name} has invalid status for start: {current_status}")
                await self._update_step_status(work_order, step_name, StepStatus.ERROR, f"Cannot start step with status: {current_status}")
                return False
            
            # Try to lock the work order
            if not self.aws_client.lock_work_order(work_order_id, self.agent_id):
                self.log('debug', f"[DEBUG] ERROR: Could not lock work order: {work_order_id}")
                await self._update_step_status(work_order, step_name, StepStatus.ERROR, "Could not lock work order for processing")
                return False
            
            self.log('debug', f"[DEBUG] SUCCESS: Work order locked successfully")
            
            # Set the current work order to track that we're processing it
            self.current_work_order = work_order
            
            # If the step was sleeping, change it to working first
            if current_status == StepStatus.SLEEPING:
                self.log('debug', f"[DEBUG] Converting sleeping step {step_name} to working status")
                await self._update_step_status(work_order, step_name, StepStatus.WORKING, "Waking from sleep, beginning work")
            else:
                # Update step status to working
                await self._update_step_status(work_order, step_name, StepStatus.WORKING, "Work request received, beginning work")
            
            # Create a clean step object with extracted values for the processor
            clean_step = Step(
                name=step_name,  # Use the extracted step_name instead of step.name
                status=StepStatus.WORKING,
                message="Work request received, beginning work",
                isActive=True,
                startTime=datetime.utcnow().isoformat(),
                endTime=None
            )
            
            # Process the step
            success = await self.step_processor.process_step(work_order, clean_step)
            self.log('debug', f"[DEBUG] Step {step_name} execution result: {success}")
            
            if success:
                # Step completed successfully - step processor already updated the status
                self.log('debug', f"[DEBUG] Step {step_name} completed successfully")
                
                # Enable next step if it exists
                if step_index < len(work_order.steps) - 1:
                    next_step_name = self.extract_s(work_order.steps[step_index + 1].name)
                    self.log('debug', f"[DEBUG] Enabling next step: {next_step_name}")
                    await self._enable_next_step(work_order, step_index + 1)
                
                # Unlock the work order after each step completes
                self.log('debug', f"[DEBUG] Step completed, unlocking work order: {work_order_id}")
                self.aws_client.unlock_work_order(work_order_id)
                self.current_work_order = None
                
                return True
            else:
                # Step failed - error status already set by step processor
                # Unlock the work order so user can restart the failed step
                self.log('debug', f"[DEBUG] Step failed, unlocking work order for restart: {work_order_id}")
                self.aws_client.unlock_work_order(work_order_id)
                self.current_work_order = None
                return False
                
        except Exception as e:
            self.log('debug', f"[DEBUG] ERROR: Exception during step processing: {str(e)}")
            await self._update_step_status(work_order, step_name, StepStatus.EXCEPTION, f"Exception: {str(e)}")
            # Unlock the work order on exception so user can restart
            self.log('debug', f"[DEBUG] Exception occurred, unlocking work order: {work_order_id}")
            self.aws_client.unlock_work_order(work_order_id)
            self.current_work_order = None
            return False

    async def _enable_next_step(self, work_order: WorkOrder, next_step_index: int):
        """Enable the next step in the sequence."""
        try:
            # Reload the work order from DynamoDB to get the current state
            # This ensures we have the latest data including successful completions
            current_work_order = self.aws_client.get_work_order(work_order.id)
            if not current_work_order:
                self.log('debug', f"[DEBUG] ERROR: Could not reload work order {work_order.id} from DynamoDB")
                return
            
            steps = current_work_order.steps.copy()
            next_step = steps[next_step_index]
            next_step_name = self.extract_s(next_step.name)
            
            self.log('debug', f"[DEBUG] Enabling step {next_step_name} at index {next_step_index}")
            
            steps[next_step_index] = Step(
                name=next_step_name,
                status=StepStatus.READY,
                message="",
                isActive=True,
                startTime=None,
                endTime=None
            )
            
            # Convert all steps to plain dicts before updating DynamoDB
            plain_steps = [self.step_to_plain_dict(s) for s in steps]
            self.aws_client.update_work_order({
                'id': work_order.id,
                'updates': {'steps': plain_steps}
            })
            
            self.log('debug', f"[DEBUG] Successfully enabled step {next_step_name}")
            
        except Exception as e:
            self.log('debug', f"[DEBUG] ERROR: Failed to enable next step: {str(e)}")

    async def _update_step_status(self, work_order: WorkOrder, step_name: str, status: StepStatus, message: str):
        """Update the status of a specific step."""
        try:
            steps = work_order.steps.copy()
            step_index = -1
            
            # Find the step
            for i, s in enumerate(steps):
                if self.extract_s(s.name) == step_name:
                    step_index = i
                    break
            
            if step_index == -1:
                self.log('debug', f"[DEBUG] ERROR: Step {step_name} not found for status update")
                return
            
            # Update the step
            steps[step_index] = Step(
                name=step_name,
                status=status,
                message=message,
                isActive=status == StepStatus.WORKING,
                startTime=datetime.utcnow().isoformat() if status == StepStatus.WORKING else None,
                endTime=datetime.utcnow().isoformat() if status in [StepStatus.COMPLETE, StepStatus.ERROR, StepStatus.EXCEPTION] else None
            )
            
            # Convert all steps to plain dicts before updating DynamoDB
            plain_steps = [self.step_to_plain_dict(s) for s in steps]
            self.aws_client.update_work_order({
                'id': work_order.id,
                'updates': {'steps': plain_steps}
            })
            
            self.log('debug', f"[DEBUG] Successfully updated step {step_name} to status: {status}")
            
        except Exception as e:
            self.log('debug', f"[DEBUG] ERROR: Failed to update step status: {str(e)}")

    def log(self, level, message):
        """Log a message if the level is enabled."""
        if self.logging_config:
            self.logging_config.log(level, message)
        else:
            # Fallback to always logging if no config provided
            print(message) 