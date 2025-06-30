"""
Dry-Run step implementation for email work orders.
Performs all email preparation steps without actually sending emails.
"""

from .send_base import SendBaseStep
from ..aws_client import AWSClient


class DryRunStep(SendBaseStep):
    def __init__(self, aws_client: AWSClient, logging_config=None):
        super().__init__(aws_client, "Dry-Run", dryrun=True, logging_config=logging_config)
        self.logging_config = logging_config
    
    def log(self, level, message):
        """Log a message if the level is enabled."""
        if self.logging_config:
            self.logging_config.log(level, message)
        else:
            # Fallback to always logging if no config provided
            print(message) 