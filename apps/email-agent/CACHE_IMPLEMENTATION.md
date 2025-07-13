# Email Agent Caching Implementation

## Overview

The email agent has been enhanced with intelligent caching to reduce redundant DynamoDB table scans. This implementation significantly reduces costs and improves performance by caching table data and only refreshing when necessary.

## Problem Solved

Previously, the email agent performed full table scans of multiple DynamoDB tables on every step execution:
- **Student Table** (`students`) - Scanned in Count, Test, Dry-Run, and Send steps
- **Pools Table** (`pools`) - Scanned in Count, Test, Dry-Run, and Send steps  
- **Prompts Table** (`prompts`) - Scanned in Test, Dry-Run, and Send steps
- **Stages Table** (`stages`) - Individual lookups in multiple steps
- **Events Table** (`events`) - Individual lookups in Test, Dry-Run, and Send steps

This resulted in:
- **High DynamoDB costs** from redundant full table scans
- **Poor performance** due to waiting for table scans on each step
- **Scan storms** when multiple sleeping work orders woke up simultaneously

## Solution

### Cache Manager (`TableCacheManager`)

The `TableCacheManager` class handles all caching logic:

```python
class TableCacheManager:
    def __init__(self, logging_config=None):
        self.cache = {}  # table_name -> {'data': [...], 'last_refresh': timestamp}
        self.last_sqs_invalidation = 0
        self.last_sleeping_refresh = 0
```

### Cache Invalidation Rules

The cache follows these invalidation rules:

1. **SQS Start Messages**: All caches are immediately invalidated when an SQS start message is received
2. **Sleeping Work Orders**: If sleeping work orders exist, cache refreshes every 10 minutes (configurable)
3. **No Sleeping Work Orders**: Cache refreshes on every call (immediate invalidation)

### Configuration

The cache refresh interval is configurable via environment variable:

```bash
CACHE_REFRESH_INTERVAL_SECS=600  # 10 minutes default
```

## Implementation Details

### Modified `scan_table()` Method

The `AWSClient.scan_table()` method now includes caching:

```python
def scan_table(self, table_name: str) -> List[Dict]:
    # Check if we have sleeping work orders
    has_sleeping_work_orders = self.has_sleeping_work_orders()
    
    # Check if cache should be refreshed
    if self.cache_manager.should_refresh_cache(table_name, has_sleeping_work_orders):
        # Perform actual scan and cache results
        items = self._perform_actual_scan(table_name)
        self.cache_manager.set_cached_data(table_name, items)
    else:
        # Use cached data
        items = self.cache_manager.get_cached_data(table_name)
    
    return items
```

### Cache Integration Points

1. **SQS Message Processing**: Cache invalidation on start messages
   ```python
   if action == 'start':
       self.aws_client.invalidate_cache_on_sqs_start()
   ```

2. **Sleeping Work Order Detection**: Quick scan to check for sleeping work orders
   ```python
   def has_sleeping_work_orders(self) -> bool:
       response = self.table.scan(
           FilterExpression='#state = :sleeping',
           Limit=1  # Only need to know if any exist
       )
       return len(response.get('Items', [])) > 0
   ```

## Benefits

### Cost Reduction
- **Eliminates redundant scans**: Multiple sleeping work orders no longer cause scan storms
- **Reduces DynamoDB read units**: Cached data reduces total read operations
- **Optimizes scan frequency**: Only scans when data actually needs refreshing

### Performance Improvement
- **Faster step execution**: No waiting for table scans on cached data
- **Reduced latency**: Immediate access to frequently used data
- **Better scalability**: Multiple work orders can process without scan conflicts

### Operational Benefits
- **Predictable costs**: Reduced variance in DynamoDB costs
- **Better monitoring**: Cache hit/miss logging for performance tracking
- **Configurable refresh**: Adjustable cache intervals based on data change frequency

## Error Handling

The implementation includes robust error handling:

- **Cache failures fall back to scanning**: If cache operations fail, the system falls back to the original scanning behavior
- **No retry logic**: As specified, errors are handled by failing the current step and unlocking the work order
- **Graceful degradation**: System continues to function even if caching is disabled

## Future Considerations

### Streaming Updates for Students Table

The implementation is designed to support future streaming updates for the students table:

```python
# Future enhancement - streaming updates instead of full table scans
def get_student_updates_stream():
    # Stream changes from DynamoDB Streams
    # Only process new/updated student records
    pass
```

This would further reduce costs by only processing changed student records rather than scanning the entire table.

## Testing

A test script is included (`test_cache.py`) that verifies:

- Cache manager functionality
- Cache refresh logic for different scenarios
- AWS client integration with caching
- Error handling and fallback behavior

Run the tests with:
```bash
cd apps/email-agent
python test_cache.py
```

## Monitoring

The implementation includes debug logging for cache operations:

- `[CACHE]` prefixed messages show cache hits/misses
- Cache refresh events are logged with reasons
- Error conditions are logged for troubleshooting

## Migration

This implementation is **backward compatible**:
- All existing code continues to work unchanged
- The `scan_table()` method maintains the same interface
- Cache failures fall back to original behavior
- No changes required to step implementations

## Configuration Summary

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CACHE_REFRESH_INTERVAL_SECS` | 600 | Cache refresh interval in seconds when sleeping work orders exist |

The caching implementation provides significant cost and performance benefits while maintaining full backward compatibility and robust error handling. 