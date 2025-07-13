#!/usr/bin/env python3
"""
Test script to verify the caching functionality in the email agent.
This script tests the TableCacheManager and AWSClient caching behavior.
"""

import os
import sys
import time
from unittest.mock import Mock, patch

# Add the src directory to the path so we can import the modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from aws_client import TableCacheManager, AWSClient

def test_cache_manager():
    """Test the TableCacheManager functionality."""
    print("Testing TableCacheManager...")
    
    # Create a mock logging config
    mock_logging = Mock()
    mock_logging.log = Mock()
    
    # Create cache manager
    cache_manager = TableCacheManager(mock_logging)
    
    # Test initial state
    assert len(cache_manager.cache) == 0
    assert cache_manager.last_sqs_invalidation == 0
    assert cache_manager.last_sleeping_refresh == 0
    
    # Test cache invalidation
    cache_manager.invalidate_all_caches("test")
    assert len(cache_manager.cache) == 0
    assert cache_manager.last_sqs_invalidation > 0
    
    # Test cache operations
    test_data = [{"id": "1", "name": "test"}]
    cache_manager.set_cached_data("test_table", test_data)
    assert "test_table" in cache_manager.cache
    assert len(cache_manager.cache["test_table"]["data"]) == 1
    
    # Test cache retrieval
    retrieved_data = cache_manager.get_cached_data("test_table")
    assert retrieved_data == test_data
    
    # Test cache refresh logic
    # No sleeping work orders - should refresh on every call
    should_refresh = cache_manager.should_refresh_cache("test_table", False)
    assert should_refresh == True
    
    # With sleeping work orders - should refresh based on interval
    should_refresh = cache_manager.should_refresh_cache("test_table", True)
    assert should_refresh == False  # Should not refresh immediately
    
    print("✓ TableCacheManager tests passed")

def test_cache_refresh_logic():
    """Test the cache refresh logic with different scenarios."""
    print("Testing cache refresh logic...")
    
    mock_logging = Mock()
    mock_logging.log = Mock()
    cache_manager = TableCacheManager(mock_logging)
    
    # Test 1: No cache exists - should refresh
    should_refresh = cache_manager.should_refresh_cache("new_table", False)
    assert should_refresh == True
    
    # Test 2: Cache exists, no sleeping work orders - should refresh
    cache_manager.set_cached_data("test_table", [{"id": "1"}])
    should_refresh = cache_manager.should_refresh_cache("test_table", False)
    assert should_refresh == True
    
    # Test 3: Cache exists, sleeping work orders, within interval - should not refresh
    cache_manager.set_cached_data("test_table", [{"id": "1"}])
    should_refresh = cache_manager.should_refresh_cache("test_table", True)
    assert should_refresh == False
    
    # Test 4: Cache exists, sleeping work orders, after interval - should refresh
    # Manually set the last refresh time to be old
    cache_manager.cache["test_table"]["last_refresh"] = time.time() - 700  # 11+ minutes ago
    should_refresh = cache_manager.should_refresh_cache("test_table", True)
    assert should_refresh == True
    
    print("✓ Cache refresh logic tests passed")

def test_aws_client_cache_integration():
    """Test the AWSClient integration with caching."""
    print("Testing AWSClient cache integration...")
    
    # Mock the AWS resources
    with patch('boto3.resource'), patch('boto3.client'), patch('boto3.client'):
        mock_logging = Mock()
        mock_logging.log = Mock()
        
        # Create AWS client
        aws_client = AWSClient(mock_logging)
        
        # Test cache invalidation method
        aws_client.invalidate_cache_on_sqs_start()
        assert aws_client.cache_manager.last_sqs_invalidation > 0
        
        # Test sleeping work orders check
        # Mock the table scan response
        with patch.object(aws_client.table, 'scan') as mock_scan:
            # Test with sleeping work orders
            mock_scan.return_value = {'Items': [{'id': 'test'}]}
            has_sleeping = aws_client.has_sleeping_work_orders()
            assert has_sleeping == True
            
            # Test without sleeping work orders
            mock_scan.return_value = {'Items': []}
            has_sleeping = aws_client.has_sleeping_work_orders()
            assert has_sleeping == False
        
        print("✓ AWSClient cache integration tests passed")

def main():
    """Run all cache tests."""
    print("Running cache functionality tests...\n")
    
    try:
        test_cache_manager()
        test_cache_refresh_logic()
        test_aws_client_cache_integration()
        
        print("\n🎉 All cache tests passed!")
        print("\nCache functionality summary:")
        print("- TableCacheManager handles cache storage and invalidation")
        print("- Cache refresh logic works for different scenarios")
        print("- AWSClient integrates caching with scan_table()")
        print("- SQS start messages invalidate all caches")
        print("- Sleeping work orders trigger 10-minute refresh intervals")
        print("- Non-sleeping scenarios refresh on every call")
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main()) 