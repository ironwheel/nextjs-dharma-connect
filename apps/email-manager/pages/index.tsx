"use client";
import React, { useState, useCallback, useRef } from 'react'
import { Container, Modal, Button, Table, Spinner, Form, Row, Col } from 'react-bootstrap'
import WorkOrderList from '../components/WorkOrderList'
import WorkOrderForm from '../components/WorkOrderForm'
import { updateTableItem, authGetConfigValue, useWebSocket, getAllTableItemsFiltered, getTableItem, getTableItemOrNull, VersionBadge, getAllTableItems, putTableItem, deleteTableItem } from 'sharedFrontend'

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

// Define interface for View
interface View {
    name: string;
    columnDefs: Array<{
        name: string;
        headerName?: string;
        boolName?: string;
        stringName?: string;
        numberName?: string;
        pool?: string;
        aid?: string;
        map?: string;
        writeEnabled?: boolean;
    }>;
    viewConditions: Array<{
        name: string;
        boolName?: string;
        boolValue?: boolean;
        stringValue?: string;
        pool?: string;
        map?: string;
    }>;
}

interface Pool {
    name: string;
    [key: string]: unknown;
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
    const [loadingParticipantNames, setLoadingParticipantNames] = useState(false)
    const [formLoading, setFormLoading] = useState(false)
    const [editedWorkOrderId, setEditedWorkOrderId] = useState<string | null>(null)
    const [unarchivingId, setUnarchivingId] = useState<string | null>(null)
    const [userEventAccess, setUserEventAccess] = useState<string[]>([])
    const initialWorkOrdersLoaded = useRef(false)
    
    // Views management state
    const [showViewsModal, setShowViewsModal] = useState(false)
    const [showDeleteViewConfirm, setShowDeleteViewConfirm] = useState(false)
    const [isNewView, setIsNewView] = useState(false)
    const [allViews, setAllViews] = useState<View[]>([])
    const [allPools, setAllPools] = useState<Pool[]>([])
    const [viewFormData, setViewFormData] = useState<View>({
        name: '',
        columnDefs: [],
        viewConditions: []
    })
    const [viewsLoading, setViewsLoading] = useState(false)


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

    // Fetch user's last used work order configuration
    const fetchCurrentUserLastUsedConfig = useCallback(async () => {
        try {
            if (!userPid || userPid === 'default-user-pid') {
                return null
            }

            const studentRecord = await getTableItemOrNull('students', userPid, userPid, userHash)
            if (studentRecord && studentRecord.emailManagerLastUsedConfig) {
                return studentRecord.emailManagerLastUsedConfig
            } else {
                return null
            }
        } catch (error) {
            console.error('Error fetching user emailManagerLastUsedConfig:', error)
            return null
        }
    }, [userPid, userHash])

    // Update user's last used work order configuration
    const updateUserEmailManagerLastUsedConfig = useCallback(async (updates: {
        workOrderId?: string
    }) => {
        try {
            if (!userPid || userPid === 'default-user-pid') {
                return false
            }

            // Don't update if workOrderId is undefined
            if (updates.workOrderId === undefined) {
                return false
            }

            // Get current student record
            const currentConfig = await fetchCurrentUserLastUsedConfig()

            // Create or update the emailManagerLastUsedConfig
            const updatedEmailManagerLastUsedConfig = {
                ...(currentConfig || {}),
                ...updates
            }

            // Update the student record
            await updateTableItem('students', userPid, 'emailManagerLastUsedConfig', updatedEmailManagerLastUsedConfig, userPid, userHash)
            return true
        } catch (error) {
            console.error('Error updating user emailManagerLastUsedConfig:', error)
            return false
        }
    }, [userPid, userHash, fetchCurrentUserLastUsedConfig])

    // Fetch write permission and event access
    React.useEffect(() => {
        const fetchPermissions = async () => {
            if (!pid || !hash) return;

            try {
                const [permissionResponse, eventAccessResponse] = await Promise.all([
                    authGetConfigValue(pid as string, hash as string, 'writePermission'),
                    authGetConfigValue(pid as string, hash as string, 'eventAccess')
                ]);

                // Handle write permission
                if (permissionResponse && typeof permissionResponse === 'boolean') {
                    setWritePermission(permissionResponse);
                    console.log('Write permission:', permissionResponse);
                } else {
                    console.log('Write permission fetch redirected or failed, using default (false)');
                    setWritePermission(false);
                }

                // Handle event access
                if (Array.isArray(eventAccessResponse)) {
                    setUserEventAccess(eventAccessResponse);
                    console.log('User event access:', eventAccessResponse);
                } else {
                    console.log('No event access restrictions found, showing no events');
                    setUserEventAccess([]);
                }
            } catch (error) {
                // Handle AUTH_UNKNOWN_CONFIG_KEY and other errors gracefully
                if (error.message && error.message.includes('AUTH_UNKNOWN_CONFIG_KEY')) {
                    console.log('Event access not configured for user, showing no events');
                } else {
                    console.error('Error fetching permissions:', error);
                }
                setWritePermission(false);
                setUserEventAccess([]);
            }
        };

        fetchPermissions();
    }, [pid, hash]);

    // Load user name
    React.useEffect(() => {
        loadUserName();
    }, [userPid, userHash, loadUserName]);

    // Restore last used work order on startup (only once)
    React.useEffect(() => {
        const restoreLastUsedWorkOrder = async () => {
            // Only restore once when work orders are first loaded
            if (workOrders.length === 0 || initialWorkOrdersLoaded.current) return;
            
            // Mark that we've loaded initial work orders
            initialWorkOrdersLoaded.current = true;
            
            try {
                const userConfig = await fetchCurrentUserLastUsedConfig();
                
                if (userConfig?.workOrderId) {
                    // Find the work order index by ID
                    const workOrderIndex = workOrders.findIndex(wo => wo.id === userConfig.workOrderId);
                    
                    if (workOrderIndex !== -1) {
                        setCurrentWorkOrderIndex(workOrderIndex);
                    } else {
                        setCurrentWorkOrderIndex(0);
                    }
                } else {
                    setCurrentWorkOrderIndex(0);
                }
            } catch (error) {
                console.error('Error restoring last used work order:', error);
                setCurrentWorkOrderIndex(0);
            }
        };

        restoreLastUsedWorkOrder();
    }, [workOrders, fetchCurrentUserLastUsedConfig]);

    // Keyboard navigation support
    React.useEffect(() => {
        const handleKeyDown = async (event: KeyboardEvent) => {
            if (workOrders.length === 0) return;
            
            switch (event.key) {
                case 'Home':
                    event.preventDefault();
                    if (currentWorkOrderIndex !== 0) {
                        setCurrentWorkOrderIndex(0);
                        const firstWorkOrder = workOrders[0];
                        if (firstWorkOrder && firstWorkOrder.id) {
                            try {
                                await updateUserEmailManagerLastUsedConfig({
                                    workOrderId: firstWorkOrder.id
                                });
                            } catch (error) {
                                console.error('Failed to persist work order navigation (Home):', error);
                            }
                        }
                    }
                    break;
                case 'End':
                    event.preventDefault();
                    const lastIndex = workOrders.length - 1;
                    if (currentWorkOrderIndex !== lastIndex) {
                        setCurrentWorkOrderIndex(lastIndex);
                        const lastWorkOrder = workOrders[lastIndex];
                        if (lastWorkOrder && lastWorkOrder.id) {
                            try {
                                await updateUserEmailManagerLastUsedConfig({
                                    workOrderId: lastWorkOrder.id
                                });
                            } catch (error) {
                                console.error('Failed to persist work order navigation (End):', error);
                            }
                        }
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [workOrders, currentWorkOrderIndex, updateUserEmailManagerLastUsedConfig]);

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

                // Persist the work order that was being edited
                try {
                    await updateUserEmailManagerLastUsedConfig({
                        workOrderId: editingWorkOrderId
                    });
                } catch (error) {
                    console.error('Failed to persist work order after edit:', error);
                }

            } catch (err) {
                // Log error but don't bother the user, as the lock will expire anyway.
                console.error('Failed to unlock work order on form close:', err);
            }
        }

        // If a new work order was created, store it for the list
        if (createdWorkOrder && createdWorkOrder.id) {
            setNewlyCreatedWorkOrder(createdWorkOrder)
            
            // Persist the newly created work order
            try {
                await updateUserEmailManagerLastUsedConfig({
                    workOrderId: createdWorkOrder.id
                });
            } catch (error) {
                console.error('Failed to persist newly created work order:', error);
            }
        } else if (editingWorkOrderId) {
            // Store the edited work order ID for restoration after refresh
            setEditedWorkOrderId(editingWorkOrderId);
            
            // Use a longer delay to ensure the editedWorkOrderId state is set before refresh
            setTimeout(() => {
                setRefreshCounter(prev => prev + 1);
            }, 100) // Short delay to ensure state update
        } else {
            // For cases where neither new work order nor editing, use the original timing
            setTimeout(() => {
                setRefreshCounter(prev => prev + 1);
                // Clear the newly created work order after the refresh
                if (createdWorkOrder && createdWorkOrder.id) {
                    setTimeout(() => {
                        setNewlyCreatedWorkOrder(undefined)
                    }, 1000)
                }
            }, 500)
        }

        setShowForm(false)
        setEditingWorkOrderId(undefined)
    }

    // Navigation functions
    const goToNextWorkOrder = async () => {
        if (currentWorkOrderIndex < workOrders.length - 1) {
            const newIndex = currentWorkOrderIndex + 1;
            setCurrentWorkOrderIndex(newIndex);
            
            // Persist the new work order selection
            const newWorkOrder = workOrders[newIndex];
            if (newWorkOrder && newWorkOrder.id) {
                try {
                    await updateUserEmailManagerLastUsedConfig({
                        workOrderId: newWorkOrder.id
                    });
                } catch (error) {
                    console.error('Failed to persist work order navigation:', error);
                }
            }
        }
    }

    const goToPreviousWorkOrder = async () => {
        if (currentWorkOrderIndex > 0) {
            const newIndex = currentWorkOrderIndex - 1;
            setCurrentWorkOrderIndex(newIndex);
            
            // Persist the new work order selection
            const newWorkOrder = workOrders[newIndex];
            if (newWorkOrder && newWorkOrder.id) {
                try {
                    await updateUserEmailManagerLastUsedConfig({
                        workOrderId: newWorkOrder.id
                    });
                } catch (error) {
                    console.error('Failed to persist work order navigation:', error);
                }
            }
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
                // Filter archived work orders by user's event access
                let filteredArchivedWorkOrders = result;
                if (userEventAccess.length > 0 && !userEventAccess.includes('all')) {
                    // If user has specific event access (not 'all'), filter by those events
                    filteredArchivedWorkOrders = result.filter(wo => userEventAccess.includes(wo.eventCode));
                } else if (!userEventAccess.includes('all') && userEventAccess.length === 0) {
                    // If no event access configured, show no archived work orders
                    filteredArchivedWorkOrders = [];
                }
                // If user has 'all' access or userEventAccess includes 'all', show all archived work orders

                setArchivedWorkOrders(filteredArchivedWorkOrders)
                // Load participant names for all archived work orders
                await loadParticipantNamesForArchived(filteredArchivedWorkOrders)
            }
        } catch (error) {
            console.error('Failed to load archived work orders:', error)
        } finally {
            setLoadingArchived(false)
        }
    }

    const handleUnarchiveWorkOrder = async (workOrderId: string) => {
        if (!workOrderId) return

        setUnarchivingId(workOrderId)
        try {
            await updateTableItem('work-orders', workOrderId, 'archived', false, userPid, userHash)
            setArchivedWorkOrders(prev => prev.filter(wo => wo.id !== workOrderId))
            setRefreshCounter(prev => prev + 1)
        } catch (error) {
            console.error(`Failed to unarchive work order ${workOrderId}:`, error)
        } finally {
            setUnarchivingId(null)
        }
    }

    const loadParticipantNamesForArchived = async (archivedOrders: WorkOrder[]) => {
        setLoadingParticipantNames(true)
        const uniquePids = new Set<string>()

        // Collect all unique user IDs from createdBy and archivedBy fields
        archivedOrders.forEach(wo => {
            if (wo.createdBy) uniquePids.add(wo.createdBy)
            if (wo.archivedBy) uniquePids.add(wo.archivedBy)
        })

        // Load names for each unique user ID
        const namePromises = Array.from(uniquePids).map(async (pid) => {
            if (!participantNames[pid]) {
                try {
                    const result = await getTableItem('students', pid, userPid, userHash)
                    if (result && (result.first || result.last)) {
                        const firstName = result.first || ''
                        const lastName = result.last || ''
                        return { pid, name: `${firstName} ${lastName}`.trim() }
                    } else {
                        return { pid, name: pid }
                    }
                } catch (error) {
                    console.error(`Failed to load name for user ${pid}:`, error)
                    return { pid, name: pid }
                }
            }
            return { pid, name: participantNames[pid] }
        })

        try {
            const nameResults = await Promise.all(namePromises)
            const newNames = { ...participantNames }
            nameResults.forEach(({ pid, name }) => {
                newNames[pid] = name
            })
            setParticipantNames(newNames)
        } finally {
            setLoadingParticipantNames(false)
        }
    }

    // Views management functions
    const fetchViews = useCallback(async () => {
        try {
            const views = await getAllTableItems('views', userPid, userHash)
            if (views && 'redirected' in views) {
                console.log('Views fetch redirected - authentication required')
                return []
            }
            return views as View[]
        } catch (error) {
            console.error('Error fetching views:', error)
            return []
        }
    }, [userPid, userHash])

    const fetchPools = useCallback(async () => {
        try {
            const pools = await getAllTableItems('pools', userPid, userHash)
            if (pools && 'redirected' in pools) {
                console.log('Pools fetch redirected - authentication required')
                return []
            }
            return pools as Pool[]
        } catch (error) {
            console.error('Error fetching pools:', error)
            return []
        }
    }, [userPid, userHash])

    const handleOpenViewsModal = async () => {
        setViewsLoading(true)
        try {
            const [views, pools] = await Promise.all([fetchViews(), fetchPools()])
            setAllViews(views)
            setAllPools(pools)
            setShowViewsModal(true)
        } catch (error) {
            console.error('Error loading views:', error)
        } finally {
            setViewsLoading(false)
        }
    }

    const handleCreateNewView = () => {
        setIsNewView(true)
        setViewFormData({
            name: '',
            columnDefs: [],
            viewConditions: []
        })
        setShowViewsModal(true)
    }

    const handleEditView = (view: View) => {
        setIsNewView(false)
        setViewFormData({ ...view })
        setShowViewsModal(true)
    }

    const handleSaveView = async () => {
        if (!viewFormData.name.trim()) {
            alert('View name is required')
            return
        }

        setViewsLoading(true)
        try {
            await putTableItem('views', viewFormData.name, viewFormData, userPid, userHash)
            const updatedViews = await fetchViews()
            setAllViews(updatedViews)
            setShowViewsModal(false)
        } catch (error) {
            console.error('Error saving view:', error)
            alert('Failed to save view')
        } finally {
            setViewsLoading(false)
        }
    }

    const handleDeleteView = async () => {
        if (!viewFormData.name) return

        setViewsLoading(true)
        try {
            await deleteTableItem('views', viewFormData.name, userPid, userHash)
            const updatedViews = await fetchViews()
            setAllViews(updatedViews)
            setShowDeleteViewConfirm(false)
            setShowViewsModal(false)
        } catch (error) {
            console.error('Error deleting view:', error)
            alert('Failed to delete view')
        } finally {
            setViewsLoading(false)
        }
    }

    const handleAddColumnDef = () => {
        setViewFormData({
            ...viewFormData,
            columnDefs: [...viewFormData.columnDefs, { name: '' }]
        })
    }

    const handleUpdateColumnDef = (index: number, field: string, value: unknown) => {
        const updated = [...viewFormData.columnDefs]
        updated[index] = { ...updated[index], [field]: value }
        setViewFormData({ ...viewFormData, columnDefs: updated })
    }

    const handleDeleteColumnDef = (index: number) => {
        setViewFormData({
            ...viewFormData,
            columnDefs: viewFormData.columnDefs.filter((_, i) => i !== index)
        })
    }

    const handleAddViewCondition = () => {
        setViewFormData({
            ...viewFormData,
            viewConditions: [...viewFormData.viewConditions, { name: 'currentAIDBool', boolValue: true }]
        })
    }

    const handleUpdateViewCondition = (index: number, field: string, value: unknown) => {
        const updated = [...viewFormData.viewConditions]
        updated[index] = { ...updated[index], [field]: value }
        setViewFormData({ ...viewFormData, viewConditions: updated })
    }

    const handleDeleteViewCondition = (index: number) => {
        setViewFormData({
            ...viewFormData,
            viewConditions: viewFormData.viewConditions.filter((_, i) => i !== index)
        })
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
                <button
                    className="status-item"
                    onClick={handleOpenViewsModal}
                    title="Manage Views"
                    style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: 'inherit' }}
                >
                    👁️ Views
                </button>
                <span className="status-item export-enabled">
                    Export Enabled
                </span>
                {isClient && (
                    <span className="status-item user-info">
                        {userName ? userName : (userPid === 'default-user-pid' ? 'Loading...' : userPid)}
                    </span>
                )}
                {isClient && userPid !== 'default-user-pid' && userHash !== 'default-hash' && (
                    <span className="status-item version-info">
                        <VersionBadge pid={userPid} hash={userHash} />
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
                userEventAccess={userEventAccess}
                onWorkOrderIndexChange={updateUserEmailManagerLastUsedConfig}
                editedWorkOrderId={editedWorkOrderId}
                setEditedWorkOrderId={setEditedWorkOrderId}
            />

            <Modal show={showForm} onHide={handleFormClose} size="lg">
                <Modal.Header closeButton className="bg-dark text-light">
                    <Modal.Title>
                        <div className="d-flex align-items-center">
                            <span className="me-2">
                                {editingWorkOrderId ? 'Edit Work Order' : 'New Work Order'}
                            </span>
                            {formLoading && (
                                <Spinner
                                    as="span"
                                    animation="border"
                                    size="sm"
                                    role="status"
                                    aria-hidden="true"
                                />
                            )}
                        </div>
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
                        onLoadingChange={setFormLoading}
                        userEventAccess={userEventAccess}
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
                                        <th style={{ border: 'none' }}>Actions</th>
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
                                                {loadingParticipantNames ? (
                                                    <span className="text-muted">Loading...</span>
                                                ) : (
                                                    workOrder.createdBy ? (participantNames[workOrder.createdBy] || workOrder.createdBy) : 'Unknown'
                                                )}
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle' }}>
                                                <div>
                                                    <div style={{ fontSize: '0.85em' }}>
                                                        {workOrder.archivedAt ? new Date(workOrder.archivedAt).toLocaleDateString() : 'Unknown'}
                                                    </div>
                                                    <div style={{ fontSize: '0.75em', color: '#888' }}>
                                                        by {loadingParticipantNames ? (
                                                            <span className="text-muted">Loading...</span>
                                                        ) : (
                                                            workOrder.archivedBy ? (participantNames[workOrder.archivedBy] || workOrder.archivedBy) : 'Unknown'
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle' }}>
                                                <Button
                                                    variant="outline-success"
                                                    size="sm"
                                                    disabled={!writePermission || unarchivingId === workOrder.id}
                                                    onClick={() => handleUnarchiveWorkOrder(workOrder.id)}
                                                >
                                                    {unarchivingId === workOrder.id ? (
                                                        <>
                                                            <Spinner
                                                                as="span"
                                                                animation="border"
                                                                size="sm"
                                                                role="status"
                                                                aria-hidden="true"
                                                                className="me-2"
                                                            />
                                                            Unarchiving...
                                                        </>
                                                    ) : (
                                                        'Unarchive'
                                                    )}
                                                </Button>
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

            {/* Views Management Modal */}
            <Modal
                show={showViewsModal}
                onHide={() => setShowViewsModal(false)}
                size="xl"
                dialogClassName="modal-fullscreen-lg-down"
            >
                <Modal.Header closeButton className="bg-dark text-light">
                    <Modal.Title style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginRight: '2rem' }}>
                        <span>Views Management</span>
                        <Button
                            variant="outline-warning"
                            size="sm"
                            onClick={handleCreateNewView}
                            disabled={!writePermission}
                        >
                            + Create New View
                        </Button>
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body className="bg-dark text-light" style={{ maxHeight: '80vh', overflow: 'hidden' }}>
                    {viewsLoading ? (
                        <div className="text-center py-4">
                            <Spinner animation="border" role="status">
                                <span className="visually-hidden">Loading...</span>
                            </Spinner>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '1rem', height: '70vh' }}>
                            {/* Left side - Views List */}
                            <div style={{ width: '30%', borderRight: '1px solid #444', paddingRight: '1rem', overflowY: 'auto' }}>
                                <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Views</h5>
                                {allViews.length === 0 ? (
                                    <div className="text-muted">No views found</div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {allViews.map(view => (
                                            <div
                                                key={view.name}
                                                onClick={() => handleEditView(view)}
                                                style={{
                                                    padding: '0.75rem',
                                                    backgroundColor: viewFormData.name === view.name ? '#333' : '#222',
                                                    border: '1px solid #444',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    transition: 'background-color 0.2s'
                                                }}
                                                onMouseEnter={(e) => {
                                                    if (viewFormData.name !== view.name) {
                                                        e.currentTarget.style.backgroundColor = '#2a2a2a'
                                                    }
                                                }}
                                                onMouseLeave={(e) => {
                                                    if (viewFormData.name !== view.name) {
                                                        e.currentTarget.style.backgroundColor = '#222'
                                                    }
                                                }}
                                            >
                                                <div style={{ fontWeight: 'bold' }}>{view.name}</div>
                                                <div style={{ fontSize: '0.85em', color: '#aaa' }}>
                                                    {view.columnDefs.length} columns, {view.viewConditions.length} conditions
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Right side - View Editor */}
                            <div style={{ flex: 1, overflowY: 'auto', paddingLeft: '1rem' }}>
                                <Form>
                                    <div className="card bg-secondary mb-3">
                                        <h5 style={{ color: '#ffc107', marginBottom: '1rem' }}>Basic Information</h5>
                                        <Form.Group className="mb-3">
                                            <Form.Label>View Name*</Form.Label>
                                            <Form.Control
                                                type="text"
                                                value={viewFormData.name}
                                                onChange={(e) => setViewFormData({ ...viewFormData, name: e.target.value })}
                                                disabled={!isNewView}
                                                placeholder="e.g., joined-vermont"
                                            />
                                        </Form.Group>
                                        {!isNewView && (
                                            <div className="d-flex justify-content-end">
                                                <Button
                                                    variant="outline-danger"
                                                    size="sm"
                                                    onClick={() => setShowDeleteViewConfirm(true)}
                                                    disabled={!writePermission}
                                                >
                                                    🗑️ Delete View
                                                </Button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Column Definitions */}
                                    <div className="card bg-secondary mb-3">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                            <h5 style={{ color: '#ffc107', margin: 0 }}>Column Definitions</h5>
                                            <Button variant="outline-warning" size="sm" onClick={handleAddColumnDef} disabled={!writePermission}>
                                                + Add Column
                                            </Button>
                                        </div>
                                        {viewFormData.columnDefs.length > 0 ? (
                                            viewFormData.columnDefs.map((colDef, index) => {
                                                const colName = colDef.name || ''
                                                const isPredefined = ['rowIndex', 'name', 'email', 'accepted', 'withdrawn', 'installmentsTotal', 'installmentsReceived', 'installmentsDue', 'installmentsLF', 'spokenLanguage'].includes(colName)
                                                
                                                return (
                                                    <div key={index} className="mb-3 p-3" style={{ backgroundColor: '#1a1a1a', borderRadius: '4px' }}>
                                                        <Row>
                                                            <Col md={12}>
                                                                <Form.Group className="mb-2">
                                                                    <Form.Label>Column Name*</Form.Label>
                                                                    <Form.Control
                                                                        type="text"
                                                                        list={`col-name-${index}`}
                                                                        value={colName}
                                                                        onChange={(e) => handleUpdateColumnDef(index, 'name', e.target.value)}
                                                                        placeholder="e.g., rowIndex, poolMember-xyz, currentAIDBool-abc"
                                                                    />
                                                                    <datalist id={`col-name-${index}`}>
                                                                        <option value="rowIndex" />
                                                                        <option value="name" />
                                                                        <option value="email" />
                                                                        <option value="accepted" />
                                                                        <option value="withdrawn" />
                                                                        <option value="installmentsTotal" />
                                                                        <option value="installmentsReceived" />
                                                                        <option value="installmentsDue" />
                                                                        <option value="installmentsLF" />
                                                                        <option value="spokenLanguage" />
                                                                    </datalist>
                                                                </Form.Group>
                                                            </Col>
                                                        </Row>
                                                        {!isPredefined && (
                                                            <>
                                                                <Row>
                                                                    <Col md={6}>
                                                                        <Form.Group className="mb-2">
                                                                            <Form.Label>Header Name</Form.Label>
                                                                            <Form.Control
                                                                                type="text"
                                                                                value={colDef.headerName || ''}
                                                                                onChange={(e) => handleUpdateColumnDef(index, 'headerName', e.target.value)}
                                                                                placeholder="Display name for column"
                                                                            />
                                                                        </Form.Group>
                                                                    </Col>
                                                                </Row>
                                                                {colName.includes('poolMember') && (
                                                                    <Row>
                                                                        <Col md={6}>
                                                                            <Form.Group className="mb-2">
                                                                                <Form.Label>Pool Name*</Form.Label>
                                                                                <Form.Control
                                                                                    type="text"
                                                                                    list={`pool-${index}`}
                                                                                    value={colDef.pool || ''}
                                                                                    onChange={(e) => handleUpdateColumnDef(index, 'pool', e.target.value)}
                                                                                    placeholder="Select pool"
                                                                                />
                                                                                <datalist id={`pool-${index}`}>
                                                                                    {allPools.map(pool => (
                                                                                        <option key={pool.name} value={pool.name} />
                                                                                    ))}
                                                                                </datalist>
                                                                            </Form.Group>
                                                                        </Col>
                                                                    </Row>
                                                                )}
                                                                {(colName.includes('currentAIDBool') || colName.includes('baseBool') || colName.includes('currentAIDMapBool')) && (
                                                                    <Row>
                                                                        <Col md={6}>
                                                                            <Form.Group className="mb-2">
                                                                                <Form.Label>Bool Name*</Form.Label>
                                                                                <Form.Control
                                                                                    type="text"
                                                                                    value={colDef.boolName || ''}
                                                                                    onChange={(e) => handleUpdateColumnDef(index, 'boolName', e.target.value)}
                                                                                    placeholder="e.g., join, accepted, withdrawn"
                                                                                />
                                                                            </Form.Group>
                                                                        </Col>
                                                                        {colName.includes('currentAIDMapBool') && (
                                                                            <Col md={6}>
                                                                                <Form.Group className="mb-2">
                                                                                    <Form.Label>Map Name*</Form.Label>
                                                                                    <Form.Control
                                                                                        type="text"
                                                                                        value={colDef.map || ''}
                                                                                        onChange={(e) => handleUpdateColumnDef(index, 'map', e.target.value)}
                                                                                        placeholder="e.g., whichRetreats, prefNec"
                                                                                    />
                                                                                </Form.Group>
                                                                            </Col>
                                                                        )}
                                                                    </Row>
                                                                )}
                                                                {(colName.includes('currentAIDString') || colName.includes('baseString')) && (
                                                                    <Row>
                                                                        <Col md={6}>
                                                                            <Form.Group className="mb-2">
                                                                                <Form.Label>String Name*</Form.Label>
                                                                                <Form.Control
                                                                                    type="text"
                                                                                    value={colDef.stringName || ''}
                                                                                    onChange={(e) => handleUpdateColumnDef(index, 'stringName', e.target.value)}
                                                                                    placeholder="e.g., submitTime, mobilePhone"
                                                                                />
                                                                            </Form.Group>
                                                                        </Col>
                                                                    </Row>
                                                                )}
                                                                {colName.includes('offeringCount') && (
                                                                    <Row>
                                                                        <Col md={6}>
                                                                            <Form.Group className="mb-2">
                                                                                <Form.Label>AID*</Form.Label>
                                                                                <Form.Control
                                                                                    type="text"
                                                                                    value={colDef.aid || ''}
                                                                                    onChange={(e) => handleUpdateColumnDef(index, 'aid', e.target.value)}
                                                                                    placeholder="Event code"
                                                                                />
                                                                            </Form.Group>
                                                                        </Col>
                                                                    </Row>
                                                                )}
                                                                {colName.includes('currentAIDMapList') && (
                                                                    <Row>
                                                                        <Col md={6}>
                                                                            <Form.Group className="mb-2">
                                                                                <Form.Label>Map Name*</Form.Label>
                                                                                <Form.Control
                                                                                    type="text"
                                                                                    value={colDef.map || ''}
                                                                                    onChange={(e) => handleUpdateColumnDef(index, 'map', e.target.value)}
                                                                                    placeholder="e.g., setup, service"
                                                                                />
                                                                            </Form.Group>
                                                                        </Col>
                                                                    </Row>
                                                                )}
                                                            </>
                                                        )}
                                                        <div className="d-flex justify-content-end mt-2">
                                                            <Button
                                                                variant="outline-danger"
                                                                size="sm"
                                                                onClick={() => handleDeleteColumnDef(index)}
                                                                disabled={!writePermission}
                                                            >
                                                                Delete
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )
                                            })
                                        ) : (
                                            <div className="text-muted text-center py-3">No column definitions</div>
                                        )}
                                    </div>

                                    {/* View Conditions */}
                                    <div className="card bg-secondary mb-3">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                            <h5 style={{ color: '#ffc107', margin: 0 }}>View Conditions</h5>
                                            <Button variant="outline-warning" size="sm" onClick={handleAddViewCondition} disabled={!writePermission}>
                                                + Add Condition
                                            </Button>
                                        </div>
                                        {viewFormData.viewConditions.length > 0 ? (
                                            viewFormData.viewConditions.map((condition, index) => (
                                                <div key={index} className="mb-3 p-3" style={{ backgroundColor: '#1a1a1a', borderRadius: '4px' }}>
                                                    <Row>
                                                        <Col md={4}>
                                                            <Form.Group className="mb-2">
                                                                <Form.Label>Condition Type*</Form.Label>
                                                                <Form.Select
                                                                    value={condition.name || 'currentAIDBool'}
                                                                    onChange={(e) => handleUpdateViewCondition(index, 'name', e.target.value)}
                                                                >
                                                                    <option value="currentAIDBool">currentAIDBool</option>
                                                                    <option value="currentAIDMapBool">currentAIDMapBool</option>
                                                                    <option value="baseBool">baseBool</option>
                                                                    <option value="poolMember">poolMember</option>
                                                                </Form.Select>
                                                            </Form.Group>
                                                        </Col>
                                                        {(condition.name === 'currentAIDBool' || condition.name === 'baseBool') && (
                                                            <>
                                                                <Col md={4}>
                                                                    <Form.Group className="mb-2">
                                                                        <Form.Label>Bool Name*</Form.Label>
                                                                        <Form.Control
                                                                            type="text"
                                                                            value={condition.boolName || ''}
                                                                            onChange={(e) => handleUpdateViewCondition(index, 'boolName', e.target.value)}
                                                                            placeholder="e.g., join, withdrawn"
                                                                        />
                                                                    </Form.Group>
                                                                </Col>
                                                                <Col md={4}>
                                                                    <Form.Group className="mb-2">
                                                                        <Form.Label>Bool Value*</Form.Label>
                                                                        <Form.Select
                                                                            value={condition.boolValue === true ? 'true' : condition.boolValue === false ? 'false' : ''}
                                                                            onChange={(e) => handleUpdateViewCondition(index, 'boolValue', e.target.value === 'true')}
                                                                        >
                                                                            <option value="true">true</option>
                                                                            <option value="false">false</option>
                                                                        </Form.Select>
                                                                    </Form.Group>
                                                                </Col>
                                                            </>
                                                        )}
                                                        {condition.name === 'currentAIDMapBool' && (
                                                            <>
                                                                <Col md={3}>
                                                                    <Form.Group className="mb-2">
                                                                        <Form.Label>Map Name*</Form.Label>
                                                                        <Form.Control
                                                                            type="text"
                                                                            value={condition.map || ''}
                                                                            onChange={(e) => handleUpdateViewCondition(index, 'map', e.target.value)}
                                                                            placeholder="e.g., whichRetreats"
                                                                        />
                                                                    </Form.Group>
                                                                </Col>
                                                                <Col md={3}>
                                                                    <Form.Group className="mb-2">
                                                                        <Form.Label>Bool Name*</Form.Label>
                                                                        <Form.Control
                                                                            type="text"
                                                                            value={condition.boolName || ''}
                                                                            onChange={(e) => handleUpdateViewCondition(index, 'boolName', e.target.value)}
                                                                            placeholder="e.g., mahayana"
                                                                        />
                                                                    </Form.Group>
                                                                </Col>
                                                                <Col md={2}>
                                                                    <Form.Group className="mb-2">
                                                                        <Form.Label>Bool Value*</Form.Label>
                                                                        <Form.Select
                                                                            value={condition.boolValue === true ? 'true' : condition.boolValue === false ? 'false' : ''}
                                                                            onChange={(e) => handleUpdateViewCondition(index, 'boolValue', e.target.value === 'true')}
                                                                        >
                                                                            <option value="true">true</option>
                                                                            <option value="false">false</option>
                                                                        </Form.Select>
                                                                    </Form.Group>
                                                                </Col>
                                                            </>
                                                        )}
                                                        {condition.name === 'poolMember' && (
                                                            <Col md={8}>
                                                                <Form.Group className="mb-2">
                                                                    <Form.Label>Pool Name*</Form.Label>
                                                                    <Form.Control
                                                                        type="text"
                                                                        list={`condition-pool-${index}`}
                                                                        value={condition.pool || ''}
                                                                        onChange={(e) => handleUpdateViewCondition(index, 'pool', e.target.value)}
                                                                        placeholder="Select pool"
                                                                    />
                                                                    <datalist id={`condition-pool-${index}`}>
                                                                        {allPools.map(pool => (
                                                                            <option key={pool.name} value={pool.name} />
                                                                        ))}
                                                                    </datalist>
                                                                </Form.Group>
                                                            </Col>
                                                        )}
                                                    </Row>
                                                    <div className="d-flex justify-content-end mt-2">
                                                        <Button
                                                            variant="outline-danger"
                                                            size="sm"
                                                            onClick={() => handleDeleteViewCondition(index)}
                                                            disabled={!writePermission}
                                                        >
                                                            Delete
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-muted text-center py-3">No view conditions</div>
                                        )}
                                    </div>
                                </Form>
                            </div>
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer className="bg-dark text-light">
                    <Button variant="secondary" onClick={() => setShowViewsModal(false)}>
                        Close
                    </Button>
                    {viewFormData.name && (
                        <Button variant="warning" onClick={handleSaveView} disabled={!writePermission || viewsLoading}>
                            {viewsLoading ? (
                                <>
                                    <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
                                    Saving...
                                </>
                            ) : (
                                'Save View'
                            )}
                        </Button>
                    )}
                </Modal.Footer>
            </Modal>

            {/* Delete View Confirmation Modal */}
            <Modal show={showDeleteViewConfirm} onHide={() => setShowDeleteViewConfirm(false)}>
                <Modal.Header closeButton className="bg-dark text-light">
                    <Modal.Title>Confirm Delete</Modal.Title>
                </Modal.Header>
                <Modal.Body className="bg-dark text-light">
                    Are you sure you want to delete the view &quot;{viewFormData.name}&quot;? This action cannot be undone.
                </Modal.Body>
                <Modal.Footer className="bg-dark text-light">
                    <Button variant="secondary" onClick={() => setShowDeleteViewConfirm(false)}>
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={handleDeleteView} disabled={viewsLoading}>
                        {viewsLoading ? (
                            <>
                                <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
                                Deleting...
                            </>
                        ) : (
                            'Delete'
                        )}
                    </Button>
                </Modal.Footer>
            </Modal>
        </Container>
    )
} 