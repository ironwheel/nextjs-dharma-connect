import asyncio
from datetime import datetime
from typing import Dict, Optional

from .models import Step, StepStatus, WorkOrder
from .aws_client import AWSClient

class StepProcessor:
    def __init__(self, aws_client: AWSClient):
        self.aws_client = aws_client

    async def process_step(self, work_order: WorkOrder, step: Step) -> bool:
        """Process a single step of a work order."""
        print(f"[DEBUG] [StepProcessor] process_step called for step: {step.name}")
        try:
            # Update step status to working
            await self._update_step_status(work_order, step, StepStatus.WORKING, "Step started")

            # Process based on step name
            if step.name == "Prepare":
                success = await self._process_prepare(work_order, step)
            elif step.name == "Test":
                success = await self._process_test(work_order, step)
            elif step.name == "Send":
                success = await self._process_send(work_order, step)
            else:
                print(f"[DEBUG] Unknown step: {step.name}")
                raise ValueError(f"Unknown step type: {step.name}")

            if success:
                await self._update_step_status(work_order, step, StepStatus.COMPLETE, "Step completed successfully")
                return True
            else:
                await self._update_step_status(work_order, step, StepStatus.ERROR, "Step failed")
                return False

        except Exception as e:
            await self._update_step_status(work_order, step, StepStatus.ERROR, f"Error: {str(e)}")
            return False

    async def _update_step_status(self, work_order: WorkOrder, step: Step, status: StepStatus, message: str):
        """Update the status of a step and notify web clients."""
        now = datetime.utcnow().isoformat()
        
        # Update the step in the work order
        steps = work_order.steps.copy()
        step_index = next(i for i, s in enumerate(steps) if s.name == step.name)
        steps[step_index] = Step(
            name=step.name,
            status=status,
            message=message,
            isActive=step.isActive,
            startTime=now if status == StepStatus.WORKING else step.startTime,
            endTime=now if status in [StepStatus.COMPLETE, StepStatus.ERROR] else step.endTime
        )

        # Update the work order in DynamoDB
        self.aws_client.update_work_order({
            'id': work_order.id,
            'updates': {'steps': steps}
        })

    async def _process_prepare(self, work_order: WorkOrder, step: Step) -> bool:
        """Process the Prepare step."""
        print(f"[STUB] Would perform PREPARE step for work order {work_order.id}")
        # TODO: Implement actual prepare logic here
        await asyncio.sleep(2)  # Simulate work
        return True

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