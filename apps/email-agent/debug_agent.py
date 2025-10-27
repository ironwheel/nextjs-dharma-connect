#!/usr/bin/env python3
"""
Enhanced debug script for email-agent with detailed error handling and logging.

This script will help debug why the email-agent is exiting unexpectedly.
"""

import subprocess
import sys
import os
import signal
import time

def signal_handler(sig, frame):
    print('\nReceived interrupt signal. Shutting down...')
    sys.exit(0)

def main():
    """Run the email agent with enhanced debugging."""
    print("=" * 80)
    print("Starting email-agent with enhanced debugging for student 4080c768-1936-46dd-a7b3-a182eaf18191")
    print("=" * 80)
    
    # Set up signal handler for graceful shutdown
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Stay in the email-agent directory (parent of src)
    email_agent_dir = os.path.dirname(__file__)
    os.chdir(email_agent_dir)
    
    try:
        print("Starting EmailAgent as a module...")
        print("Press Ctrl+C to stop the agent")
        print("=" * 80)
        
        # Run the email-agent as a module with enhanced output
        process = subprocess.Popen(
            [sys.executable, '-m', 'src.agent'],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        
        # Stream output in real-time
        for line in iter(process.stdout.readline, ''):
            print(line.rstrip())
            sys.stdout.flush()
            
    except KeyboardInterrupt:
        print("\nReceived KeyboardInterrupt. Shutting down...")
        if 'process' in locals():
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        print("EmailAgent stopped successfully")
    except Exception as e:
        print(f"Unexpected error: {e}")
        if 'process' in locals():
            process.terminate()
        raise

if __name__ == "__main__":
    main()
