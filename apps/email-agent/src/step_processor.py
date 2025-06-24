import asyncio
from datetime import datetime
from typing import Dict, Optional

from .models import Step, StepStatus, WorkOrder
from .aws_client import AWSClient
from .steps import PrepareStep
from .steps.count import CountStep

class StepProcessor:
    def __init__(self, aws_client: AWSClient):
        self.aws_client = aws_client
        self.count_step = CountStep(aws_client)
        self.prepare_step = PrepareStep(aws_client)

    async def process_step(self, work_order: WorkOrder, step: Step) -> bool:
        """Process a single step of a work order."""
        try:
            # Note: Step status is already set to WORKING by the agent before calling this method
            # No need to update it again here

            # Process based on step name
            if step.name == "Count":
                try:
                    success = await self.count_step.process(work_order, step)
                    if not success:
                        error_message = "Step failed"
                        await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                        return False
                    else:
                        # Use the message set by the Count step
                        success_message = step.message
                        await self._update_step_status(work_order, step, StepStatus.COMPLETE, success_message)
                        return True
                except Exception as e:
                    error_message = str(e)
                    print(f"[ERROR] Error in {step.name} step: {error_message}")
                    await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                    return False
            elif step.name == "Prepare":
                try:
                    success = await self.prepare_step.process(work_order, step)
                    if not success:
                        error_message = "Step failed"
                        await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                        return False
                except Exception as e:
                    error_message = str(e)
                    print(f"[ERROR] Error in {step.name} step: {error_message}")
                    await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                    return False
            elif step.name == "Test":
                success = await self._process_test(work_order, step)
            elif step.name == "Send":
                success = await self._process_send(work_order, step)
            else:
                error_message = f"Unknown step type: {step.name}"
                await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                return False

            if success:
                # Use the message set by the step if present, otherwise default
                success_message = step.message if getattr(step, 'message', None) else "Step completed successfully"
                await self._update_step_status(work_order, step, StepStatus.COMPLETE, success_message)
                return True
            else:
                error_message = "Step failed"
                await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                return False

        except Exception as e:
            error_message = str(e)
            print(f"[ERROR] Error in {step.name} step: {error_message}")
            await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
            return False

    async def _update_step_status(self, work_order: WorkOrder, step: Step, status: StepStatus, message: str):
        """Update the status of a step and notify web clients."""
        now = datetime.utcnow().isoformat()
        
        # Update the step in the work order
        steps = work_order.steps.copy()
        
        # Find the step index, handling both string and DynamoDB format step names
        step_index = -1
        for i, s in enumerate(steps):
            step_name = s.name
            if isinstance(step_name, dict) and 'S' in step_name:
                step_name = step_name['S']
            if step_name == step.name:
                step_index = i
                break
        
        if step_index == -1:
            print(f"[ERROR] Step {step.name} not found for status update")
            return
        
        steps[step_index] = Step(
            name=step.name,
            status=status,
            message=message,
            isActive=step.isActive,
            startTime=now if status == StepStatus.WORKING else step.startTime,
            endTime=now if status in [StepStatus.COMPLETE, StepStatus.ERROR] else step.endTime
        )

        # Convert steps to regular dictionaries (not DynamoDB format)
        steps_dict = [s.dict() for s in steps]

        try:
            # Update the work order in DynamoDB
            self.aws_client.update_work_order({
                'id': work_order.id,
                'updates': {'steps': steps_dict}
            })
        except Exception as e:
            print(f"[ERROR] Error updating step status in DynamoDB: {e}")
            raise  # Re-raise the exception to be caught by the caller

    async def _process_test(self, work_order: WorkOrder, step: Step) -> bool:
        """Process the Test step."""
        print(f"[STUB] Would perform TEST step for work order {work_order.id}")
        # TODO: Implement actual test logic here
        await asyncio.sleep(2)  # Simulate work
        return True

    async def _process_send(self, work_order: WorkOrder, step: Step) -> bool:
        """Process the Send step."""
        print(f"[STUB] Would perform SEND step for work order {work_order.id}")
        # TODO: Implement actual send logic here
        await asyncio.sleep(2)  # Simulate work
        return True

    def _send_websocket_update(self, work_order: WorkOrder, step: Step, status: StepStatus, message: str):
        """Send a WebSocket message to notify clients of step status changes."""
        # Note: WebSocket updates are automatically sent by aws_client.update_work_order()
        # This method is kept for compatibility but doesn't need to do anything
        pass 