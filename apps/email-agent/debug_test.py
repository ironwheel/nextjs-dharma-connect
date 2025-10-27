#!/usr/bin/env python3
"""
Debug test script for email-agent with instrumentation for student 4080c768-1936-46dd-a7b3-a182eaf18191

This script helps run the email-agent locally to debug why the specific student is not receiving
the welcome email for vr20251001 event.

Usage:
    python debug_test.py

The script will run the email-agent with debug logging enabled for the target student.
"""

import subprocess
import sys
import os

def main():
    """Run the email agent with debug logging for the target student."""
    print("Starting email-agent with debug instrumentation for student 4080c768-1936-46dd-a7b3-a182eaf18191")
    print("=" * 80)
    
    # Change to the src directory
    src_dir = os.path.join(os.path.dirname(__file__), 'src')
    os.chdir(src_dir)
    
    try:
        # Run the email-agent as a module
        subprocess.run([sys.executable, '-m', 'agent'], check=True)
    except KeyboardInterrupt:
        print("\nShutting down email-agent...")
    except subprocess.CalledProcessError as e:
        print(f"Error running email-agent: {e}")
    except Exception as e:
        print(f"Unexpected error: {e}")

if __name__ == "__main__":
    main()
