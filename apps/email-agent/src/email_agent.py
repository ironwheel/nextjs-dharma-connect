class EmailAgent:
    def __init__(self):
        self.aws_client = AWSClient()
        self.step_handlers = {
            'send_email': SendEmailStepHandler(self.aws_client),
            'wait_for_reply': WaitForReplyStepHandler(self.aws_client),
            'process_reply': ProcessReplyStepHandler(self.aws_client)
        }

    def process_work_order(self, work_order: WorkOrder) -> bool:
        """Process a work order by executing its steps."""
        try:
            # Get the current step
            current_step = work_order.get_current_step()
            if not current_step:
                print(f"No current step found for work order {work_order.id}")
                return False

            # Execute the step
            success = self.execute_step(work_order, current_step)
            if not success:
                print(f"Step execution failed for work order {work_order.id}")
                return False

            # Update work order status
            if current_step.is_completed():
                work_order.status = WorkOrderStatus.COMPLETED
            elif current_step.is_failed():
                work_order.status = WorkOrderStatus.FAILED
            else:
                work_order.status = WorkOrderStatus.IN_PROGRESS

            # Save the updated work order
            self.aws_client.save_work_order(work_order)
            return True

        except Exception as e:
            print(f"Error processing work order {work_order.id}: {e}")
            return False

    def execute_step(self, work_order: WorkOrder, step: Step) -> bool:
        """Execute a single step of a work order."""
        try:
            # Get the step handler
            handler = self.get_step_handler(step.type)
            if not handler:
                print(f"No handler found for step type: {step.type}")
                return False

            # Execute the step
            success = handler.execute(work_order, step)
            if not success:
                print(f"Step execution failed: {step.type}")
                return False

            return True

        except Exception as e:
            print(f"Error executing step {step.type}: {e}")
            return False

    def get_step_handler(self, step_type: str) -> Optional[StepHandler]:
        """Get the handler for a step type."""
        return self.step_handlers.get(step_type) 