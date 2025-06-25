"""
Dry-Run step implementation for email work orders.
Performs all email preparation steps without actually sending emails.
"""

from .send_base import SendBaseStep


class DryRunStep(SendBaseStep):
    def __init__(self, aws_client):
        super().__init__(aws_client, "Dry-Run", dryrun=True) 