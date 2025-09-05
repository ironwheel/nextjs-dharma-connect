import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Table, Button, Badge, Modal, Spinner } from 'react-bootstrap'
import { toast } from 'react-toastify'
import { getAllTableItems, useWebSocket, getTableItem, getTableItemOrNull, updateTableItem, sendSQSMessage, putTableItem, authGetConfigValue } from 'sharedFrontend'
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
    refreshTrigger?: number
    userPid: string
    userHash: string
    newlyCreatedWorkOrder?: WorkOrder
    writePermission: boolean
    currentWorkOrderIndex: number
    setCurrentWorkOrderIndex: (index: number) => void
    setWorkOrders: (workOrders: WorkOrder[]) => void
    onWorkOrderIndexChange?: (updates: { workOrderId?: string }) => Promise<boolean>
    editedWorkOrderId?: string | null
    setEditedWorkOrderId?: (id: string | null) => void
    userEventAccess: string[]
}

export default function WorkOrderList({ onEdit, refreshTrigger = 0, userPid, userHash, newlyCreatedWorkOrder, writePermission, currentWorkOrderIndex, setCurrentWorkOrderIndex, setWorkOrders, onWorkOrderIndexChange, editedWorkOrderId, setEditedWorkOrderId, userEventAccess }: WorkOrderListProps) {
    const [workOrders, setWorkOrdersLocal] = useState<WorkOrder[]>([])
    const [loading, setLoading] = useState(true)
    const [participantNames, setParticipantNames] = useState<Record<string, string>>({})
    const [hoveredRow, setHoveredRow] = useState<string | null>(null)
    const [showRecipientsModal, setShowRecipientsModal] = useState(false)
    const [currentRecipients, setCurrentRecipients] = useState<RecipientEntry[]>([]);
    const [recipientsType, setRecipientsType] = useState<'dry-run' | 'send'>('dry-run')

    const { lastMessage, status, connectionId } = useWebSocket()
    const prevWorkOrdersRef = useRef<WorkOrder[]>([])
    // Add state to cache campaign existence for each work order and language
    const [campaignExistence, setCampaignExistence] = useState<Record<string, Record<string, { dryrun: boolean; send: boolean; dryrunCount?: number; sendCount?: number }>>>({});
    const [campaignExistenceLoading, setCampaignExistenceLoading] = useState<Record<string, boolean>>({});
    const [recipientSearch, setRecipientSearch] = useState('');
    const [currentCampaignString, setCurrentCampaignString] = useState<string>('');
    const [eventNames, setEventNames] = useState<Record<string, string>>({});
    const [emailDisplayPermission, setEmailDisplayPermission] = useState<boolean>(true);
    const [exportCSVPermission, setExportCSVPermission] = useState<boolean>(true);
    const [restorationRetryCount, setRestorationRetryCount] = useState<number>(0);




    // Reset current index when work orders change
    useEffect(() => {
        if (workOrders.length > 0 && currentWorkOrderIndex >= workOrders.length) {
            setCurrentWorkOrderIndex(0)
        }
    }, [workOrders, currentWorkOrderIndex])

    // Update parent's workOrders state when local state changes
    useEffect(() => {
        setWorkOrders(workOrders)
    }, [workOrders, setWorkOrders])



    const downloadRecipientsCSV = (recipients: RecipientEntry[]) => {
        // Additional safety check - prevent download if permission is false
        if (!exportCSVPermission) {
            toast.error('CSV export is not permitted');
            return;
        }

        const csvContent = [
            'Name,Email,Send Time',
            ...recipients.map(r => `"${r.name}","${emailDisplayPermission ? r.email : '**********'}","${r.sendtime || ''}"`)
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

    const loadEventName = async (eventCode: string) => {
        if (!eventCode || eventNames[eventCode]) return
        try {
            const result = await getTableItem('events', eventCode, userPid, userHash)
            if (result && result.name) {
                setEventNames(prev => ({ ...prev, [eventCode]: result.name }))
            } else {
                setEventNames(prev => ({ ...prev, [eventCode]: eventCode }))
            }
        } catch {
            setEventNames(prev => ({ ...prev, [eventCode]: eventCode }))
        }
    }

    // Helper function to check if a work order should be visible based on user's event access
    const isWorkOrderAccessible = (workOrder: WorkOrder): boolean => {
        if (userEventAccess.length === 0) {
            return false; // No access configured
        }
        if (userEventAccess.includes('all')) {
            return true; // All access
        }
        return userEventAccess.includes(workOrder.eventCode); // Specific event access
    }

    const loadWorkOrders = useCallback(async () => {
        setLoading(true)
        try {
            const result = await getAllTableItems('work-orders', userPid, userHash)

            if (result && Array.isArray(result)) {
                // Filter work orders by user's event access
                let filteredWorkOrders = result;
                if (userEventAccess.length > 0 && !userEventAccess.includes('all')) {
                    // If user has specific event access (not 'all'), filter by those events
                    filteredWorkOrders = result.filter(wo => userEventAccess.includes(wo.eventCode));
                } else if (!userEventAccess.includes('all') && userEventAccess.length === 0) {
                    // If no event access configured, show no work orders
                    filteredWorkOrders = [];
                }
                // If user has 'all' access or userEventAccess includes 'all', show all work orders

                // Filter out archived work orders by default
                const activeWorkOrders = filteredWorkOrders.filter(wo => !wo.archived)
                // Sort by createdAt (newest first), with fallback for missing createdAt
                activeWorkOrders.sort((a, b) => {
                    const aTime = new Date(a.createdAt || '1970-01-01').getTime();
                    const bTime = new Date(b.createdAt || '1970-01-01').getTime();
                    return bTime - aTime;
                });
                setWorkOrdersLocal(activeWorkOrders)

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

                // Load event names for all work orders
                const uniqueEventCodes = new Set<string>()
                activeWorkOrders.forEach(wo => {
                    if (wo.eventCode) uniqueEventCodes.add(wo.eventCode)
                })

                uniqueEventCodes.forEach(eventCode => {
                    if (!eventNames[eventCode]) {
                        loadEventName(eventCode)
                    }
                })
            }
        } catch (error) {
            console.error('Failed to load work orders:', error)
            toast.error('Failed to load work orders')
        } finally {
            setLoading(false)
        }
    }, [userPid, userHash, setWorkOrders, userEventAccess])

    useEffect(() => {
        loadWorkOrders()
    }, [refreshTrigger, loadWorkOrders])

    // Handle edited work order restoration after refresh
    useEffect(() => {
        if (editedWorkOrderId && workOrders.length > 0 && setEditedWorkOrderId) {
            const editedWorkOrderIndex = workOrders.findIndex(wo => wo.id === editedWorkOrderId);
            if (editedWorkOrderIndex !== -1) {
                setCurrentWorkOrderIndex(editedWorkOrderIndex);
                setEditedWorkOrderId(null); // Clear the edited work order ID
                setRestorationRetryCount(0); // Reset retry count on success
            } else {
                // Increment retry count
                setRestorationRetryCount(prev => prev + 1);
                
                // Clear after max retries or timeout
                if (restorationRetryCount >= 5) {
                    setEditedWorkOrderId(null);
                    setRestorationRetryCount(0);
                } else {
                    // Set a timeout as backup
                    const timeoutId = setTimeout(() => {
                        setEditedWorkOrderId(null);
                        setRestorationRetryCount(0);
                    }, 5000); // 5 second timeout
                    
                    return () => clearTimeout(timeoutId);
                }
            }
        }
    }, [workOrders, editedWorkOrderId, setEditedWorkOrderId, restorationRetryCount]);

    // Load email display permission
    useEffect(() => {
        const loadEmailDisplayPermission = async () => {
            try {
                const permissionResponse = await authGetConfigValue(userPid, userHash, 'emailDisplay');
                setEmailDisplayPermission(permissionResponse === true);

                const exportCSVResponse = await authGetConfigValue(userPid, userHash, 'exportCSV');
                setExportCSVPermission(exportCSVResponse === true);
            } catch (error) {
                console.error('Failed to load permissions:', error);
                // Default to showing emails and allowing CSV export if permission check fails
                setEmailDisplayPermission(true);
                setExportCSVPermission(true);
            }
        };

        if (userPid && userHash) {
            loadEmailDisplayPermission();
        }
    }, [userPid, userHash]);


    useEffect(() => {
        if (lastMessage && lastMessage.type === 'workOrderUpdate') {
            // Handle DynamoDB Stream messages (from DynamoDB Streams)
            const newImage = lastMessage.newImage
            if (newImage) {
                const updatedWorkOrder = unmarshall(newImage) as WorkOrder

                if (updatedWorkOrder) {
                    setWorkOrdersLocal(prevOrders => {
                        const index = prevOrders.findIndex(wo => wo.id === updatedWorkOrder.id)

                        if (index === -1) {
                            // If it's a new work order, only add it if user has access
                            if (isWorkOrderAccessible(updatedWorkOrder)) {
                                const newOrders = [updatedWorkOrder, ...prevOrders]
                                newOrders.sort((a, b) => {
                                    const aTime = new Date(a.createdAt || '1970-01-01').getTime();
                                    const bTime = new Date(b.createdAt || '1970-01-01').getTime();
                                    return bTime - aTime;
                                })
                                return newOrders
                            } else {
                                // User doesn't have access to this work order, don't add it
                                console.log(`[ACCESS-DENIED] Not adding work order ${updatedWorkOrder.id} (${updatedWorkOrder.eventCode}) - user doesn't have access`);
                                return prevOrders
                            }
                        }

                        // Check if user still has access to this work order
                        const hasAccess = isWorkOrderAccessible(updatedWorkOrder);
                        
                        if (!hasAccess) {
                            // User no longer has access, remove this work order
                            console.log(`[ACCESS-DENIED] Removing work order ${updatedWorkOrder.id} (${updatedWorkOrder.eventCode}) - user no longer has access`);
                            const filteredOrders = prevOrders.filter(wo => wo.id !== updatedWorkOrder.id);
                            
                            // If the removed work order was the current one, adjust the index
                            if (index === currentWorkOrderIndex) {
                                // Move to the next available work order, or the last one if we're at the end
                                const newIndex = Math.min(currentWorkOrderIndex, filteredOrders.length - 1);
                                if (newIndex >= 0) {
                                    setCurrentWorkOrderIndex(newIndex);
                                }
                            } else if (index < currentWorkOrderIndex) {
                                // If we removed a work order before the current one, adjust the index
                                setCurrentWorkOrderIndex(currentWorkOrderIndex - 1);
                            }
                            
                            return filteredOrders;
                        }

                        // Check if we need to refresh campaign existence data
                        const oldWorkOrder = prevOrders[index];
                        const shouldRefreshCampaignData = checkIfCampaignDataNeedsRefresh(oldWorkOrder, updatedWorkOrder);

                        // Log lock status changes for debugging
                        if (oldWorkOrder.locked !== updatedWorkOrder.locked) {
                            console.log(`[LOCK-STATUS] Work order ${updatedWorkOrder.id} lock status changed:`, {
                                old: { locked: oldWorkOrder.locked, lockedBy: oldWorkOrder.lockedBy },
                                new: { locked: updatedWorkOrder.locked, lockedBy: updatedWorkOrder.lockedBy }
                            });
                        }

                        // Simply update with the real data from DynamoDB
                        const newOrders = [...prevOrders]
                        newOrders[index] = updatedWorkOrder;

                        // If campaign data needs refresh, trigger it
                        if (shouldRefreshCampaignData) {
                            // Use setTimeout to ensure state update completes first
                            setTimeout(async () => {
                                await prefetchCampaignExistence(updatedWorkOrder);
                            }, 100);
                        }

                        // If any step reached an error state, also refresh the work order data to get updated lock status
                        const hasErrorState = updatedWorkOrder.steps?.some(step => {
                            const status = typeof step.status === 'string' ? step.status :
                                (step.status && typeof step.status === 'object' && 'S' in step.status) ?
                                    (step.status as { S: string }).S : 'ready';
                            return status === 'error';
                        });

                        if (hasErrorState) {
                            setTimeout(async () => {
                                // Force refresh the work order data from database to get the correct lock status
                                try {
                                    const result = await getTableItem('work-orders', updatedWorkOrder.id, userPid, userHash);
                                    if (result) {
                                        const refreshedWorkOrder = result as WorkOrder;
                                        setWorkOrdersLocal(prevOrders => {
                                            const index = prevOrders.findIndex(wo => wo.id === updatedWorkOrder.id);
                                            if (index !== -1) {
                                                const newOrders = [...prevOrders];
                                                newOrders[index] = refreshedWorkOrder;
                                                return newOrders;
                                            }
                                            return prevOrders;
                                        });
                                        console.log(`[REFRESH] Work order ${updatedWorkOrder.id} data refreshed from database:`, {
                                            locked: refreshedWorkOrder.locked,
                                            lockedBy: refreshedWorkOrder.lockedBy
                                        });
                                    }
                                } catch (error) {
                                    console.error(`[REFRESH] Failed to refresh work order ${updatedWorkOrder.id}:`, error);
                                }
                            }, 200);
                        }

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

                setWorkOrdersLocal(prevOrders => {
                    const index = prevOrders.findIndex(wo => wo.id === updatedWorkOrder.id)

                    if (index === -1) {
                        // If it's a new work order, only add it if user has access
                        if (isWorkOrderAccessible(updatedWorkOrder)) {
                            const newOrders = [updatedWorkOrder, ...prevOrders]
                            newOrders.sort((a, b) => {
                                const aTime = new Date(a.createdAt || '1970-01-01').getTime();
                                const bTime = new Date(b.createdAt || '1970-01-01').getTime();
                                return bTime - aTime;
                            })
                            return newOrders
                        } else {
                            // User doesn't have access to this work order, don't add it
                            console.log(`[ACCESS-DENIED] Not adding work order ${updatedWorkOrder.id} (${updatedWorkOrder.eventCode}) - user doesn't have access`);
                            return prevOrders
                        }
                    }

                    // Check if user still has access to this work order
                    const hasAccess = isWorkOrderAccessible(updatedWorkOrder);
                    
                    if (!hasAccess) {
                        // User no longer has access, remove this work order
                        console.log(`[ACCESS-DENIED] Removing work order ${updatedWorkOrder.id} (${updatedWorkOrder.eventCode}) - user no longer has access`);
                        const filteredOrders = prevOrders.filter(wo => wo.id !== updatedWorkOrder.id);
                        
                        // If the removed work order was the current one, adjust the index
                        if (index === currentWorkOrderIndex) {
                            // Move to the next available work order, or the last one if we're at the end
                            const newIndex = Math.min(currentWorkOrderIndex, filteredOrders.length - 1);
                            if (newIndex >= 0) {
                                setCurrentWorkOrderIndex(newIndex);
                            }
                        } else if (index < currentWorkOrderIndex) {
                            // If we removed a work order before the current one, adjust the index
                            setCurrentWorkOrderIndex(currentWorkOrderIndex - 1);
                        }
                        
                        return filteredOrders;
                    }

                    // Check if we need to refresh campaign existence data
                    const oldWorkOrder = prevOrders[index];
                    const shouldRefreshCampaignData = checkIfCampaignDataNeedsRefresh(oldWorkOrder, updatedWorkOrder);

                    // Log lock status changes for debugging
                    if (oldWorkOrder.locked !== updatedWorkOrder.locked) {
                        console.log(`[LOCK-STATUS] Work order ${updatedWorkOrder.id} lock status changed:`, {
                            old: { locked: oldWorkOrder.locked, lockedBy: oldWorkOrder.lockedBy },
                            new: { locked: updatedWorkOrder.locked, lockedBy: updatedWorkOrder.lockedBy }
                        });
                    }

                    // Simply update with the real data from DynamoDB
                    const newOrders = [...prevOrders]
                    newOrders[index] = updatedWorkOrder;

                    // If campaign data needs refresh, trigger it
                    if (shouldRefreshCampaignData) {
                        // Use setTimeout to ensure state update completes first
                        setTimeout(async () => {
                            await prefetchCampaignExistence(updatedWorkOrder);
                        }, 100);
                    }

                    // If any step reached an error state, also refresh the work order data to get updated lock status
                    const hasErrorState = updatedWorkOrder.steps?.some(step => {
                        const status = typeof step.status === 'string' ? step.status :
                            (step.status && typeof step.status === 'object' && 'S' in step.status) ?
                                (step.status as { S: string }).S : 'ready';
                        return status === 'error';
                    });

                    if (hasErrorState) {
                        setTimeout(async () => {
                            // Force refresh the work order data from database to get the correct lock status
                            try {
                                const result = await getTableItem('work-orders', updatedWorkOrder.id, userPid, userHash);
                                if (result) {
                                    const refreshedWorkOrder = result as WorkOrder;
                                    setWorkOrdersLocal(prevOrders => {
                                        const index = prevOrders.findIndex(wo => wo.id === updatedWorkOrder.id);
                                        if (index !== -1) {
                                            const newOrders = [...prevOrders];
                                            newOrders[index] = refreshedWorkOrder;
                                            return newOrders;
                                        }
                                        return prevOrders;
                                    });
                                    console.log(`[REFRESH] Work order ${updatedWorkOrder.id} data refreshed from database:`, {
                                        locked: refreshedWorkOrder.locked,
                                        lockedBy: refreshedWorkOrder.lockedBy
                                    });
                                }
                            } catch (error) {
                                console.error(`[REFRESH] Failed to refresh work order ${updatedWorkOrder.id}:`, error);
                            }
                        }, 200);
                    }

                    return newOrders
                })
            }
        }
    }, [lastMessage])

    // Helper function to check if campaign data needs to be refreshed
    const checkIfCampaignDataNeedsRefresh = (oldWorkOrder: WorkOrder, newWorkOrder: WorkOrder): boolean => {
        if (!oldWorkOrder || !newWorkOrder || !oldWorkOrder.steps || !newWorkOrder.steps) {
            return false;
        }

        // Helper to extract step status
        const getStepStatus = (steps: WorkOrder['steps'], stepName: string): string => {
            const stepObj = steps.find((s) => {
                const name = typeof s.name === 'string' ? s.name :
                    (s.name && typeof s.name === 'object' && 'S' in s.name) ? (s.name as { S: string }).S : '';
                return name === stepName;
            });

            if (!stepObj) return 'ready';

            const status = typeof stepObj.status === 'string' ? stepObj.status :
                (stepObj.status && typeof stepObj.status === 'object' && 'S' in stepObj.status) ?
                    (stepObj.status as { S: string }).S : 'ready';
            return status;
        };

        // Check if Dry-Run step status changed to a terminal state
        const oldDryRunStatus = getStepStatus(oldWorkOrder.steps, 'Dry-Run');
        const newDryRunStatus = getStepStatus(newWorkOrder.steps, 'Dry-Run');
        const dryRunCompleted = (oldDryRunStatus !== 'complete' && oldDryRunStatus !== 'error' && oldDryRunStatus !== 'exception') &&
            (newDryRunStatus === 'complete' || newDryRunStatus === 'error' || newDryRunStatus === 'exception');

        // Check if Send step status changed to a terminal state
        const oldSendStatus = getStepStatus(oldWorkOrder.steps, 'Send');
        const newSendStatus = getStepStatus(newWorkOrder.steps, 'Send');
        const sendCompleted = (oldSendStatus !== 'complete' && oldSendStatus !== 'error' && oldSendStatus !== 'exception') &&
            (newSendStatus === 'complete' || newSendStatus === 'error' || newSendStatus === 'exception');

        return dryRunCompleted || sendCompleted;
    };



    // Update parent's workOrders state when local state changes
    useEffect(() => {
        setWorkOrders(workOrders)
    }, [workOrders, setWorkOrders])

    useEffect(() => {
        // Update the previous work orders reference for tracking changes
        prevWorkOrdersRef.current = workOrders;
    }, [workOrders]);

    // Handle newly created work order
    useEffect(() => {
        if (newlyCreatedWorkOrder) {
            // Add the newly created work order to the list
            setWorkOrdersLocal(prevOrders => {
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

            // Persist the newly created work order selection
            if (newlyCreatedWorkOrder.id && onWorkOrderIndexChange) {
                onWorkOrderIndexChange({
                    workOrderId: newlyCreatedWorkOrder.id
                }).catch(error => {
                    console.error('Failed to persist newly created work order selection:', error);
                });
            }

            // Clear the newly created work order after handling it
            // This will be done by the parent component
        }
    }, [newlyCreatedWorkOrder, onWorkOrderIndexChange]);

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

    const handleUnlockWorkOrder = async (workOrderId: string) => {
        try {
            // Get the current work order to preserve all fields
            const currentWorkOrder = workOrders.find(wo => wo.id === workOrderId)
            if (!currentWorkOrder) {
                toast.error('Work order not found')
                return
            }

            // Create updated work order with unlocked state
            const updatedWorkOrder = {
                ...currentWorkOrder,
                locked: false,
                lockedBy: undefined,
                updatedAt: new Date().toISOString()
            }

            // Update the work order using putTableItem
            await putTableItem('work-orders', workOrderId, updatedWorkOrder, userPid, userHash)

            // Update state immediately to reflect the unlock
            setWorkOrdersLocal(prevOrders => {
                const index = prevOrders.findIndex(wo => wo.id === workOrderId)
                if (index === -1) return prevOrders
                const newOrders = [...prevOrders]
                newOrders[index] = updatedWorkOrder
                return newOrders
            })

            toast.success('Work order unlocked successfully')
        } catch (error) {
            console.error('Error unlocking work order:', error)
            toast.error('Failed to unlock work order')
        }
    }

    const handleRowClick = async (workOrder: WorkOrder) => {
        if (workOrder.locked) {
            // Don't allow editing if locked
            return
        }

        // Try to lock the work order before opening for edit
        try {
            // Create updated work order with locked state
            const updatedWorkOrder = {
                ...workOrder,
                locked: true,
                lockedBy: userPid,
                updatedAt: new Date().toISOString()
            }

            // Lock the work order using putTableItem
            await putTableItem('work-orders', workOrder.id, updatedWorkOrder, userPid, userHash)

            // Update state immediately to reflect the lock
            setWorkOrdersLocal(prevOrders => {
                const index = prevOrders.findIndex(wo => wo.id === workOrder.id)
                if (index === -1) return prevOrders
                const newOrders = [...prevOrders]
                newOrders[index] = updatedWorkOrder
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
                setWorkOrdersLocal(prevOrders => {
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
            } else {
                // If stopping a step, implement optimistic UI update to show "ready" status
                setWorkOrdersLocal(prevOrders => {
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
                                            status: 'ready',
                                            message: 'Ready to start',
                                            isActive: false
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

    const getStepHelpText = (stepName: string, workOrder: WorkOrder) => {
        switch (stepName) {
            case 'Count':
                return '(sanity check count of eligible students)';
            case 'Prepare':
                return '(copy and check email in all languages from Mailchimp)';
            case 'Dry-Run':
                return '(exercise send process without sending, show eligible recipients)';
            case 'Test':
                return '(send email to selected testers to check formatting and test links)';
            case 'Send':
                return workOrder.sendContinuously
                    ? '(continuously evaluate eligibility and send email for a period of time)'
                    : '(evaluate eligiblity once, send email, then stop)';
            default:
                return '';
        }
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


            </div>

            {workOrders.length > 0 ? (
                <div>
                    <Table borderless hover variant="dark" className="mb-0">
                        <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: '#212529' }}>
                            <tr style={{ border: 'none' }}>
                                <th style={{ border: 'none' }}>Status</th>
                                <th style={{ border: 'none' }}>Event</th>
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
                                if (!workOrder) {
                                    return (
                                        <tr>
                                            <td colSpan={8} className="text-center text-muted py-4">
                                                No work orders found
                                            </td>
                                        </tr>
                                    )
                                }
                                return (
                                    <React.Fragment key={workOrder.id}>
                                        <tr
                                            onMouseEnter={() => setHoveredRow(workOrder.id)}
                                            onMouseLeave={() => setHoveredRow(null)}
                                            style={{ cursor: 'default' }}
                                        >
                                            <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.id ? '#484b50' : '#3a3d40' }}>
                                                <div className="d-flex align-items-center">
                                                    <Button
                                                        variant={workOrder.locked ? 'danger' : 'success'}
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            if (workOrder.locked) {
                                                                handleUnlockWorkOrder(workOrder.id)
                                                            } else {
                                                                handleRowClick(workOrder)
                                                            }
                                                        }}
                                                        disabled={!writePermission}
                                                        className="px-3 py-2"
                                                        title={workOrder.locked ? 'Click to unlock work order' : 'Click to edit work order'}
                                                    >
                                                        {workOrder.locked ? 'Locked' : 'Edit'}
                                                    </Button>
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
                                                            disabled={!writePermission}
                                                            style={{ marginLeft: 8 }}
                                                            title="Archive completed work order"
                                                        >
                                                            📁
                                                        </Button>
                                                    )}

                                                </div>
                                            </td>
                                            <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.id ? '#484b50' : '#3a3d40' }}>
                                                {eventNames[workOrder.eventCode] || workOrder.eventCode}
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
                                                                        <div style={{
                                                                            fontSize: '0.75rem',
                                                                            color: '#adb5bd',
                                                                            marginTop: '2px',
                                                                            fontStyle: 'italic'
                                                                        }}>
                                                                            {getStepHelpText(stepName, workOrder)}
                                                                        </div>
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
                                                                            disabled={status === 'closed' || !writePermission}
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
                                                                                disabled={status === 'closed' || !writePermission}
                                                                            >
                                                                                {buttonLabel}
                                                                            </Button>
                                                                        ) : null
                                                                    })()}
                                                                    {stepName === 'Dry-Run' && (() => {
                                                                        const prepareStep = workOrder.steps?.find(s => extractString(s.name) === 'Prepare')
                                                                        const dryRunStep = workOrder.steps?.find(s => extractString(s.name) === 'Dry-Run')
                                                                        // Show buttons if Prepare is complete OR if Dry-Run itself is complete (meaning it was already executed)
                                                                        const enabled = (prepareStep && extractString(prepareStep.status) === 'complete') ||
                                                                            (dryRunStep && extractString(dryRunStep.status) === 'complete')
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
                                                                                    disabled={status === 'closed' || !writePermission}
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
                                                                                disabled={status === 'closed' || !writePermission}
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
                                                                                    disabled={status === 'closed' || !writePermission}
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
                            disabled={!exportCSVPermission}
                            title={exportCSVPermission ? 'Download recipients as CSV' : 'CSV export is not permitted'}
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
                                            <td>{emailDisplayPermission ? recipient.email : '**********'}</td>
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