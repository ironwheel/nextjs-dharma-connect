import React, { useEffect, useState, useRef } from 'react'
import { Table, Button, Badge, Modal, Spinner } from 'react-bootstrap'
import { toast } from 'react-toastify'
import { getAllTableItems, useWebSocket, getTableItem, getTableItemOrNull, updateTableItem, getAllTableItemsFiltered, sendSQSMessage } from 'sharedFrontend'
import { unmarshall } from '@aws-sdk/util-dynamodb'

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
    config?: { [key: string]: unknown }
    testers?: string[]
    sendContinuously?: boolean
    sendUntil?: string
    sendInterval?: string
    salutationByName?: boolean
    regLinkPresent?: boolean
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
    sleepUntil?: string
}

interface RecipientEntry {
    name: string;
    email: string;
    sendtime?: string;
}

interface WorkOrderListProps {
    onEdit: (id: string) => void
    onNew: () => void
    refreshTrigger?: number
    userPid: string
    userHash: string
    newlyCreatedWorkOrder?: WorkOrder
}

export default function WorkOrderList({ onEdit, onNew, refreshTrigger = 0, userPid, userHash, newlyCreatedWorkOrder }: WorkOrderListProps) {
    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
    const [loading, setLoading] = useState(true)
    const [participantNames, setParticipantNames] = useState<Record<string, string>>({})
    const [hoveredRow, setHoveredRow] = useState<string | null>(null)
    const [showRecipientsModal, setShowRecipientsModal] = useState(false)
    const [currentRecipients, setCurrentRecipients] = useState<RecipientEntry[]>([]);
    const [recipientsType, setRecipientsType] = useState<'dry-run' | 'send'>('dry-run')
    const [showArchiveModal, setShowArchiveModal] = useState(false)
    const [archivedWorkOrders, setArchivedWorkOrders] = useState<WorkOrder[]>([])
    const [loadingArchived, setLoadingArchived] = useState(false)
    const [currentWorkOrderIndex, setCurrentWorkOrderIndex] = useState(0)
    const { lastMessage, status, connectionId } = useWebSocket()
    const prevWorkOrdersRef = useRef<WorkOrder[]>([])
    // Add state to cache campaign existence for each work order and language
    const [campaignExistence, setCampaignExistence] = useState<Record<string, Record<string, { dryrun: boolean; send: boolean; dryrunCount?: number; sendCount?: number }>>>({});
    const [campaignExistenceLoading, setCampaignExistenceLoading] = useState<Record<string, boolean>>({});
    const [recipientSearch, setRecipientSearch] = useState('');
    const [currentCampaignString, setCurrentCampaignString] = useState<string>('');

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

    const downloadRecipientsCSV = (recipients: RecipientEntry[]) => {
        const csvContent = [
            'Name,Email,Send Time',
            ...recipients.map(r => `"${r.name}","${r.email}","${r.sendtime || ''}"`)
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

    const openRecipientsModal = (recipients: RecipientEntry[], type: 'dry-run' | 'send' = 'dry-run', campaignString: string = '') => {
        setCurrentRecipients(Array.isArray(recipients) ? recipients : []);
        setRecipientsType(type);
        setCurrentCampaignString(campaignString);
        setShowRecipientsModal(true);
    }

    const loadArchivedWorkOrders = async () => {
        setLoadingArchived(true)
        try {
            const result = await getAllTableItemsFiltered('work-orders', 'archived', true, userPid, userHash)
            if (result && Array.isArray(result)) {
                setArchivedWorkOrders(result)
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
            await updateTableItem('work-orders', workOrderId, 'archived', true, userPid, userHash)
            await updateTableItem('work-orders', workOrderId, 'archivedAt', new Date().toISOString(), userPid, userHash)
            await updateTableItem('work-orders', workOrderId, 'archivedBy', userPid, userPid, userHash)
            toast.success('Work order archived successfully')
            loadWorkOrders() // Refresh the main list
        } catch (error) {
            console.error('Failed to archive work order:', error)
            toast.error('Failed to archive work order')
        }
    }

    const unarchiveWorkOrder = async (workOrderId: string) => {
        try {
            await updateTableItem('work-orders', workOrderId, 'archived', false, userPid, userHash)
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
            const result = await getTableItem('students', pid, userPid, userHash)
            if (result && (result.first || result.last)) {
                setParticipantNames(prev => ({ ...prev, [pid]: `${result.first || ''} ${result.last || ''}`.trim() }))
            } else {
                setParticipantNames(prev => ({ ...prev, [pid]: pid }))
            }
        } catch {
            setParticipantNames(prev => ({ ...prev, [pid]: pid }))
        }
    }

    const loadWorkOrders = async () => {
        setLoading(true)
        try {
            const result = await getAllTableItems('work-orders', userPid, userHash)

            if (result && Array.isArray(result)) {
                // Filter out archived work orders by default
                const activeWorkOrders = result.filter(wo => !wo.archived)
                // Sort by createdAt (newest first), with fallback for missing createdAt
                activeWorkOrders.sort((a, b) => {
                    const aTime = new Date(a.createdAt || '1970-01-01').getTime();
                    const bTime = new Date(b.createdAt || '1970-01-01').getTime();
                    return bTime - aTime;
                });
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



    useEffect(() => {
        if (lastMessage && lastMessage.type === 'workOrderUpdate') {
            // Handle DynamoDB Stream messages (from DynamoDB Streams)
            const newImage = lastMessage.newImage
            if (newImage) {
                const updatedWorkOrder = unmarshall(newImage) as WorkOrder

                if (updatedWorkOrder) {
                    setWorkOrders(prevOrders => {
                        const index = prevOrders.findIndex(wo => wo.id === updatedWorkOrder.id)

                        if (index === -1) {
                            // If it's a new work order, add it to the list and sort
                            const newOrders = [updatedWorkOrder, ...prevOrders]
                            newOrders.sort((a, b) => {
                                const aTime = new Date(a.createdAt || '1970-01-01').getTime();
                                const bTime = new Date(b.createdAt || '1970-01-01').getTime();
                                return bTime - aTime;
                            })
                            return newOrders
                        }

                        // Simply update with the real data from DynamoDB
                        const newOrders = [...prevOrders]
                        newOrders[index] = updatedWorkOrder;

                        return newOrders
                    })
                }
            }

            // Handle direct WebSocket messages (from email-agent)
            const workOrder = lastMessage.workOrder
            if (workOrder) {

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
                    sendInterval: workOrder.sendInterval,
                    salutationByName: workOrder.salutationByName,
                    regLinkPresent: workOrder.regLinkPresent,
                    dryRunRecipients: workOrder.dryRunRecipients || [],
                    sendRecipients: workOrder.sendRecipients || [],
                    archived: workOrder.archived,
                    archivedAt: workOrder.archivedAt,
                    archivedBy: workOrder.archivedBy,
                    sleepUntil: workOrder.sleepUntil,
                }

                setWorkOrders(prevOrders => {
                    const index = prevOrders.findIndex(wo => wo.id === updatedWorkOrder.id)

                    if (index === -1) {
                        // If it's a new work order, add it to the list and sort
                        const newOrders = [updatedWorkOrder, ...prevOrders]
                        newOrders.sort((a, b) => {
                            const aTime = new Date(a.createdAt || '1970-01-01').getTime();
                            const bTime = new Date(b.createdAt || '1970-01-01').getTime();
                            return bTime - aTime;
                        })
                        return newOrders
                    }

                    // Simply update with the real data from DynamoDB
                    const newOrders = [...prevOrders]
                    newOrders[index] = updatedWorkOrder;

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
            let newestDate = new Date(workOrders[0]?.createdAt || '1970-01-01').getTime();
            for (let i = 1; i < workOrders.length; i++) {
                const d = new Date(workOrders[i].createdAt || '1970-01-01').getTime();
                if (d > newestDate) {
                    newestDate = d;
                    newestIndex = i;
                }
            }
            setCurrentWorkOrderIndex(newestIndex);
        }
        prevWorkOrdersRef.current = workOrders;
    }, [workOrders]);

    // Handle newly created work order
    useEffect(() => {
        if (newlyCreatedWorkOrder) {
            // Add the newly created work order to the list
            setWorkOrders(prevOrders => {
                // Check if it's already in the list (from WebSocket or reload)
                const exists = prevOrders.some(wo => wo.id === newlyCreatedWorkOrder.id);
                if (!exists) {
                    const newOrders = [newlyCreatedWorkOrder, ...prevOrders];
                    // Sort by createdAt (newest first)
                    newOrders.sort((a, b) => {
                        const aTime = new Date(a.createdAt || '1970-01-01').getTime();
                        const bTime = new Date(b.createdAt || '1970-01-01').getTime();
                        return bTime - aTime;
                    });
                    return newOrders;
                }
                return prevOrders;
            });

            // Select the newly created work order
            setCurrentWorkOrderIndex(0);

            // Clear the newly created work order after handling it
            // This will be done by the parent component
        }
    }, [newlyCreatedWorkOrder]);

    // Helper to prefetch campaign existence for all enabled languages for a work order
    const prefetchCampaignExistence = async (workOrder: WorkOrder) => {
        if (!workOrder) return;
        const langs = Object.keys(workOrder.languages ?? {}).filter(lang => !!workOrder.languages?.[lang]);
        if (langs.length === 0) return;
        const eventCode = workOrder.eventCode;
        const subEvent = workOrder.subEvent;
        const stage = workOrder.stage;
        const workOrderId = workOrder.id;
        setCampaignExistenceLoading(prev => ({ ...prev, [workOrderId]: true }));
        const newExistence: Record<string, { dryrun: boolean; send: boolean; dryrunCount?: number; sendCount?: number }> = {};
        await Promise.all(langs.map(async (lang) => {
            const campaignString = `${eventCode}_${subEvent}_${stage}_${lang}`;
            let dryrun = false;
            let send = false;
            let dryrunCount = undefined;
            let sendCount = undefined;
            try {
                const dryrunResult = await getTableItemOrNull('dryrun-recipients', campaignString, userPid, userHash);
                dryrun = !!(dryrunResult && dryrunResult.entries && Array.isArray(dryrunResult.entries) && dryrunResult.entries.length > 0);
                dryrunCount = dryrunResult && dryrunResult.entries && Array.isArray(dryrunResult.entries) ? dryrunResult.entries.length : undefined;
            } catch {
                dryrun = false;
                dryrunCount = undefined;
            }
            try {
                const sendResult = await getTableItemOrNull('send-recipients', campaignString, userPid, userHash);
                send = !!(sendResult && sendResult.entries && Array.isArray(sendResult.entries) && sendResult.entries.length > 0);
                sendCount = sendResult && sendResult.entries && Array.isArray(sendResult.entries) ? sendResult.entries.length : undefined;
            } catch {
                send = false;
                sendCount = undefined;
            }
            newExistence[lang] = { dryrun, send, dryrunCount, sendCount };
        }));
        setCampaignExistence(prev => ({ ...prev, [workOrderId]: newExistence }));
        setCampaignExistenceLoading(prev => ({ ...prev, [workOrderId]: false }));
    };

    // Prefetch campaign existence when workOrders or currentWorkOrderIndex changes
    useEffect(() => {
        if (workOrders.length > 0) {
            const workOrder = workOrders[currentWorkOrderIndex];
            if (workOrder && !campaignExistence[workOrder.id]) {
                prefetchCampaignExistence(workOrder);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workOrders, currentWorkOrderIndex]);

    const handleRowClick = async (workOrder: WorkOrder) => {
        if (workOrder.locked) {
            // Don't allow editing if locked
            return
        }

        // Try to lock the work order before opening for edit
        try {
            // Lock the work order using the new API
            await updateTableItem('work-orders', workOrder.id, 'locked', true, userPid, userHash)
            await updateTableItem('work-orders', workOrder.id, 'lockedBy', userPid, userPid, userHash)

            // Update state immediately to reflect the lock
            setWorkOrders(prevOrders => {
                const index = prevOrders.findIndex(wo => wo.id === workOrder.id)
                if (index === -1) return prevOrders
                const newOrders = [...prevOrders]
                newOrders[index] = { ...workOrder, locked: true, lockedBy: userPid }
                return newOrders
            })

            // Successfully locked, proceed with edit
            onEdit(workOrder.id)
        } catch (error) {
            console.error('Error locking work order:', error)
            toast.error('Failed to lock work order')
        }
    }

    const handleStepAction = async (
        id: string,
        stepName: 'Count' | 'Prepare' | 'Dry-Run' | 'Test' | 'Send',
        isStarting: boolean
    ) => {

        try {
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
            }

            // Determine the action to send to the email-agent
            const action = isStarting ? 'start' : 'stop';

            // Send SQS message to email-agent using the new API
            await sendSQSMessage({
                workOrderId: id,
                stepName: stepName,
                action: action
            }, userPid, userHash);

        } catch (error) {
            console.error(`[STEP-ACTION] ERROR: Failed to send ${isStarting ? 'start' : 'stop'} message to email-agent:`, error);

            // Show error to user
            alert(`Failed to ${isStarting ? 'start' : 'stop'} step: ${error}`);
        }
    }

    const getDisplayStepName = (stepName: string, workOrder: WorkOrder) => {
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
                                Agent Connection: {status}
                            </Badge>
                            {connectionId && (
                                <Badge bg="secondary" className="ms-2">
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
                            Agent Connection: {status}
                        </Badge>
                        {connectionId && (
                            <Badge bg="secondary" className="ms-2">
                                ID: {connectionId}
                            </Badge>
                        )}
                        {!connectionId && status === 'open' && (
                            <Badge bg="warning" className="ms-2">
                                Waiting for ID...
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
                                    <line x1="15" y1="4" x2="7" y2="11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
                                    <line x1="7" y1="11" x2="15" y2="18" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
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
                                    <line x1="11" y1="5" x2="11" y2="17" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
                                    <line x1="5" y1="11" x2="17" y2="11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
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
                                    <line x1="7" y1="4" x2="15" y2="11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
                                    <line x1="15" y1="11" x2="7" y2="18" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
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
                                        </tr>
                                        <tr>
                                            <td colSpan={8} style={{ padding: 0, background: 'transparent', border: 'none' }}>
                                                {(workOrder.steps || []).map((step, index) => {
                                                    // Helper function to extract string values from DynamoDB format or plain strings
                                                    const extractString = (value: unknown): string => {
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
                                                    if (stepStatus === 'error') {
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
                                                    else if (stepStatus === 'sleeping') buttonLabel = 'Stop';

                                                    // Badge color logic

                                                    // Determine button variant based on label
                                                    let buttonVariant = 'success';
                                                    if (buttonLabel === 'Stop') buttonVariant = 'danger';
                                                    else if (stepStatus === 'working') buttonVariant = 'warning';

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
                                                                    <div style={{ flex: 4, color: isInterrupted ? '#fff' : (stepStatus === 'sleeping' && workOrder.sleepUntil && new Date(workOrder.sleepUntil) < new Date() ? 'red' : messageColor) }}>
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
                                                                        const langs = Object.keys(workOrder.languages ?? {}).filter(lang => !!workOrder.languages?.[lang]);
                                                                        const existence = campaignExistence[workOrder.id] || {};
                                                                        return enabled ? (
                                                                            <>
                                                                                {/* Show View Results buttons for each language */}
                                                                                {campaignExistenceLoading[workOrder.id] && <Spinner animation="border" size="sm" className="me-2" />}
                                                                                {langs.map(lang => {
                                                                                    const exists = existence[lang]?.dryrun;
                                                                                    const count = existence[lang]?.dryrunCount ?? 0;
                                                                                    return (
                                                                                        <Button
                                                                                            key={lang}
                                                                                            size="sm"
                                                                                            variant="outline-info"
                                                                                            onClick={async () => {
                                                                                                if (!exists) return;
                                                                                                const campaignString = `${workOrder.eventCode}_${workOrder.subEvent}_${workOrder.stage}_${lang}`;
                                                                                                try {
                                                                                                    const result = await getTableItem('dryrun-recipients', campaignString, userPid, userHash);
                                                                                                    const entries = (result && result.entries && Array.isArray(result.entries)) ? [...result.entries] : [];
                                                                                                    entries.sort((a, b) => (b.sendtime || '').localeCompare(a.sendtime || ''));
                                                                                                    openRecipientsModal(entries, 'dry-run', campaignString);
                                                                                                } catch {
                                                                                                    toast.error('Failed to load dry-run recipients');
                                                                                                }
                                                                                            }}
                                                                                            style={{ marginRight: 6 }}
                                                                                            disabled={!exists}
                                                                                        >
                                                                                            {`${lang} (${count})`}
                                                                                        </Button>
                                                                                    );
                                                                                })}
                                                                                {/* Always show the action button to the right */}
                                                                                <Button
                                                                                    size="sm"
                                                                                    variant={buttonVariant}
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
                                                                    {stepName === 'Send' && (() => {
                                                                        const dryRunStep = workOrder.steps?.find(s => extractString(s.name) === 'Dry-Run')
                                                                        const enabled = dryRunStep && extractString(dryRunStep.status) === 'complete'
                                                                        const langs = Object.keys(workOrder.languages ?? {}).filter(lang => !!workOrder.languages?.[lang]);
                                                                        const existence = campaignExistence[workOrder.id] || {};
                                                                        return enabled ? (
                                                                            <>
                                                                                {/* Show View Results buttons for each language */}
                                                                                {campaignExistenceLoading[workOrder.id] && <Spinner animation="border" size="sm" className="me-2" />}
                                                                                {langs.map(lang => {
                                                                                    const exists = existence[lang]?.send;
                                                                                    const count = existence[lang]?.sendCount ?? 0;
                                                                                    return (
                                                                                        <Button
                                                                                            key={lang}
                                                                                            size="sm"
                                                                                            variant="outline-primary"
                                                                                            onClick={async () => {
                                                                                                if (!exists) return;
                                                                                                const campaignString = `${workOrder.eventCode}_${workOrder.subEvent}_${workOrder.stage}_${lang}`;
                                                                                                try {
                                                                                                    const result = await getTableItem('send-recipients', campaignString, userPid, userHash);
                                                                                                    const entries = (result && result.entries && Array.isArray(result.entries)) ? [...result.entries] : [];
                                                                                                    entries.sort((a, b) => (b.sendtime || '').localeCompare(a.sendtime || ''));
                                                                                                    openRecipientsModal(entries, 'send', campaignString);
                                                                                                } catch {
                                                                                                    toast.error('Failed to load send recipients');
                                                                                                }
                                                                                            }}
                                                                                            style={{ marginRight: 6 }}
                                                                                            disabled={!exists}
                                                                                        >
                                                                                            {`${lang} (${count})`}
                                                                                        </Button>
                                                                                    );
                                                                                })}
                                                                                {/* Always show the action button to the right */}
                                                                                <Button
                                                                                    size="sm"
                                                                                    variant={buttonVariant}
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
                    <Modal.Title>
                        {recipientsType === 'dry-run' ? 'Dry-Run' : 'Send'} Recipients ({currentRecipients.length}){currentCampaignString ? ` ${currentCampaignString}` : ''}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '70vh', overflow: 'hidden' }}>
                    <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Button
                            variant="outline-success"
                            size="sm"
                            onClick={() => downloadRecipientsCSV(currentRecipients)}
                        >
                            📥 Download CSV
                        </Button>
                        <input
                            type="text"
                            placeholder="Search by name..."
                            value={recipientSearch}
                            onChange={e => setRecipientSearch(e.target.value)}
                            style={{ flex: 1, minWidth: 180, maxWidth: 300, padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}
                        />
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
                                    <th>Send Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentRecipients
                                    .filter(r => recipientSearch.trim() === '' || (r.name && r.name.toLowerCase().includes(recipientSearch.trim().toLowerCase())))
                                    .slice() // copy
                                    .sort((a, b) => {
                                        // Sort by sendtime descending (most recent first)
                                        const at = a.sendtime ? new Date(a.sendtime).getTime() : 0;
                                        const bt = b.sendtime ? new Date(b.sendtime).getTime() : 0;
                                        return bt - at;
                                    })
                                    .map((recipient, index) => (
                                        <tr key={recipient.sendtime || index}>
                                            <td>{index + 1}</td>
                                            <td><strong>{recipient.name}</strong></td>
                                            <td>{recipient.email}</td>
                                            <td style={{ fontSize: '0.95em', color: '#666' }}>{recipient.sendtime ? new Date(recipient.sendtime).toLocaleString() : ''}</td>
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