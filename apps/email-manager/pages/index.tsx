"use client";
import React, { useState, useCallback } from 'react'
import { Container, Modal, Button, Table } from 'react-bootstrap'
import WorkOrderList from '../components/WorkOrderList'
import WorkOrderForm from '../components/WorkOrderForm'
import { updateTableItem, authGetConfigValue, useWebSocket, getAllTableItemsFiltered, getTableItem } from 'sharedFrontend'

// Define interface for work order
interface WorkOrder {
    id: string;
    eventCode: string;
    subEvent: string;
    stage: string;
    account?: string;
    zoomId?: string;
    inPerson?: boolean;
    languages?: Record<string, boolean>;
    subjects?: Record<string, string>;
    testers?: string[];
    sendContinuously?: boolean;
    sendUntil?: string;
    sendInterval?: string;
    salutationByName?: boolean;
    regLinkPresent?: boolean;
    createdAt?: string;
    updatedAt?: string;
    locked?: boolean;
    lockedBy?: string | null;
    createdBy?: string;
    steps?: Array<{ name: string; status: string; message: string; isActive: boolean }>;
    s3HTMLPaths?: Record<string, string>;
    config?: { pool?: string };
    archived?: boolean;
    archivedAt?: string;
    archivedBy?: string;
}

function getQueryParam(name: string): string | null {
    if (typeof window === 'undefined') return null;
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
}

export default function Home() {
    const pid = getQueryParam('pid')
    const hash = getQueryParam('hash')
    const userPid = pid || 'default-user-pid'
    const userHash = hash || 'default-hash'
    const [showForm, setShowForm] = useState(false)
    const [editingWorkOrderId, setEditingWorkOrderId] = useState<string | undefined>()
    const [refreshCounter, setRefreshCounter] = useState(0)
    const [newlyCreatedWorkOrder, setNewlyCreatedWorkOrder] = useState<WorkOrder | undefined>()
    const [isClient, setIsClient] = useState(false)
    const [writePermission, setWritePermission] = useState(false)
    const [currentWorkOrderIndex, setCurrentWorkOrderIndex] = useState(0)
    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
    const { status: websocketStatus } = useWebSocket()
    const [showArchiveModal, setShowArchiveModal] = useState(false)
    const [archivedWorkOrders, setArchivedWorkOrders] = useState<WorkOrder[]>([])
    const [loadingArchived, setLoadingArchived] = useState(false)
    const [userName, setUserName] = useState<string>('')
    const [participantNames, setParticipantNames] = useState<Record<string, string>>({})

    // Set isClient to true after component mounts
    React.useEffect(() => {
        const timer = setTimeout(() => {
            setIsClient(true)
        }, 100) // Small delay to ensure proper rendering
        return () => clearTimeout(timer)
    }, [])

    const loadUserName = useCallback(async () => {
        if (!userPid || userPid === 'default-user-pid') return
        try {
            const result = await getTableItem('students', userPid, userPid, userHash)
            if (result && (result.first || result.last)) {
                const firstName = result.first || ''
                const lastName = result.last || ''
                setUserName(`${firstName} ${lastName}`.trim())
            } else {
                setUserName(userPid)
            }
        } catch (error) {
            console.error('Failed to load user name:', error)
            setUserName(userPid)
        }
    }, [userPid, userHash])

    // Fetch write permission
    React.useEffect(() => {
        const fetchWritePermission = async () => {
            if (!pid || !hash) return;

            try {
                const permissionResponse = await authGetConfigValue(pid as string, hash as string, 'writePermission');
                if (permissionResponse && typeof permissionResponse === 'boolean') {
                    setWritePermission(permissionResponse);
                    console.log('Write permission:', permissionResponse);
                } else {
                    console.log('Write permission fetch redirected or failed, using default (false)');
                    setWritePermission(false);
                }
            } catch (error) {
                console.error('Error fetching write permission:', error);
                setWritePermission(false);
            }
        };

        fetchWritePermission();
    }, [pid, hash]);

    // Load user name
    React.useEffect(() => {
        loadUserName();
    }, [userPid, userHash, loadUserName]);

    const handleNewWorkOrder = () => {
        setEditingWorkOrderId(undefined)
        setShowForm(true)
    }

    const handleEditWorkOrder = (workOrderId: string) => {
        setEditingWorkOrderId(workOrderId)
        setShowForm(true)
    }

    const handleFormClose = async (createdWorkOrder?: WorkOrder) => {
        // When the form closes, unlock the work order if one was being edited.
        if (editingWorkOrderId) {
            try {
                // Unlock the work order using the new API
                await updateTableItem('work-orders', editingWorkOrderId, 'locked', false, userPid, userHash)
                await updateTableItem('work-orders', editingWorkOrderId, 'lockedBy', null, userPid, userHash)

            } catch (err) {
                // Log error but don't bother the user, as the lock will expire anyway.
                console.error('Failed to unlock work order on form close:', err);
            }
        }

        // If a new work order was created, store it for the list
        if (createdWorkOrder) {
            setNewlyCreatedWorkOrder(createdWorkOrder)
        }

        setShowForm(false)
        setEditingWorkOrderId(undefined)

        // Add a small delay to ensure DynamoDB has propagated the change
        setTimeout(() => {
            setRefreshCounter(prev => prev + 1)
            // Clear the newly created work order after the refresh
            if (createdWorkOrder) {
                setTimeout(() => {
                    setNewlyCreatedWorkOrder(undefined)
                }, 1000)
            }
        }, 500)
    }

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



    const handleOpenArchiveModal = async () => {
        setShowArchiveModal(true)
        await loadArchivedWorkOrders()
    }

    const loadArchivedWorkOrders = async () => {
        setLoadingArchived(true)
        try {
            const result = await getAllTableItemsFiltered('work-orders', 'archived', true, userPid, userHash)
            if (result && Array.isArray(result)) {
                setArchivedWorkOrders(result)
                // Load participant names for all archived work orders
                await loadParticipantNamesForArchived(result)
            }
        } catch (error) {
            console.error('Failed to load archived work orders:', error)
        } finally {
            setLoadingArchived(false)
        }
    }

    const loadParticipantNamesForArchived = async (archivedOrders: WorkOrder[]) => {
        const uniquePids = new Set<string>()

        // Collect all unique user IDs from createdBy and archivedBy fields
        archivedOrders.forEach(wo => {
            if (wo.createdBy) uniquePids.add(wo.createdBy)
            if (wo.archivedBy) uniquePids.add(wo.archivedBy)
        })

        // Load names for each unique user ID
        for (const pid of uniquePids) {
            if (!participantNames[pid]) {
                try {
                    const result = await getTableItem('students', pid, userPid, userHash)
                    if (result && (result.first || result.last)) {
                        const firstName = result.first || ''
                        const lastName = result.last || ''
                        setParticipantNames(prev => ({
                            ...prev,
                            [pid]: `${firstName} ${lastName}`.trim()
                        }))
                    } else {
                        setParticipantNames(prev => ({ ...prev, [pid]: pid }))
                    }
                } catch (error) {
                    console.error(`Failed to load name for user ${pid}:`, error)
                    setParticipantNames(prev => ({ ...prev, [pid]: pid }))
                }
            }
        }
    }

    return (
        <Container className="py-4 bg-dark text-light min-vh-100">
            {/* Navigation, Title, and Actions Row */}
            <div className="d-flex justify-content-between align-items-center mb-3">
                {/* Left side - Navigation Arrows and Title */}
                <div className="d-flex align-items-center" style={{ gap: 8, paddingLeft: 16 }}>
                    <Button
                        variant="primary"
                        onClick={goToPreviousWorkOrder}
                        disabled={currentWorkOrderIndex === 0}
                        size="sm"
                        style={{
                            borderRadius: '50%',
                            width: 36,
                            height: 36,
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
                        <svg width="18" height="18" viewBox="0 0 22 22" style={{ display: 'block', margin: 'auto' }}>
                            <line x1="15" y1="4" x2="7" y2="11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
                            <line x1="7" y1="11" x2="15" y2="18" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
                        </svg>
                    </Button>
                    <Button
                        variant="primary"
                        onClick={goToNextWorkOrder}
                        disabled={currentWorkOrderIndex === workOrders.length - 1}
                        size="sm"
                        style={{
                            borderRadius: '50%',
                            width: 36,
                            height: 36,
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
                        <svg width="18" height="18" viewBox="0 0 22 22" style={{ display: 'block', margin: 'auto' }}>
                            <line x1="7" y1="4" x2="15" y2="11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
                            <line x1="15" y1="11" x2="7" y2="18" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
                        </svg>
                    </Button>
                    <small className="text-muted" style={{ fontSize: 12 }}>
                        (←→ arrows, Home/End keys)
                    </small>

                    {/* Email Manager Title */}
                    <h1 className="text-light fw-bold fs-3 mb-0 ms-4">
                        Email Manager
                    </h1>
                </div>

                {/* Right side - New Work Order Button */}
                <div style={{ paddingRight: 16 }}>
                    <Button
                        variant="primary"
                        onClick={handleNewWorkOrder}
                        disabled={!writePermission}
                        size="sm"
                        style={{
                            borderRadius: '50%',
                            width: 36,
                            height: 36,
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
                        <svg width="18" height="18" viewBox="0 0 22 22" style={{ display: 'block', margin: 'auto' }}>
                            <line x1="11" y1="5" x2="11" y2="17" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
                            <line x1="5" y1="11" x2="17" y2="11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
                        </svg>
                    </Button>
                </div>
            </div>

            {/* Status Bar */}
            <div className="status-bar" style={{ marginBottom: '8px' }}>
                <span className="status-item">
                    Records: {workOrders.filter(wo => !wo.archived).length || 0}
                </span>
                <span className={`status-item ${websocketStatus === 'open' ? 'websocket-connected' : 'websocket-disconnected'}`}>
                    {websocketStatus === 'open' ? 'Database connected' : 'Database disconnected'}
                </span>
                <span className={`status-item ${writePermission ? 'write-enabled' : ''}`}>
                    {writePermission ? 'Write Enabled' : 'Read Only'}
                </span>
                <button
                    className="status-item archive-enabled"
                    onClick={handleOpenArchiveModal}
                    title="View archived work orders"
                >
                    📁 Archived Work Orders
                </button>
                <span className="status-item export-enabled">
                    Export Enabled
                </span>
                {isClient && (
                    <span className="status-item version-info">
                        Version: {window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                            ? 'localhost'
                            : (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'dev').substring(0, 7)
                        }
                    </span>
                )}
                {isClient && (
                    <span className="status-item user-info">
                        {userName || userPid}
                    </span>
                )}
            </div>

            <WorkOrderList
                onEdit={handleEditWorkOrder}
                refreshTrigger={refreshCounter}
                userPid={userPid}
                userHash={userHash}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                newlyCreatedWorkOrder={newlyCreatedWorkOrder as any}
                writePermission={writePermission}
                currentWorkOrderIndex={currentWorkOrderIndex}
                setCurrentWorkOrderIndex={setCurrentWorkOrderIndex}
                setWorkOrders={setWorkOrders}
            />

            <Modal show={showForm} onHide={handleFormClose} size="lg">
                <Modal.Header closeButton className="bg-dark text-light">
                    <Modal.Title>
                        {editingWorkOrderId ? 'Edit Work Order' : 'New Work Order'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body className="bg-dark text-light">
                    <WorkOrderForm
                        id={editingWorkOrderId}
                        onSave={handleFormClose}
                        onCancel={handleFormClose}
                        userPid={userPid}
                        userHash={userHash}
                        writePermission={writePermission}
                    />
                </Modal.Body>
            </Modal>

            {/* Archive Modal */}
            <Modal
                show={showArchiveModal}
                onHide={() => setShowArchiveModal(false)}
                size="xl"
                dialogClassName="modal-fullscreen-lg-down"
            >
                <Modal.Header closeButton className="bg-dark text-light">
                    <Modal.Title>Archived Work Orders</Modal.Title>
                </Modal.Header>
                <Modal.Body className="bg-dark text-light" style={{ maxHeight: '80vh', overflow: 'hidden' }}>
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
                                        <th style={{ border: 'none' }}>Event</th>
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
                                                {workOrder.createdBy ? (participantNames[workOrder.createdBy] || workOrder.createdBy) : 'Unknown'}
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle' }}>
                                                <div>
                                                    <div style={{ fontSize: '0.85em' }}>
                                                        {workOrder.archivedAt ? new Date(workOrder.archivedAt).toLocaleDateString() : 'Unknown'}
                                                    </div>
                                                    <div style={{ fontSize: '0.75em', color: '#888' }}>
                                                        by {workOrder.archivedBy ? (participantNames[workOrder.archivedBy] || workOrder.archivedBy) : 'Unknown'}
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
                <Modal.Footer className="bg-dark text-light">
                    <Button variant="secondary" onClick={() => setShowArchiveModal(false)}>
                        Close
                    </Button>
                </Modal.Footer>
            </Modal>
        </Container>
    )
} 