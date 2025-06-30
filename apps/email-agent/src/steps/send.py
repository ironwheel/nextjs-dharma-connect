"""
Send-Once step implementation for email work orders.
Sends emails to all eligible students once and then completes.
"""

from .send_base import SendBaseStep


class SendStep(SendBaseStep):
    def __init__(self, aws_client):
        super().__init__(aws_client, "Send-Once", dryrun=False) 