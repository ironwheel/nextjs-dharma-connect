# Email Manager

A Next.js frontend application for managing email work orders with real-time updates.

## Architecture

The email manager is part of a real-time communication system using WebSockets and SQS for work order processing:

```mermaid
graph TD
    EM["Email Manager<br/>(Next.js Frontend)"]
    EA["Email Agent<br/>(Python Service)"]
    WS["API Gateway<br/>WebSocket API"]
    SQS["SQS FIFO Queue<br/>work-order-queue.fifo"]
    DDB["DynamoDB Tables<br/>- Work Orders<br/>- WebSocket Connections"]
    L1["Connect Lambda"]
    L2["Disconnect Lambda"]
    L3["Default/Stream Lambda"]

    %% WebSocket Connections
    EM -->|"1. WebSocket Connect"| WS
    WS -->|"2. Route $connect"| L1
    L1 -->|"3. Store Connection ID"| DDB

    %% Real-time Updates
    EA -->|"4. Send Updates"| L3
    L3 -->|"5. Broadcast to Connections"| WS
    WS -->|"6. Real-time Updates"| EM

    %% Work Order Processing
    EM -->|"7. Create Work Order"| DDB
    DDB -->|"8. Stream Changes"| SQS
    EA -->|"9. Poll Queue"| SQS
    EA -->|"10. Process & Update"| DDB

    %% Cleanup
    EM -->|"11. WebSocket Disconnect"| WS
    WS -->|"12. Route $disconnect"| L2
    L2 -->|"13. Remove Connection ID"| DDB

    style EM fill:#d4eaff,stroke:#333
    style EA fill:#ffe7d4,stroke:#333
    style WS fill:#d4ffd4,stroke:#333
    style SQS fill:#ffd4d4,stroke:#333
    style DDB fill:#f0d4ff,stroke:#333
    style L1 fill:#fff3d4,stroke:#333
    style L2 fill:#fff3d4,stroke:#333
    style L3 fill:#fff3d4,stroke:#333
```

### Communication Flow:

1. **WebSocket Setup**:
   - Email Manager connects to WebSocket API
   - Connection ID is stored in DynamoDB

2. **Real-time Updates**:
   - Email Agent sends updates through Lambda
   - Updates are broadcast to all active connections

3. **Work Order Processing**:
   - Work orders are created in DynamoDB
   - Changes stream to SQS queue
   - Email Agent processes work orders
   - Real-time updates sent via WebSocket

4. **Connection Cleanup**:
   - Disconnections are handled automatically
   - Connection IDs are removed from DynamoDB 