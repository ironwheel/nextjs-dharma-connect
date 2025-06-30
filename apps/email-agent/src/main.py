import asyncio
import signal
import os
import boto3
import argparse
from .agent import EmailAgent
from .config import POLL_INTERVAL, STOP_CHECK_INTERVAL, DYNAMODB_TABLE, config
from .aws_client import AWSClient, SQS_QUEUE_URL

class LoggingConfig:
    """Configuration class for controlling log levels."""
    
    def __init__(self, log_levels=None):
        # Default to progress level enabled
        self.progress = True
        self.steps = False
        self.workorder = False
        self.debug = False
        self.websocket = False
        self.warning = False  # Warnings are always shown for now
        
        # Override defaults with provided log levels
        if log_levels:
            for level in log_levels:
                if hasattr(self, level):
                    setattr(self, level, True)
    
    def should_log(self, level):
        """Check if a specific log level should be output."""
        return getattr(self, level, False)
    
    def log(self, level, message):
        """Log a message if the level is enabled."""
        if self.should_log(level) or level in ['error', 'warning']:
            print(message)

def force_unlock_all_work_orders():
    """Force-unlocks all work orders that are in a locked state."""
    dynamodb = boto3.resource('dynamodb', region_name=config.aws_region)
    table = dynamodb.Table(config.work_orders_table)
    scan_kwargs = {
        'FilterExpression': 'locked = :true',
        'ExpressionAttributeValues': {':true': True}
    }
    response = table.scan(**scan_kwargs)
    for item in response.get('Items', []):
        table.update_item(
            Key={'id': item['id']},
            UpdateExpression="SET locked = :false, lockedBy = :empty",
            ExpressionAttributeValues={':false': False, ':empty': ""}
        )
    print(f"Force-unlocked {len(response.get('Items', []))} work orders.")

async def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Email Agent with configurable logging')
    parser.add_argument('--log-levels', nargs='*', 
                       choices=['progress', 'steps', 'workorder', 'debug', 'websocket'],
                       default=['progress'],
                       help='Log levels to enable (default: progress). Examples: --log-levels progress debug, --log-levels progress steps websocket')
    parser.add_argument('--terminate-after-initialization', action='store_true',
                       help='Terminate the email agent after completing initialization (useful for testing)')
    
    args = parser.parse_args()
    
    # Create logging configuration
    logging_config = LoggingConfig(args.log_levels)
    
    # Display enabled log levels
    print(f"Email Agent starting with log levels: {args.log_levels}")
    print("Available log levels:")
    print("  progress   - General progress messages (default)")
    print("  steps      - Step execution details")
    print("  workorder  - Work order data and state changes")
    print("  debug      - Debug information and detailed processing")
    print("  websocket  - WebSocket connection status")
    print("  error      - Error messages (always shown)")
    print("  warning    - Warning messages (always shown)")
    print()
    
    # Set up signal handlers
    def signal_handler(sig, frame):
        print("\nShutting down...")
        asyncio.create_task(agent.stop())
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # Create and start the agent with logging configuration
        agent = EmailAgent(logging_config=logging_config)
        
        if args.terminate_after_initialization:
            print("Starting agent with early termination after initialization...")
            await agent.start(terminate_after_initialization=True)
        else:
            await agent.start()
    except Exception as e:
        print(f"Error in main: {e}")
        if 'agent' in locals():
            await agent.stop()

if __name__ == "__main__":
    force_unlock_all_work_orders()
    asyncio.run(main()) 