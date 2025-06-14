export interface WorkOrder {
    id: string
    eventCode: string
    subEvent: string
    stage: string
    language: string
    subject: string
    account: string
    createdBy: string
    status: string
    steps: Array<{
        name: 'Prepare' | 'Test' | 'Send'
        status: 'ready' | 'working' | 'complete' | 'error' | 'interrupted'
        message: string
        isActive: boolean
    }>
    createdAt: string
    updatedAt: string
}

export interface WorkOrderResponse {
    workOrders: WorkOrder[]
}

export interface ApiResponse<T> {
    success: boolean
    data?: T
    error?: string
}

export type DbAction =
    | 'handleGetWorkOrders'
    | 'handleGetWorkOrder'
    | 'handleCreateWorkOrder'
    | 'handleUpdateWorkOrder'
    | 'handleDeleteWorkOrder'
    | 'handleUpdateWorkOrderStatus'
    | 'handleUpdateStepStatus'

export interface DbActionParams {
    handleGetWorkOrders: {}
    handleGetWorkOrder: {
        workOrderId: string
    }
    handleCreateWorkOrder: {
        eventCode: string
        subEvent: string
        stage: string
        language: string
        subject: string
        account: string
        createdBy: string
    }
    handleUpdateWorkOrder: {
        id: string
        eventCode: string
        subEvent: string
        stage: string
        language: string
        subject: string
        account: string
        createdBy: string
    }
    handleDeleteWorkOrder: {
        id: string
    }
    handleUpdateWorkOrderStatus: {
        id: string
        status: string
    }
    handleUpdateStepStatus: {
        workOrderId: string
        stepName: 'Prepare' | 'Test' | 'Send'
        status: 'ready' | 'working' | 'complete' | 'error' | 'interrupted'
        message: string
    }
}

export interface DbActionResponse {
    handleGetWorkOrders: WorkOrderResponse
    handleGetWorkOrder: WorkOrder
    handleCreateWorkOrder: { id: string }
    handleUpdateWorkOrder: { success: boolean }
    handleDeleteWorkOrder: { success: boolean }
    handleUpdateWorkOrderStatus: { success: boolean }
    handleUpdateStepStatus: { success: boolean }
} 