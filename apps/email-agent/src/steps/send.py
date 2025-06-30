"""
Send-Once step implementation for email work orders.
Sends emails to all eligible students once and then completes.
"""

from .send_base import SendBaseStep
from ..aws_client import AWSClient


class SendStep(SendBaseStep):
    def __init__(self, aws_client: AWSClient, logging_config=None):
        super().__init__(aws_client, "Send", dryrun=False, logging_config=logging_config)
        self.logging_config = logging_config
    
    def log(self, level, message):
        """Log a message if the level is enabled."""
        if self.logging_config:
            self.logging_config.log(level, message)
        else:
            # Fallback to always logging if no config provided
            print(message) 