#!/usr/bin/env python3
"""
Test script for the email agent logging system.
"""

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

def test_logging():
    """Test the logging configuration system."""
    
    print("Testing Email Agent Logging System")
    print("=" * 40)
    
    # Test 1: Default configuration (progress only)
    print("\n1. Testing default configuration (progress only):")
    config1 = LoggingConfig()
    config1.log('progress', '[PROGRESS] This should be visible')
    config1.log('debug', '[DEBUG] This should NOT be visible')
    config1.log('websocket', '[WEBSOCKET] This should NOT be visible')
    config1.log('error', '[ERROR] This should be visible')
    config1.log('warning', '[WARNING] This should be visible')
    
    # Test 2: Multiple levels
    print("\n2. Testing multiple levels (progress, debug, websocket):")
    config2 = LoggingConfig(['progress', 'debug', 'websocket'])
    config2.log('progress', '[PROGRESS] This should be visible')
    config2.log('debug', '[DEBUG] This should be visible')
    config2.log('websocket', '[WEBSOCKET] This should be visible')
    config2.log('steps', '[STEPS] This should NOT be visible')
    config2.log('workorder', '[WORKORDER] This should NOT be visible')
    
    # Test 3: All levels
    print("\n3. Testing all levels:")
    config3 = LoggingConfig(['progress', 'steps', 'workorder', 'debug', 'websocket'])
    config3.log('progress', '[PROGRESS] This should be visible')
    config3.log('steps', '[STEPS] This should be visible')
    config3.log('workorder', '[WORKORDER] This should be visible')
    config3.log('debug', '[DEBUG] This should be visible')
    config3.log('websocket', '[WEBSOCKET] This should be visible')
    
    print("\n" + "=" * 40)
    print("Logging system test completed!")

if __name__ == "__main__":
    test_logging() 