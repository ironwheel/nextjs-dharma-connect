import asyncio
import signal
import os
import boto3
from .agent import EmailAgent
from .config import POLL_INTERVAL, STOP_CHECK_INTERVAL, DYNAMODB_TABLE, config
from .aws_client import AWSClient, SQS_QUEUE_URL

def force_unlock_all_work_orders():
    """Force-unlocks all work orders that are in a locked state."""
    print("[DEBUG] Forcibly unlocking all work orders...")
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
    # Set up signal handlers
    def signal_handler(sig, frame):
        print("\nShutting down...")
        asyncio.create_task(agent.stop())
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # Create and start the agent (EmailAgent constructor handles pipeline purging)
        agent = EmailAgent()
        await agent.start()
    except Exception as e:
        print(f"Error in main: {e}")
        if 'agent' in locals():
            await agent.stop()

if __name__ == "__main__":
    force_unlock_all_work_orders()
    asyncio.run(main()) 