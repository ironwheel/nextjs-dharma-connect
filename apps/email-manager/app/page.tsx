"use client";
import React, { useState, useEffect, useRef } from 'react'
import { Container, Modal, Spinner, Button } from 'react-bootstrap'
import WorkOrderList from '../components/WorkOrderList'
import WorkOrderForm from '../components/WorkOrderForm'
import { toast } from 'react-toastify'
import { callDbApi } from '@dharma/shared/src/clientApi'

function getQueryParam(name: string): string | null {
    if (typeof window === 'undefined') return null;
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
}

export default function Home() {
    const pid = getQueryParam('pid')
    const userPid = pid || 'default-user-pid'
    const [showForm, setShowForm] = useState(false)
    const [editingWorkOrderId, setEditingWorkOrderId] = useState<string | undefined>()
    const [authChecked, setAuthChecked] = useState(false)
    const [authError, setAuthError] = useState<string | null>(null)
    const [verifyEmail, setVerifyEmail] = useState<string | null>(null)
    const initialLoadStarted = useRef(false)
    const [refreshCounter, setRefreshCounter] = useState(0)

    useEffect(() => {
        if (initialLoadStarted.current) return;
        initialLoadStarted.current = true;
        const pid = getQueryParam('pid');
        const hash = getQueryParam('hash');
        const url = window.location.hostname;
        if (!pid || !hash) {
            setAuthError('Missing PID or HASH in URL.');
            setAuthChecked(true);
            return;
        }
        // Call /api/auth to check access
        fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'handleCheckAccess', pid, hash, url })
        })
            .then(async (res) => {
                const data = await res.json();
                if (!res.ok || data?.data?.err) {
                    setAuthError(data?.data?.err || 'Access check failed.');
                    setAuthChecked(true);
                } else {
                    // Success: store pid/hash in localStorage for later API calls
                    localStorage.setItem('pid', pid);
                    localStorage.setItem('hash', hash);
                    setAuthChecked(true);
                }
            })
            .catch((err) => {
                setAuthError('Access check failed: ' + err.message);
                setAuthChecked(true);
            });
    }, [])

    const handleNewWorkOrder = () => {
        setEditingWorkOrderId(undefined)
        setShowForm(true)
    }

    const handleEditWorkOrder = (workOrderId: string) => {
        setEditingWorkOrderId(workOrderId)
        setShowForm(true)
    }

    const handleFormClose = async () => {
        // When the form closes, unlock the work order if one was being edited.
        if (editingWorkOrderId) {
            try {
                console.log('Unlocking work order:', editingWorkOrderId, 'for user:', userPid);
                const unlockResult = await callDbApi('handleUnlockWorkOrder', {
                    id: editingWorkOrderId,
                    userPid
                });
                console.log('Unlock result:', unlockResult);

                // Add a small delay to ensure the unlock operation is processed
                await new Promise(resolve => setTimeout(resolve, 100));

                console.log('Successfully unlocked work order:', editingWorkOrderId);
            } catch (err) {
                // Log error but don't bother the user, as the lock will expire anyway.
                console.error('Failed to unlock work order on form close:', err);
            }
        }
        setShowForm(false)
        setEditingWorkOrderId(undefined)
        setRefreshCounter(prev => prev + 1)
    }

    if (!authChecked) {
        return (
            <Container className="py-4 text-center bg-dark text-light min-vh-100">
                <Spinner animation="border" role="status" />
                <div>Checking access...</div>
            </Container>
        )
    }

    if (authError) {
        return (
            <Container className="py-4 text-center">
                <div className="alert alert-danger">{authError}</div>
                <Button onClick={() => window.location.reload()}>Retry</Button>
            </Container>
        )
    }

    return (
        <Container className="py-4 bg-dark text-light min-vh-100">
            <h1 className="mb-4 text-light">Email Work Orders</h1>
            <WorkOrderList
                onEdit={handleEditWorkOrder}
                onNew={handleNewWorkOrder}
                refreshTrigger={refreshCounter}
                userPid={userPid}
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
                    />
                </Modal.Body>
            </Modal>
        </Container>
    )
} 