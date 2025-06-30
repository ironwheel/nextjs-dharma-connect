import React, { useEffect, useState, useRef } from 'react'
import { Table, Button, Badge, Modal } from 'react-bootstrap'
import { toast } from 'react-toastify'
import { callDbApi } from '@dharma/shared/src/clientApi'
import { useWebSocketContext } from '../context/WebSocketProvider'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import OverlayTrigger from 'react-bootstrap/OverlayTrigger'
import Popover from 'react-bootstrap/Popover'

interface WorkOrder {
    id: string
    eventCode: string
    subEvent: string
    stage: string
    language?: string
    languages?: { [key: string]: boolean }
    subjects?: { [lang: string]: string }
    account: string
    createdBy: string
    zoomId?: string
    inPerson?: boolean
    config?: { [key: string]: any }
    testers?: string[]
    sendContinuously?: boolean
    sendUntil?: string
    steps: Array<{
        name: 'Count' | 'Prepare' | 'Dry-Run' | 'Test' | 'Send-Once' | 'Send-Continuously'
        status: 'ready' | 'working' | 'complete' | 'error' | 'interrupted' | 'exception'
        message: string
        isActive: boolean
    }>
    createdAt: string
    updatedAt: string
    locked: boolean
    lockedBy?: string
    dryRunRecipients?: { id: string; name: string; email: string }[]
    sendRecipients?: { id: string; name: string; email: string }[]
    archived?: boolean
    archivedAt?: string
    archivedBy?: string
}

interface WorkOrderListProps {
    onEdit: (id: string) => void
    onNew: () => void
    refreshTrigger?: number
    userPid: string
}

export default function WorkOrderList({ onEdit, onNew, refreshTrigger = 0, userPid }: WorkOrderListProps) {
    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
    const [loading, setLoading] = useState(true)
    const [activeSteps, setActiveSteps] = useState<Record<string, boolean>>({})
    const [participantNames, setParticipantNames] = useState<Record<string, string>>({})
    const [hoveredRow, setHoveredRow] = useState<string | null>(null)
    const [showRecipientsModal, setShowRecipientsModal] = useState(false)
    const [currentRecipients, setCurrentRecipients] = useState<{ id: string; name: string; email: string }[]>([])
    const [recipientsType, setRecipientsType] = useState<'dry-run' | 'send'>('dry-run')
    const [showArchiveModal, setShowArchiveModal] = useState(false)
    const [archivedWorkOrders, setArchivedWorkOrders] = useState<WorkOrder[]>([])
    const [loadingArchived, setLoadingArchived] = useState(false)
    const [currentWorkOrderIndex, setCurrentWorkOrderIndex] = useState(0)
    const { lastMessage, status, connectionId } = useWebSocketContext()
    const prevWorkOrdersRef = useRef<WorkOrder[]>([])

    // Navigation functions
    const goToNextWorkOrder = () => {
        if (currentWorkOrderIndex < workOrders.length - 1) {
            setCurrentWorkOrderIndex(currentWorkOrderIndex + 1)
        }
    }

    const goToPreviousWorkOrder = () => {
        if (currentWorkOrderIndex > 0) {
            setCurrentWorkOrderIndex(currentWorkOrderIndex - 1)
        }
    }

    const goToFirstWorkOrder = () => {
        setCurrentWorkOrderIndex(0)
    }

    const goToLastWorkOrder = () => {
        setCurrentWorkOrderIndex(workOrders.length - 1)
    }

    // Reset current index when work orders change
    useEffect(() => {
        if (workOrders.length > 0 && currentWorkOrderIndex >= workOrders.length) {
            setCurrentWorkOrderIndex(0)
        }
    }, [workOrders, currentWorkOrderIndex])

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (workOrders.length === 0) return

            switch (event.key) {
                case 'ArrowUp':
                    event.preventDefault()
                    goToPreviousWorkOrder()
                    break
                case 'ArrowDown':
                    event.preventDefault()
                    goToNextWorkOrder()
                    break
                case 'Home':
                    event.preventDefault()
                    goToFirstWorkOrder()
                    break
                case 'End':
                    event.preventDefault()
                    goToLastWorkOrder()
                    break
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [currentWorkOrderIndex, workOrders.length])

    const downloadRecipientsCSV = (recipients: { id: string; name: string; email: string }[]) => {
        const csvContent = [
            'Name,Email,ID',
            ...recipients.map(r => `"${r.name}","${r.email}","${r.id}"`)
        ].join('\n')

        const blob = new Blob([csvContent], { type: 'text/csv' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `dry-run-recipients-${new Date().toISOString().split('T')[0]}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)
    }

    const openRecipientsModal = (recipients: { id: string; name: string; email: string }[], type: 'dry-run' | 'send' = 'dry-run') => {
        setCurrentRecipients(Array.isArray(recipients) ? recipients : []);
        setRecipientsType(type);
        setShowRecipientsModal(true);
    }

    const loadArchivedWorkOrders = async () => {
        setLoadingArchived(true)
        try {
            const result = await callDbApi('getArchivedWorkOrders', {})
            if (result && result.workOrders) {
                setArchivedWorkOrders(result.workOrders)
            }
        } catch (error) {
            console.error('Failed to load archived work orders:', error)
            toast.error('Failed to load archived work orders')
        } finally {
            setLoadingArchived(false)
        }
    }

    const openArchiveModal = async () => {
        setShowArchiveModal(true)
        await loadArchivedWorkOrders()
    }

    const archiveWorkOrder = async (workOrderId: string) => {
        try {
            await callDbApi('archiveWorkOrder', { workOrderId, archivedBy: userPid })
            toast.success('Work order archived successfully')
            loadWorkOrders() // Refresh the main list
        } catch (error) {
            console.error('Failed to archive work order:', error)
            toast.error('Failed to archive work order')
        }
    }

    const unarchiveWorkOrder = async (workOrderId: string) => {
        try {
            await callDbApi('unarchiveWorkOrder', { workOrderId })
            toast.success('Work order restored successfully')
            loadArchivedWorkOrders() // Refresh the archive list
            loadWorkOrders() // Refresh the main list
        } catch (error) {
            console.error('Failed to unarchive work order:', error)
            toast.error('Failed to restore work order')
        }
    }

    const isWorkOrderCompleted = (workOrder: WorkOrder) => {
        return workOrder.steps && workOrder.steps.every(step => {
            const status = typeof step.status === 'string' ? step.status :
                (step.status && typeof step.status === 'object' && 'S' in step.status) ?
                    (step.status as { S: string }).S : 'ready'
            return status === 'complete'
        })
    }

    const loadParticipantName = async (pid: string) => {
        if (!pid || participantNames[pid]) return
        try {
            const result = await callDbApi('handleFindParticipant', { id: pid })
            if (result && (result.first || result.last)) {
                setParticipantNames(prev => ({ ...prev, [pid]: `${result.first || ''} ${result.last || ''}`.trim() }))
            } else {
                setParticipantNames(prev => ({ ...prev, [pid]: pid }))
            }
        } catch (err) {
            setParticipantNames(prev => ({ ...prev, [pid]: pid }))
        }
    }

    const loadWorkOrders = async () => {
        setLoading(true)
        try {
            const result = await callDbApi('getWorkOrders', {})
            if (result && result.workOrders) {
                // Filter out archived work orders from the main list
                const activeWorkOrders = result.workOrders.filter((wo: WorkOrder) => !wo.archived)
                setWorkOrders(activeWorkOrders)

                // Load participant names for all work orders
                const uniquePids = new Set<string>()
                activeWorkOrders.forEach(wo => {
                    if (wo.createdBy) uniquePids.add(wo.createdBy)
                })

                uniquePids.forEach(pid => {
                    if (!participantNames[pid]) {
                        loadParticipantName(pid)
                    }
                })
            }
        } catch (error) {
            console.error('Failed to load work orders:', error)
            toast.error('Failed to load work orders')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadWorkOrders()
    }, [refreshTrigger])

    // Debug effect to log when workOrders state changes
    useEffect(() => {
        console.log('[DEBUG] workOrders state changed:', workOrders.length, workOrders);
    }, [workOrders]);

    useEffect(() => {
        if (lastMessage && lastMessage.type === 'workOrderUpdate') {
            console.log('Received WebSocket work order update:', lastMessage)
            console.log('[DEBUG] Full WebSocket message structure:', JSON.stringify(lastMessage, null, 2))

            // Handle DynamoDB Stream messages (from DynamoDB Streams)
            const newImage = lastMessage.newImage
            if (newImage) {
                const updatedWorkOrder = unmarshall(newImage) as WorkOrder
                console.log('Unmarshalled work order update:', updatedWorkOrder)
                console.log('[DEBUG] Work order lock status after update:', updatedWorkOrder.locked, 'LockedBy:', updatedWorkOrder.lockedBy);
                console.log('[DEBUG] Steps data from DynamoDB Stream:', updatedWorkOrder.steps);

                if (updatedWorkOrder) {
                    setWorkOrders(prevOrders => {
                        const index = prevOrders.findIndex(wo => wo.id === updatedWorkOrder.id)

                        if (index === -1) {
                            // If it's a new work order, add it to the list and sort
                            const newOrders = [updatedWorkOrder, ...prevOrders]
                            newOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                            return newOrders
                        }

                        // Simply update with the real data from DynamoDB
                        const newOrders = [...prevOrders]
                        newOrders[index] = updatedWorkOrder;

                        console.log('Updated work order in list:', newOrders[index])
                        return newOrders
                    })
                }
            }

            // Handle direct WebSocket messages (from email-agent)
            const workOrder = lastMessage.workOrder
            if (workOrder) {
                console.log('Received direct work order update:', workOrder)
                console.log('[DEBUG] Direct work order lock status:', workOrder.locked, 'LockedBy:', workOrder.lockedBy);
                console.log('[DEBUG] Steps data from direct message:', workOrder.steps);
                console.log('[DEBUG] Full work order data:', JSON.stringify(workOrder, null, 2));

                // Convert the work order data to the expected format
                const updatedWorkOrder: WorkOrder = {
                    id: workOrder.id,
                    eventCode: workOrder.eventCode || '',
                    subEvent: workOrder.subEvent || '',
                    stage: workOrder.stage || '',
                    languages: workOrder.languages || {},
                    subjects: workOrder.subjects || {},
                    account: workOrder.account || '',
                    createdBy: workOrder.createdBy || '',
                    steps: workOrder.steps || [],
                    createdAt: workOrder.createdAt || '',
                    updatedAt: workOrder.updatedAt || '',
                    locked: workOrder.locked || false,
                    lockedBy: workOrder.lockedBy,
                    zoomId: workOrder.zoomId,
                    inPerson: workOrder.inPerson,
                    config: workOrder.config || {},
                    testers: workOrder.testers || [],
                    sendContinuously: workOrder.sendContinuously,
                    sendUntil: workOrder.sendUntil,
                    dryRunRecipients: workOrder.dryRunRecipients || [],
                    sendRecipients: workOrder.sendRecipients || [],
                    archived: workOrder.archived,
                    archivedAt: workOrder.archivedAt,
                    archivedBy: workOrder.archivedBy,
                }

                console.log('[DEBUG] Converted work order for state update:', updatedWorkOrder);
                console.log('[DEBUG] Steps after conversion:', updatedWorkOrder.steps);
                console.log('[DEBUG] Locked status after conversion:', updatedWorkOrder.locked, 'lockedBy:', updatedWorkOrder.lockedBy);

                setWorkOrders(prevOrders => {
                    const index = prevOrders.findIndex(wo => wo.id === updatedWorkOrder.id)

                    if (index === -1) {
                        // If it's a new work order, add it to the list and sort
                        const newOrders = [updatedWorkOrder, ...prevOrders]
                        newOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                        return newOrders
                    }

                    // Simply update with the real data from DynamoDB
                    const newOrders = [...prevOrders]
                    newOrders[index] = updatedWorkOrder;

                    console.log('Updated work order in list:', newOrders[index])
                    return newOrders
                })
            }
        }
    }, [lastMessage])

    useEffect(() => {
        // If a new work order is added, select the newest one (by createdAt)
        if (workOrders.length > prevWorkOrdersRef.current.length) {
            // Find the newest work order by createdAt
            let newestIndex = 0;
            let newestDate = new Date(workOrders[0]?.createdAt || 0).getTime();
            for (let i = 1; i < workOrders.length; i++) {
                const d = new Date(workOrders[i].createdAt || 0).getTime();
                if (d > newestDate) {
                    newestDate = d;
                    newestIndex = i;
                }
            }
            setCurrentWorkOrderIndex(newestIndex);
        }
        prevWorkOrdersRef.current = workOrders;
    }, [workOrders]);

    const handleRowClick = async (workOrder: WorkOrder) => {
        console.log('[DEBUG] Row clicked for work order:', workOrder.id, 'Locked:', workOrder.locked, 'LockedBy:', workOrder.lockedBy);

        if (workOrder.locked) {
            // Don't allow editing if locked
            console.log('Work order is locked, cannot edit:', workOrder.id)
            return
        }

        console.log('Attempting to lock work order:', workOrder.id, 'for user:', userPid)

        // Try to lock the work order before opening for edit
        try {
            const lockResult = await callDbApi('handleLockWorkOrder', {
                id: workOrder.id,
                userPid
            })

            console.log('Lock result:', lockResult)

            if (lockResult.success && lockResult.workOrder) {
                // Update state immediately with the returned work order
                setWorkOrders(prevOrders => {
                    const index = prevOrders.findIndex(wo => wo.id === (lockResult.workOrder as WorkOrder).id)
                    if (index === -1) return prevOrders // Should not happen
                    const newOrders = [...prevOrders]
                    newOrders[index] = lockResult.workOrder as WorkOrder
                    console.log('[DEBUG] Updated work order in state after lock:', newOrders[index])
                    return newOrders
                })

                // Successfully locked, proceed with edit
                console.log('Successfully locked work order, opening edit dialog')
                onEdit(workOrder.id)
            } else {
                // Failed to lock (probably locked by another user)
                console.log('Failed to lock work order:', lockResult.error)
                toast.error(lockResult.error || 'Work order is locked by another user')
                // Optional: Force a refresh in case our state is stale
                loadWorkOrders()
            }
        } catch (error) {
            console.error('Error locking work order:', error)
            toast.error('Failed to lock work order')
        }
    }

    const getStatusBadgeClass = (status: string | { value: string } | undefined, isActive: boolean) => {
        // Handle undefined or null status
        if (!status) {
            console.warn('Status is undefined or null, defaulting to secondary')
            return 'bg-secondary'
        }

        // Handle both string and enum values
        const statusStr = typeof status === 'string' ? status : status.value

        if (!statusStr) {
            console.warn('Status string is empty, defaulting to secondary')
            return 'bg-secondary'
        }

        if ((!isActive && statusStr.toLowerCase() === 'ready') || statusStr.toLowerCase() === 'ready') {
            return 'bg-secondary text-dark' // light gray for pending and ready
        }

        switch (statusStr.toLowerCase()) {
            case 'working':
                return 'bg-info'
            case 'complete':
                return 'bg-success'
            case 'error':
                return 'bg-danger'
            case 'interrupted':
                return 'bg-warning'
            case 'exception':
                return 'bg-purple' // Purple for exception status
            default:
                console.warn('Unknown status:', statusStr)
                return 'bg-secondary'
        }
    }

    const handleStepAction = async (
        id: string,
        stepName: 'Count' | 'Prepare' | 'Dry-Run' | 'Test' | 'Send' ,
        isStarting: boolean
    ) => {
        console.log(`[STEP-ACTION] Starting step action for work order ${id}, step ${stepName}, isStarting: ${isStarting}`);
        console.log(`[STEP-ACTION] Timestamp: ${new Date().toISOString()}`);

        try {
            // Find the current step to check if it's a restart of a failed step
            const workOrder = workOrders.find(wo => wo.id === id);
            const step = workOrder?.steps.find(s => {
                const stepNameStr = typeof s.name === 'string' ? s.name :
                    (s.name && typeof s.name === 'object' && 'S' in s.name) ? (s.name as { S: string }).S : '';
                return stepNameStr === stepName;
            });

            const stepStatus = typeof step?.status === 'string' ? step.status :
                (step?.status && typeof step?.status === 'object' && 'S' in step?.status) ?
                    (step?.status as { S: string }).S : '';

            console.log(`[STEP-ACTION] Current step status: ${stepStatus}`);
            console.log(`[STEP-ACTION] Step data:`, step);

            // If starting a step, implement optimistic UI update
            if (isStarting) {
                // Immediately update the UI to show "working" status
                setWorkOrders(prevOrders => {
                    return prevOrders.map(wo => {
                        if (wo.id === id) {
                            return {
                                ...wo,
                                steps: wo.steps.map(s => {
                                    const stepNameStr = typeof s.name === 'string' ? s.name :
                                        (s.name && typeof s.name === 'object' && 'S' in s.name) ? (s.name as { S: string }).S : '';

                                    if (stepNameStr === stepName) {
                                        return {
                                            ...s,
                                            status: 'working',
                                            message: 'Beginning work...',
                                            isActive: true
                                        };
                                    }
                                    return s;
                                })
                            };
                        }
                        return wo;
                    });
                });

                console.log(`[STEP-ACTION] Applied optimistic update for ${id}-${stepName}`);
            }

            // Determine the action to send to the email-agent
            const action = isStarting ? 'start' : 'stop';
            console.log(`[STEP-ACTION] Sending ${action} action to email-agent for work order ${id}, step ${stepName}`);

            // Send SQS message to email-agent - let the agent handle all step state updates
            await callDbApi('sendWorkOrderMessage', {
                workOrderId: id,
                stepName: stepName,
                action: action
            });

            console.log(`[STEP-ACTION] SUCCESS: Sent ${action} message to email-agent for work order ${id}, step ${stepName}`);

        } catch (error) {
            console.error(`[STEP-ACTION] ERROR: Failed to send ${isStarting ? 'start' : 'stop'} message to email-agent:`, error);

            // Show error to user
            alert(`Failed to ${isStarting ? 'start' : 'stop'} step: ${error}`);
        }
    }

    const getDisplayStepName = (stepName: string, workOrder: any) => {
        if (stepName === 'Send') {
            return workOrder.sendContinuously ? 'Send-Continuously' : 'Send-Once';
        }
        return stepName;
    };

    if (loading) {
        return <div>Loading work orders...</div>
    }
    if (workOrders.length === 0) {
        return (
            <div className="bg-dark text-light min-vh-100">
                <div className="d-flex justify-content-between align-items-center mb-3" style={{ marginBottom: 0, paddingBottom: 0, gap: 0, minHeight: 0 }}>
                    <div className="d-flex align-items-center" style={{ gap: 6, margin: 0, padding: 0 }}>
                        <div className="ms-1" style={{ margin: 0, padding: 0 }}>
                            <Badge bg={status === 'open' ? 'success' : status === 'connecting' ? 'warning' : 'danger'}>
                                WebSocket: {status}
                            </Badge>
                            {connectionId && (
                                <Badge bg="info" className="ms-1">
                                    ID: {connectionId}
                                </Badge>
                            )}
                        </div>
                    </div>
                    <div className="d-flex align-items-center" style={{ gap: 8, margin: 0, padding: 0 }}>
                        <Button
                            variant="outline-secondary"
                            onClick={openArchiveModal}
                            size="sm"
                        >
                            📁 Archived Work Orders
                        </Button>
                    </div>
                </div>
                <div className="d-flex justify-content-center align-items-center" style={{ height: '300px', color: '#bbb', fontSize: '1.5rem' }}>
                    Work Order List is Empty
                </div>
            </div>
        )
    }

    return (
        <div className="bg-dark text-light">
            <div className="d-flex justify-content-between align-items-center mb-3" style={{ marginBottom: 0, paddingBottom: 0, gap: 0, minHeight: 0 }}>
                <div className="d-flex align-items-center" style={{ gap: 6, margin: 0, padding: 0 }}>
                    <div className="ms-1" style={{ margin: 0, padding: 0 }}>
                        <Badge bg={status === 'open' ? 'success' : status === 'connecting' ? 'warning' : 'danger'}>
                            WebSocket: {status}
                        </Badge>
                        {connectionId && (
                            <Badge bg="info" className="ms-1">
                                ID: {connectionId}
                            </Badge>
                        )}
                    </div>
                </div>
                <div className="d-flex align-items-center" style={{ gap: 8, margin: 0, padding: 0 }}>
                    <div className="d-flex align-items-center flex-column" style={{ minWidth: 60, padding: 0, margin: 0, gap: 2 }}>
                        <div style={{ fontWeight: 700, fontSize: 22, color: '#51cfef', marginBottom: 0, marginTop: 0, textAlign: 'center', lineHeight: 1 }}>
                            {workOrders.length}
                        </div>
                        <div className="d-flex flex-row align-items-center justify-content-center" style={{ gap: 8, margin: 0, padding: 0 }}>
                            <Button
                                variant="primary"
                                onClick={goToPreviousWorkOrder}
                                disabled={currentWorkOrderIndex === 0}
                                size="lg"
                                style={{
                                    borderRadius: '50%',
                                    width: 40,
                                    height: 40,
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: '#0d6efd',
                                    border: 'none',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.10)'
                                }}
                                title="Previous work order"
                            >
                                <svg width="22" height="22" viewBox="0 0 22 22" style={{ display: 'block', margin: 'auto' }}>
                                    <line x1="15" y1="4" x2="7" y2="11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"/>
                                    <line x1="7" y1="11" x2="15" y2="18" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"/>
                                </svg>
                            </Button>
                            <Button
                                variant="primary"
                                onClick={onNew}
                                style={{
                                    borderRadius: '50%',
                                    width: 40,
                                    height: 40,
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: '#0d6efd',
                                    border: 'none',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.10)'
                                }}
                                title="Create new work order"
                            >
                                <svg width="22" height="22" viewBox="0 0 22 22" style={{ display: 'block', margin: 'auto' }}>
                                    <line x1="11" y1="5" x2="11" y2="17" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"/>
                                    <line x1="5" y1="11" x2="17" y2="11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"/>
                                </svg>
                            </Button>
                            <Button
                                variant="primary"
                                onClick={goToNextWorkOrder}
                                disabled={currentWorkOrderIndex === workOrders.length - 1}
                                size="lg"
                                style={{
                                    borderRadius: '50%',
                                    width: 40,
                                    height: 40,
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: '#0d6efd',
                                    border: 'none',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.10)'
                                }}
                                title="Next work order"
                            >
                                <svg width="22" height="22" viewBox="0 0 22 22" style={{ display: 'block', margin: 'auto' }}>
                                    <line x1="7" y1="4" x2="15" y2="11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"/>
                                    <line x1="15" y1="11" x2="7" y2="18" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"/>
                                </svg>
                            </Button>
                        </div>
                        <span className="mt-1 text-muted" style={{ fontSize: 13, textAlign: 'center', width: '100%', margin: 0, padding: 0, lineHeight: 1 }}>
                            {workOrders.length > 0 ? `${currentWorkOrderIndex + 1} of ${workOrders.length}` : 'No work orders'}
                        </span>
                        <small className="text-muted" style={{ textAlign: 'center', width: '100%', margin: 0, padding: 0, lineHeight: 1 }}>
                            (←→ arrows, Home/End keys)
                        </small>
                    </div>
                    <Button
                        variant="outline-secondary"
                        onClick={openArchiveModal}
                        size="sm"
                        style={{ margin: 0, padding: '2px 8px', height: 32, display: 'flex', alignItems: 'center' }}
                    >
                        📁 Archived Work Orders
                    </Button>
                </div>
            </div>
            
            {workOrders.length > 0 ? (
                <div>
                    <Table borderless hover variant="dark" className="mb-0">
                        <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: '#212529' }}>
                            <tr style={{ border: 'none' }}>
                                <th style={{ border: 'none' }}>Status</th>
                                <th style={{ border: 'none' }}>Event Code</th>
                                <th style={{ border: 'none' }}>Sub Event</th>
                                <th style={{ border: 'none' }}>Stage</th>
                                <th style={{ border: 'none' }}>Languages</th>
                                <th style={{ border: 'none' }}>Email Account</th>
                                <th style={{ border: 'none' }}>Created By</th>
                                <th style={{ border: 'none' }}>Archive</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(() => {
                                const workOrder = workOrders[currentWorkOrderIndex]
                                return (
                                    <React.Fragment key={workOrder.id}>
                                        <tr
                                            onClick={() => handleRowClick(workOrder)}
                                            onMouseEnter={() => setHoveredRow(workOrder.id)}
                                            onMouseLeave={() => setHoveredRow(null)}
                                            style={{ cursor: workOrder.locked ? 'not-allowed' : 'pointer' }}
                                        >
                                            <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.id ? '#484b50' : '#3a3d40' }}>
                                                <div className="d-flex align-items-center">
                                                    <Badge
                                                        bg={workOrder.locked ? 'danger' : 'success'}
                                                        className="px-3 py-2"
                                                    >
                                                        {workOrder.locked ? 'Locked' : 'Edit'}
                                                    </Badge>
                                                    {!workOrder.archived && isWorkOrderCompleted(workOrder) && (
                                                        <Button
                                                            variant="warning"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                if (confirm('Are you sure you want to archive this completed work order?')) {
                                                                    archiveWorkOrder(workOrder.id)
                                                                }
                                                            }}
                                                            style={{ marginLeft: 8 }}
                                                            title="Archive completed work order"
                                                        >
                                                            📁
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.id ? '#484b50' : '#3a3d40' }}>
                                                {workOrder.eventCode}
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.id ? '#484b50' : '#3a3d40' }}>{workOrder.subEvent}</td>
                                            <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.id ? '#484b50' : '#3a3d40' }}>{workOrder.stage}</td>
                                            <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.id ? '#484b50' : '#3a3d40' }}>{Object.keys(workOrder.languages ?? {}).filter(lang => !!workOrder.languages?.[lang]).join(',')}</td>
                                            <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.id ? '#484b50' : '#3a3d40' }}>{workOrder.account}</td>
                                            <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.id ? '#484b50' : '#3a3d40' }}>{participantNames[workOrder.createdBy] || workOrder.createdBy}</td>
                                            <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.id ? '#484b50' : '#3a3d40', textAlign: 'center' }}>
                                                <Button
                                                    variant="warning"
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (!workOrder.locked && confirm('Are you sure you want to archive this work order?')) {
                                                            archiveWorkOrder(workOrder.id);
                                                        }
                                                    }}
                                                    disabled={workOrder.locked}
                                                    title={workOrder.locked ? 'Work order is locked' : 'Archive work order'}
                                                >
                                                    📁
                                                </Button>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td colSpan={8} style={{ padding: 0, background: 'transparent', border: 'none' }}>
                                                {(workOrder.steps || []).map((step, index) => {
                                                    // Helper function to extract string values from DynamoDB format or plain strings
                                                    const extractString = (value: any): string => {
                                                        if (typeof value === 'string') return value;
                                                        if (value && typeof value === 'object' && 'S' in value) return (value as { S: string }).S;
                                                        if (value && typeof value === 'object' && 'value' in value) return (value as { value: string }).value;
                                                        return String(value || '');
                                                    };

                                                    // Extract all step properties as strings
                                                    const stepName = extractString(step.name);
                                                    const stepStatus = extractString(step.status);
                                                    const stepMessage = extractString(step.message);
                                                    const stepIsActive = typeof step.isActive === 'boolean' ? step.isActive :
                                                        (step.isActive && typeof step.isActive === 'object' && 'BOOL' in step.isActive) ?
                                                            (step.isActive as { BOOL: boolean }).BOOL : false;

                                                    // Debug logging for step data
                                                    if (stepStatus === 'error' || stepMessage) {
                                                        console.log('[DEBUG] Step data for', workOrder.id, stepName, ':', {
                                                            step,
                                                            stepName,
                                                            stepStatus,
                                                            stepMessage,
                                                            stepIsActive,
                                                            rawMessage: step.message,
                                                            messageType: typeof step.message,
                                                            messageKeys: step.message && typeof step.message === 'object' ? Object.keys(step.message) : 'N/A'
                                                        });
                                                    }

                                                    const isWorking = stepStatus === 'working' || stepIsActive;
                                                    const isComplete = stepStatus === 'complete';
                                                    const isError = stepStatus === 'error' || stepStatus === 'exception';
                                                    const isInterrupted = stepStatus === 'interrupted';
                                                    const isPending = stepStatus === 'ready';

                                                    const messageColor = isError ? '#ff6b6b' :
                                                        isComplete ? '#51cf66' :
                                                            isInterrupted ? '#ffd43b' :
                                                                isWorking ? '#74c0fc' : '#adb5bd';

                                                    // Spinner only for 'working' status
                                                    const showSpinner = stepStatus === 'working';

                                                    // Button label logic
                                                    let buttonLabel = 'Start';
                                                    if (stepStatus === 'working') buttonLabel = 'Stop';
                                                    else if (stepStatus === 'complete' || stepStatus === 'error') buttonLabel = 'Restart';

                                                    // Badge color logic
                                                    let badgeStyle = {};
                                                    let badgeBg = getStatusBadgeClass(stepStatus, stepIsActive);
                                                    if (stepStatus === 'error') {
                                                        badgeStyle = { backgroundColor: '#dc3545', color: '#fff' };
                                                    } else if (stepStatus === 'complete') {
                                                        badgeStyle = { backgroundColor: '#51cfef', color: '#222' };
                                                    }

                                                    return (
                                                        <div key={index} style={{
                                                            padding: '12px 16px',
                                                            borderBottom: index < (workOrder.steps?.length || 0) - 1 ? '1px solid #495057' : 'none',
                                                            background: isWorking ? '#2b3035' : 'transparent'
                                                        }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                <div style={{ flex: 1 }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                                        <span style={{
                                                                            fontSize: '0.9rem',
                                                                            fontWeight: 'bold',
                                                                            color:
                                                                                !stepIsActive ? '#adb5bd' :
                                                                                (stepIsActive && stepStatus === 'ready') ? '#fff' :
                                                                                stepStatus === 'error' ? '#dc3545' :
                                                                                stepStatus === 'complete' ? '#51cfef' :
                                                                                stepStatus === 'working' ? '#fff' :
                                                                                stepStatus === 'sleeping' ? '#51cfef' :
                                                                                '#adb5bd',
                                                                        }}>
                                                                            {getDisplayStepName(stepName, workOrder)}
                                                                        </span>
                                                                        {stepStatus !== 'ready' && (
                                                                            <span
                                                                                style={{
                                                                                    fontSize: '0.85rem',
                                                                                    fontWeight: 600,
                                                                                    marginLeft: 8,
                                                                                    color:
                                                                                        stepStatus === 'error' ? '#dc3545' :
                                                                                        stepStatus === 'complete' ? '#51cfef' :
                                                                                        stepStatus === 'working' ? '#fff' :
                                                                                        stepStatus === 'sleeping' ? '#51cfef' :
                                                                                        '#adb5bd',
                                                                                    letterSpacing: 0.5,
                                                                                }}
                                                                            >
                                                                                {stepStatus === 'sleeping' ? 'Sleeping' : stepStatus}
                                                                            </span>
                                                                        )}
                                                                        {(showSpinner || stepStatus === 'sleeping') && (
                                                                            <div className="spinner-border spinner-border-sm" role="status" style={{ width: '12px', height: '12px', marginLeft: 6 }}>
                                                                                <span className="visually-hidden">Loading...</span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div style={{ flex: 4, color: isInterrupted ? '#fff' : messageColor }}>
                                                                        <span>{stepMessage}</span>
                                                                    </div>
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                                    {/* Button logic for each step */}
                                                                    {stepName === 'Count' && (
                                                                        <Button
                                                                            size="sm"
                                                                            variant={stepStatus === 'working' ? 'warning' : 'success'}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation()
                                                                                handleStepAction(workOrder.id, 'Count', stepStatus !== 'working')
                                                                            }}
                                                                            disabled={false}
                                                                        >
                                                                            {buttonLabel}
                                                                        </Button>
                                                                    )}
                                                                    {stepName === 'Prepare' && (() => {
                                                                        const countStep = workOrder.steps?.find(s => extractString(s.name) === 'Count')
                                                                        const enabled = countStep && extractString(countStep.status) === 'complete'
                                                                        return enabled ? (
                                                                            <Button
                                                                                size="sm"
                                                                                variant={stepStatus === 'working' ? 'warning' : 'success'}
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation()
                                                                                    handleStepAction(workOrder.id, 'Prepare', stepStatus !== 'working')
                                                                                }}
                                                                                disabled={false}
                                                                            >
                                                                                {buttonLabel}
                                                                            </Button>
                                                                        ) : null
                                                                    })()}
                                                                    {stepName === 'Dry-Run' && (() => {
                                                                        const prepareStep = workOrder.steps?.find(s => extractString(s.name) === 'Prepare')
                                                                        const enabled = prepareStep && extractString(prepareStep.status) === 'complete'
                                                                        return enabled ? (
                                                                            <>
                                                                                {(workOrder.dryRunRecipients || []).length > 0 && (
                                                                                    <Button
                                                                                        size="sm"
                                                                                        variant="outline-info"
                                                                                        onClick={() => {
                                                                                            const recipients = [...(workOrder.dryRunRecipients || [])].sort((a, b) => a.name.localeCompare(b.name));
                                                                                            openRecipientsModal(recipients, 'dry-run');
                                                                                        }}
                                                                                        style={{ marginRight: 6 }}
                                                                                    >
                                                                                        {(() => {
                                                                                            let lang = workOrder.language;
                                                                                            if (!lang && workOrder.languages && Object.keys(workOrder.languages).length > 0) {
                                                                                                lang = Object.keys(workOrder.languages)[0];
                                                                                            }
                                                                                            const count = (workOrder.dryRunRecipients || []).length;
                                                                                            return `View Results${lang ? ` [${lang}]` : ''} (${count})`;
                                                                                        })()}
                                                                                    </Button>
                                                                                )}
                                                                                <Button
                                                                                    size="sm"
                                                                                    variant={stepStatus === 'working' ? 'warning' : 'success'}
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation()
                                                                                        handleStepAction(workOrder.id, 'Dry-Run', stepStatus !== 'working')
                                                                                    }}
                                                                                    disabled={false}
                                                                                >
                                                                                    {buttonLabel}
                                                                                </Button>
                                                                            </>
                                                                        ) : null
                                                                    })()}
                                                                    {stepName === 'Test' && (() => {
                                                                        const dryRunStep = workOrder.steps?.find(s => extractString(s.name) === 'Dry-Run')
                                                                        const enabled = dryRunStep && extractString(dryRunStep.status) === 'complete'
                                                                        return enabled ? (
                                                                            <Button
                                                                                size="sm"
                                                                                variant={stepStatus === 'working' ? 'warning' : 'success'}
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation()
                                                                                    handleStepAction(workOrder.id, 'Test', stepStatus !== 'working')
                                                                                }}
                                                                                disabled={false}
                                                                            >
                                                                                {buttonLabel}
                                                                            </Button>
                                                                        ) : null
                                                                    })()}
                                                                    {stepName === 'Send' && (stepStatus !== 'sleeping' ? true : true) && (() => {
                                                                        const testStep = workOrder.steps?.find(s => extractString(s.name) === 'Test')
                                                                        const enabled = testStep && extractString(testStep.status) === 'complete'
                                                                        // Show Stop button for both working and sleeping
                                                                        if (stepStatus === 'working' || stepStatus === 'sleeping') {
                                                                            return (
                                                                                <>
                                                                                    {(workOrder.sendRecipients || []).length > 0 && (
                                                                                        <Button
                                                                                            size="sm"
                                                                                            variant="outline-info"
                                                                                            onClick={() => {
                                                                                                const recipients = [...(workOrder.sendRecipients || [])].sort((a, b) => a.name.localeCompare(b.name));
                                                                                                openRecipientsModal(recipients, 'send');
                                                                                            }}
                                                                                            style={{ marginRight: 6 }}
                                                                                        >
                                                                                            {(() => {
                                                                                                let lang = workOrder.language;
                                                                                                if (!lang && workOrder.languages && Object.keys(workOrder.languages).length > 0) {
                                                                                                    lang = Object.keys(workOrder.languages)[0];
                                                                                                }
                                                                                                const count = (workOrder.sendRecipients || []).length;
                                                                                                return `View Results${lang ? ` [${lang}]` : ''} (${count})`;
                                                                                            })()}
                                                                                        </Button>
                                                                                    )}
                                                                                    <Button
                                                                                        size="sm"
                                                                                        variant="danger"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation()
                                                                                            handleStepAction(workOrder.id, 'Send', false)
                                                                                        }}
                                                                                        disabled={false}
                                                                                    >
                                                                                        Stop
                                                                                    </Button>
                                                                                </>
                                                                            )
                                                                        }
                                                                        return enabled ? (
                                                                            <>
                                                                                {(workOrder.sendRecipients || []).length > 0 && (
                                                                                    <Button
                                                                                        size="sm"
                                                                                        variant="outline-info"
                                                                                        onClick={() => {
                                                                                            const recipients = [...(workOrder.sendRecipients || [])].sort((a, b) => a.name.localeCompare(b.name));
                                                                                            openRecipientsModal(recipients, 'send');
                                                                                        }}
                                                                                        style={{ marginRight: 6 }}
                                                                                    >
                                                                                        {(() => {
                                                                                            let lang = workOrder.language;
                                                                                            if (!lang && workOrder.languages && Object.keys(workOrder.languages).length > 0) {
                                                                                                lang = Object.keys(workOrder.languages)[0];
                                                                                            }
                                                                                            const count = (workOrder.sendRecipients || []).length;
                                                                                            return `View Results${lang ? ` [${lang}]` : ''} (${count})`;
                                                                                        })()}
                                                                                    </Button>
                                                                                )}
                                                                                <Button
                                                                                    size="sm"
                                                                                    variant={stepStatus === 'working' ? 'warning' : 'success'}
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation()
                                                                                        handleStepAction(workOrder.id, 'Send', stepStatus !== 'working')
                                                                                    }}
                                                                                    disabled={false}
                                                                                >
                                                                                    {buttonLabel}
                                                                                </Button>
                                                                            </>
                                                                        ) : null
                                                                    })()}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </td>
                                        </tr>
                                    </React.Fragment>
                                )
                            })()}
                        </tbody>
                    </Table>
                </div>
            ) : (
                <div className="d-flex justify-content-center align-items-center" style={{ height: '300px', color: '#bbb', fontSize: '1.5rem' }}>
                    No work orders available
                </div>
            )}

            {/* Recipients Modal */}
            <Modal
                show={showRecipientsModal}
                onHide={() => setShowRecipientsModal(false)}
                size="lg"
                dialogClassName="modal-xl"
            >
                <Modal.Header closeButton>
                    <Modal.Title>{recipientsType === 'dry-run' ? 'Dry-Run' : 'Send'} Recipients ({currentRecipients.length})</Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '70vh', overflow: 'hidden' }}>
                    <div style={{ marginBottom: 16 }}>
                        <Button
                            variant="outline-success"
                            size="sm"
                            onClick={() => downloadRecipientsCSV(currentRecipients)}
                        >
                            📥 Download CSV
                        </Button>
                    </div>
                    <div style={{
                        maxHeight: '60vh',
                        overflowY: 'auto',
                        border: '1px solid #dee2e6',
                        borderRadius: '4px',
                        padding: '8px'
                    }}>
                        <table className="table table-sm table-striped">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Name</th>
                                    <th>Email</th>
                                    <th>ID</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentRecipients
                                    .slice() // copy
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map((recipient, index) => (
                                        <tr key={recipient.id}>
                                            <td>{index + 1}</td>
                                            <td><strong>{recipient.name}</strong></td>
                                            <td>{recipient.email}</td>
                                            <td style={{ fontSize: '0.85em', color: '#666' }}>{recipient.id}</td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowRecipientsModal(false)}>
                        Close
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Archive Modal */}
            <Modal
                show={showArchiveModal}
                onHide={() => setShowArchiveModal(false)}
                size="xl"
                dialogClassName="modal-fullscreen-lg-down"
            >
                <Modal.Header closeButton>
                    <Modal.Title>Archived Work Orders ({archivedWorkOrders.length})</Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '80vh', overflow: 'hidden' }}>
                    {loadingArchived ? (
                        <div className="text-center py-4">
                            <div className="spinner-border" role="status">
                                <span className="visually-hidden">Loading...</span>
                            </div>
                        </div>
                    ) : archivedWorkOrders.length === 0 ? (
                        <div className="text-center py-4 text-muted">
                            No archived work orders found.
                        </div>
                    ) : (
                        <div style={{
                            maxHeight: '70vh',
                            overflowY: 'auto'
                        }}>
                            <Table borderless hover variant="dark" className="mb-0">
                                <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: '#212529' }}>
                                    <tr style={{ border: 'none' }}>
                                        <th style={{ border: 'none' }}>Actions</th>
                                        <th style={{ border: 'none' }}>Event Code</th>
                                        <th style={{ border: 'none' }}>Sub Event</th>
                                        <th style={{ border: 'none' }}>Stage</th>
                                        <th style={{ border: 'none' }}>Languages</th>
                                        <th style={{ border: 'none' }}>Email Account</th>
                                        <th style={{ border: 'none' }}>Created By</th>
                                        <th style={{ border: 'none' }}>Archived</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {archivedWorkOrders.map(workOrder => (
                                        <tr key={workOrder.id}>
                                            <td style={{ border: 'none', verticalAlign: 'middle' }}>
                                                <Button
                                                    variant="outline-success"
                                                    size="sm"
                                                    onClick={() => unarchiveWorkOrder(workOrder.id)}
                                                    title="Restore work order"
                                                >
                                                    🔄 Restore
                                                </Button>
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle' }}>
                                                {workOrder.eventCode}
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle' }}>
                                                {workOrder.subEvent}
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle' }}>
                                                {workOrder.stage}
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle' }}>
                                                {Object.keys(workOrder.languages ?? {}).filter(lang => !!workOrder.languages?.[lang]).join(',')}
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle' }}>
                                                {workOrder.account}
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle' }}>
                                                {participantNames[workOrder.createdBy] || workOrder.createdBy}
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle' }}>
                                                <div>
                                                    <div style={{ fontSize: '0.85em' }}>
                                                        {workOrder.archivedAt ? new Date(workOrder.archivedAt).toLocaleDateString() : 'Unknown'}
                                                    </div>
                                                    <div style={{ fontSize: '0.75em', color: '#888' }}>
                                                        by {participantNames[workOrder.archivedBy || ''] || workOrder.archivedBy || 'Unknown'}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowArchiveModal(false)}>
                        Close
                    </Button>
                </Modal.Footer>
            </Modal>

            <style>{`
                .workorder-main-row {
                    background: #3a3d40 !important;
                    transition: background 0.2s;
                }
                .workorder-main-row:hover {
                    background: #484b50 !important;
                }
            `}</style>
        </div>
    )
}