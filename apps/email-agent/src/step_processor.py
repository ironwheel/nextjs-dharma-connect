import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional
import os

from .models import Step, StepStatus, WorkOrder
from .aws_client import AWSClient
from .steps import PrepareStep
from .steps.count import CountStep
from .steps.test import TestStep
from .steps.dry_run import DryRunStep
from .steps.send import SendStep
from .config import EMAIL_CONTINUOUS_SLEEP_SECS

class StepProcessor:
    def __init__(self, aws_client: AWSClient, sleep_queue=None, logging_config=None):
        self.aws_client = aws_client
        self.count_step = CountStep(aws_client, logging_config)
        self.prepare_step = PrepareStep(aws_client, logging_config)
        self.test_step = TestStep(aws_client, logging_config)
        self.dry_run_step = DryRunStep(aws_client, logging_config)
        self.send_step = SendStep(aws_client, logging_config)
        self.sleep_queue = sleep_queue if sleep_queue is not None else []
        self.logging_config = logging_config

    def log(self, level, message):
        """Log a message if the level is enabled."""
        if self.logging_config:
            self.logging_config.log(level, message)
        else:
            # Fallback to always logging if no config provided
            print(message)

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
                except InterruptedError:
                    await self._update_step_status(work_order, step, StepStatus.INTERRUPTED, "Step interrupted by stop request.")
                    return False
                except Exception as e:
                    error_message = str(e)
                    self.log('error', f"[ERROR] Error in {step.name} step: {error_message}")
                    await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                    return False
            elif step.name == "Prepare":
                try:
                    success = await self.prepare_step.process(work_order, step)
                    if not success:
                        error_message = "Step failed"
                        await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                        return False
                except InterruptedError:
                    await self._update_step_status(work_order, step, StepStatus.INTERRUPTED, "Step interrupted by stop request.")
                    return False
                except Exception as e:
                    error_message = str(e)
                    self.log('error', f"[ERROR] Error in {step.name} step: {error_message}")
                    await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                    return False
            elif step.name == "Dry-Run":
                try:
                    success = await self.dry_run_step.process(work_order, step)
                    if not success:
                        error_message = "Step failed"
                        await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                        return False
                except InterruptedError:
                    await self._update_step_status(work_order, step, StepStatus.INTERRUPTED, "Step interrupted by stop request.")
                    return False
                except Exception as e:
                    error_message = str(e)
                    self.log('error', f"[ERROR] Error in {step.name} step: {error_message}")
                    await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                    return False
            elif step.name == "Test":
                try:
                    success = await self.test_step.process(work_order, step)
                    if not success:
                        error_message = "Step failed"
                        await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                        return False
                except InterruptedError:
                    await self._update_step_status(work_order, step, StepStatus.INTERRUPTED, "Step interrupted by stop request.")
                    return False
                except Exception as e:
                    error_message = str(e)
                    self.log('error', f"[ERROR] Error in {step.name} step: {error_message}")
                    await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                    return False
            elif step.name == "Send":
                try:
                    success = await self.send_step.process(work_order, step)
                    if not success:
                        error_message = "Step failed"
                        await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                        return False
                    # Sleep queue logic
                    now = datetime.now(timezone.utc)
                    send_until = getattr(work_order, 'sendUntil', None)
                    send_continuously = getattr(work_order, 'sendContinuously', False)
                    if send_continuously and send_until:
                        send_until_dt = datetime.fromisoformat(send_until) if isinstance(send_until, str) else send_until
                        if now < send_until_dt:
                            if len(self.sleep_queue) < 8:
                                # Use sendInterval from work order if available, otherwise use EMAIL_CONTINUOUS_SLEEP_SECS
                                sleep_interval = getattr(work_order, 'sendInterval', EMAIL_CONTINUOUS_SLEEP_SECS)
                                # Ensure sleep_interval is an integer
                                sleep_interval = int(sleep_interval) if sleep_interval is not None else EMAIL_CONTINUOUS_SLEEP_SECS
                                sleep_until = now + timedelta(seconds=sleep_interval)
                                # Set work order state to Sleeping, set sleepUntil, set step message
                                step_message = f"Sleeping until {sleep_until.isoformat()}"
                                await self._update_step_status(work_order, step, StepStatus.SLEEPING, step_message)
                                self.aws_client.update_work_order({
                                    'id': work_order.id,
                                    'updates': {'state': 'Sleeping', 'sleepUntil': sleep_until.isoformat(), 'locked': True}
                                })
                                print(f"[SLEEP-QUEUE] Work order {work_order.id} put to sleep. New sleepUntil: {sleep_until.isoformat()}")
                                # Remove any existing entry for this work order
                                self.sleep_queue[:] = [entry for entry in self.sleep_queue if entry['work_order_id'] != work_order.id]
                                # Append the new entry with the updated sleep_until
                                self.sleep_queue.append({'work_order_id': work_order.id, 'sleep_until': sleep_until})
                                return True
                            else:
                                error_message = "Too many work orders are already sleeping. Try again later."
                                await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                                return False
                        else:
                            pass
                    else:
                        pass
                except InterruptedError:
                    await self._update_step_status(work_order, step, StepStatus.INTERRUPTED, "Step interrupted by stop request.")
                    return False
                except Exception as e:
                    error_message = str(e)
                    self.log('error', f"[ERROR] Error in {step.name} step: {error_message}")
                    await self._update_step_status(work_order, step, StepStatus.ERROR, error_message)
                    return False
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
            self.log('error', f"[ERROR] Error in {step.name} step: {error_message}")
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
            self.log('error', f"[ERROR] Step {step.name} not found for status update")
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
            self.log('error', f"[ERROR] Error updating step status in DynamoDB: {e}")
            raise  # Re-raise the exception to be caught by the caller

    def _send_websocket_update(self, work_order: WorkOrder, step: Step, status: StepStatus, message: str):
        """Send a WebSocket message to notify clients of step status changes."""
        # Note: WebSocket updates are automatically sent by aws_client.update_work_order()
        # This method is kept for compatibility but doesn't need to do anything
        pass 

    # Implement sleep queue logic as described in the plan. Use EMAIL_CONTINUOUS_SLEEP_SECS from the .env file for sleep interval. 