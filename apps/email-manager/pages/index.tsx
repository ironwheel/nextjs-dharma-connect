"use client";
import React, { useState } from 'react'
import { Container, Modal } from 'react-bootstrap'
import WorkOrderList from '../components/WorkOrderList'
import WorkOrderForm from '../components/WorkOrderForm'
import { updateTableItem, authGetConfigValue } from 'sharedFrontend'

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
    const [newlyCreatedWorkOrder, setNewlyCreatedWorkOrder] = useState<WorkOrder | undefined>(undefined)
    const [isClient, setIsClient] = useState(false)
    const [writePermission, setWritePermission] = useState(false)

    // Set isClient to true after component mounts
    React.useEffect(() => {
        const timer = setTimeout(() => {
            setIsClient(true)
        }, 100) // Small delay to ensure proper rendering
        return () => clearTimeout(timer)
    }, [])

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

    return (
        <Container className="py-4 bg-dark text-light min-vh-100">
            <h1 className="mb-2 text-light fw-bold fs-2">
                Email Manager
                {isClient && (
                    <span className="ms-2 text-info fs-6 fw-normal">
                        {window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                            ? 'localhost'
                            : (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'dev').substring(0, 7)
                        }
                    </span>
                )}
            </h1>
            <WorkOrderList
                onEdit={handleEditWorkOrder}
                onNew={handleNewWorkOrder}
                refreshTrigger={refreshCounter}
                userPid={userPid}
                userHash={userHash}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                newlyCreatedWorkOrder={newlyCreatedWorkOrder as any}
                writePermission={writePermission}
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
        </Container>
    )
} 