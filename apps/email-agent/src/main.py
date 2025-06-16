import asyncio
import signal
import os
import boto3
from .agent import EmailAgent

def force_unlock_all_work_orders():
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.environ['DYNAMODB_TABLE'])
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
    # Create and start the agent
    agent = EmailAgent()
    
    # Set up signal handlers
    def signal_handler(sig, frame):
        print("\nShutting down...")
        asyncio.create_task(agent.stop())
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        await agent.start()
    except Exception as e:
        print(f"Error in main: {e}")
        await agent.stop()

if __name__ == "__main__":
    force_unlock_all_work_orders()
    asyncio.run(main()) 