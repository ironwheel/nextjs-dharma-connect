import asyncio
import json
import uuid
import boto3
from typing import Optional

from .aws_client import AWSClient
from .config import POLL_INTERVAL, STOP_CHECK_INTERVAL, SQS_QUEUE_URL
from .models import WorkOrder, Step, StepStatus
from .step_processor import StepProcessor

class EmailAgent:
    def __init__(self):
        self.aws_client = AWSClient()
        self.step_processor = StepProcessor(self.aws_client)
        self.agent_id = str(uuid.uuid4())
        self.is_running = False
        self.current_work_order: Optional[WorkOrder] = None
        # Clear the SQS queue on startup
        print("[DEBUG] Purging SQS queue on agent startup...")
        sqs = boto3.client('sqs')
        sqs.purge_queue(QueueUrl=SQS_QUEUE_URL)
        print("[DEBUG] SQS queue purged.")

    async def start(self):
        """Start the email agent."""
        self.is_running = True
        print(f"Email agent started with ID: {self.agent_id}")
        
        while self.is_running:
            try:
                # Check for new messages
                messages = self.aws_client.receive_sqs_messages()
                
                for message in messages:
                    try:
                        # Process the message
                        body = json.loads(message['Body'])
                        work_order_id = body['id']
                        
                        # Get the work order
                        work_order = self.aws_client.get_work_order(work_order_id)
                        if not work_order:
                            print(f"Work order not found: {work_order_id}")
                            continue

                        # Try to lock the work order
                        if not self.aws_client.lock_work_order(work_order_id, self.agent_id):
                            print(f"Could not lock work order: {work_order_id}")
                            continue

                        # Process the work order
                        await self._process_work_order(work_order)

                    except Exception as e:
                        print(f"Error processing message: {e}")
                    finally:
                        # Delete the message from the queue
                        self.aws_client.delete_sqs_message(message['ReceiptHandle'])

                # Wait before next poll
                await asyncio.sleep(POLL_INTERVAL)

            except Exception as e:
                print(f"Error in main loop: {e}")
                await asyncio.sleep(POLL_INTERVAL)

    async def stop(self):
        """Stop the email agent."""
        self.is_running = False
        if self.current_work_order:
            # Unlock the current work order
            self.aws_client.unlock_work_order(self.current_work_order.id)
        print("Email agent stopped")

    async def _process_work_order(self, work_order: WorkOrder):
        """Process a work order."""
        self.current_work_order = work_order
        print(f"[DEBUG] Processing work order: {work_order.id}")
        try:
            # Process only the first active, non-complete step
            for step in work_order.steps:
                if not self.is_running:
                    print("[DEBUG] Agent stopped during step processing.")
                    break
                if not step.isActive or step.status == StepStatus.COMPLETE:
                    continue
                print(f"[DEBUG] Executing step: {step.name} (status: {step.status})")
                # Check for stop request
                if work_order.stopRequested:
                    print(f"[DEBUG] Stop requested for work order: {work_order.id}")
                    await self._handle_stop_request(work_order, step)
                    break
                # Process the step (stubbed)
                success = await self.step_processor.process_step(work_order, step)
                print(f"[DEBUG] Step {step.name} execution result: {success}")
                # Do not auto-activate the next step; only process one step per message
                break
        finally:
            print(f"[DEBUG] Unlocking work order: {work_order.id}")
            self.aws_client.unlock_work_order(work_order.id)
            self.current_work_order = None

    async def _handle_stop_request(self, work_order: WorkOrder, current_step: Step):
        """Handle a stop request for the current step."""
        # Update the current step to interrupted
        await self.step_processor._update_step_status(
            work_order,
            current_step,
            StepStatus.INTERRUPTED,
            "Step was interrupted"
        )

        # Reset stop request flag
        self.aws_client.update_work_order({
            'id': work_order.id,
            'updates': {'stopRequested': False}
        }) 