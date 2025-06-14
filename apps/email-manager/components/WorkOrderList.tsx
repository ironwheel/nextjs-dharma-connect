import React, { useEffect, useState } from 'react'
import { Table, Button, Badge } from 'react-bootstrap'
import { toast } from 'react-toastify'
import { callDbApi } from '@dharma/shared/src/clientApi'
import { FiPlus } from 'react-icons/fi'

interface WorkOrder {
    workOrderId: string
    eventCode: string
    subEvent: string
    stage: string
    language?: string
    languages?: { [key: string]: boolean }
    subject: string
    account: string
    createdBy: string
    steps: Array<{
        name: 'Prepare' | 'Test' | 'Send'
        status: 'ready' | 'working' | 'complete' | 'error' | 'interrupted'
        message: string
        isActive: boolean
    }>
    createdAt: string
    updatedAt: string
}

interface WorkOrderListProps {
    onEdit: (workOrderId: string) => void
    onNew: () => void
    refreshTrigger?: number
}

export default function WorkOrderList({ onEdit, onNew, refreshTrigger = 0 }: WorkOrderListProps) {
    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
    const [loading, setLoading] = useState(true)
    const [activeSteps, setActiveSteps] = useState<Record<string, boolean>>({})
    const [participantNames, setParticipantNames] = useState<Record<string, string>>({})
    const [hoveredRow, setHoveredRow] = useState<string | null>(null)

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
        try {
            const response = await callDbApi('handleGetWorkOrders', {})
            setWorkOrders(response?.workOrders ?? [])
            // Fetch participant names for all unique createdBy PIDs
            const pids = Array.from(new Set((response?.workOrders ?? []).map((wo: WorkOrder) => wo.createdBy)))
            pids.forEach(pid => { if (typeof pid === 'string' && pid && !participantNames[pid]) loadParticipantName(pid) })
        } catch (error) {
            console.error('Error loading work orders:', error)
            toast.error('Failed to load work orders')
            setWorkOrders([])
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadWorkOrders()
    }, [refreshTrigger])

    const getStatusBadgeClass = (status: string, isActive: boolean) => {
        if ((!isActive && status.toLowerCase() === 'ready') || status.toLowerCase() === 'ready') return 'bg-secondary text-dark'; // light gray for pending and ready
        switch (status.toLowerCase()) {
            case 'working':
                return 'bg-info'
            case 'complete':
                return 'bg-success'
            case 'error':
                return 'bg-danger'
            case 'interrupted':
                return 'bg-warning'
            default:
                return 'bg-secondary'
        }
    }

    const handleStepAction = async (workOrderId: string, stepName: 'Prepare' | 'Test' | 'Send', isStarting: boolean) => {
        try {
            if (isStarting) {
                // Show mock dialog after a delay
                setTimeout(() => {
                    const mockDialog = window.confirm(
                        'Choose step result:\n\n' +
                        '1. Complete (success)\n' +
                        '2. Working\n' +
                        '3. Error'
                    )

                    let status: 'complete' | 'working' | 'error'
                    let message = ''

                    if (mockDialog) {
                        const choice = prompt('Enter 1, 2, or 3:')
                        switch (choice) {
                            case '1':
                                status = 'complete'
                                message = 'Step completed successfully'
                                break
                            case '2':
                                status = 'working'
                                message = 'Step is in progress'
                                break
                            case '3':
                                status = 'error'
                                message = 'Step encountered an error'
                                break
                            default:
                                return
                        }

                        callDbApi('handleUpdateStepStatus', {
                            workOrderId,
                            id: workOrderId,
                            stepName,
                            status,
                            message
                        }).then(() => {
                            loadWorkOrders()
                        })
                    }
                }, 2000)
            }

            await callDbApi('handleUpdateStepStatus', {
                workOrderId,
                id: workOrderId,
                stepName,
                status: isStarting ? 'working' : 'interrupted',
                message: isStarting ? 'Step started' : 'Step was interrupted'
            })

            loadWorkOrders()
        } catch (error) {
            console.error('Error updating step status:', error)
            toast.error('Failed to update step status')
        }
    }

    if (loading) {
        return <div>Loading work orders...</div>
    }
    if (workOrders.length === 0) {
        return (
            <div className="bg-dark text-light min-vh-100">
                <div className="d-flex justify-content-between align-items-center mb-3">
                    <Button
                        variant="primary"
                        onClick={onNew}
                        style={{ borderRadius: '50%', width: 40, height: 40, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        aria-label="New Work Order"
                    >
                        <FiPlus size={24} />
                    </Button>
                    <div></div>
                </div>
                <div className="d-flex justify-content-center align-items-center" style={{ height: '300px', color: '#bbb', fontSize: '1.5rem' }}>
                    Work Order List is Empty
                </div>
            </div>
        )
    }

    return (
        <div className="bg-dark text-light">
            <div className="d-flex justify-content-between align-items-center mb-3">
                <Button
                    variant="primary"
                    onClick={onNew}
                    style={{ borderRadius: '50%', width: 40, height: 40, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    aria-label="New Work Order"
                >
                    <FiPlus size={24} />
                </Button>
                <div></div>
            </div>
            <div style={{ height: '600px', overflowY: 'auto' }}>
                <Table borderless hover variant="dark" className="mb-0">
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: '#212529' }}>
                        <tr style={{ border: 'none' }}>
                            <th style={{ border: 'none' }}>Event Code</th>
                            <th style={{ border: 'none' }}>Sub Event</th>
                            <th style={{ border: 'none' }}>Stage</th>
                            <th style={{ border: 'none' }}>Languages</th>
                            <th style={{ border: 'none' }}>Subject</th>
                            <th style={{ border: 'none' }}>Account</th>
                            <th style={{ border: 'none' }}>Created By</th>
                        </tr>
                    </thead>
                    <tbody>
                        {workOrders.map((workOrder, idx) => (
                            <React.Fragment key={workOrder.workOrderId}>
                                {idx > 0 && (
                                    <tr>
                                        <td colSpan={7} style={{ height: 24, border: 'none', background: 'transparent' }}></td>
                                    </tr>
                                )}
                                <tr
                                    onMouseEnter={() => setHoveredRow(workOrder.workOrderId)}
                                    onMouseLeave={() => setHoveredRow(null)}
                                    style={{ cursor: 'pointer', border: 'none' }}
                                    onClick={() => onEdit(workOrder.workOrderId)}
                                >
                                    <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.workOrderId ? '#484b50' : '#3a3d40' }}>{workOrder.eventCode}</td>
                                    <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.workOrderId ? '#484b50' : '#3a3d40' }}>{workOrder.subEvent}</td>
                                    <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.workOrderId ? '#484b50' : '#3a3d40' }}>{workOrder.stage}</td>
                                    <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.workOrderId ? '#484b50' : '#3a3d40' }}>{Object.keys(workOrder.languages || {}).join(',')}</td>
                                    <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.workOrderId ? '#484b50' : '#3a3d40' }}>{workOrder.subject}</td>
                                    <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.workOrderId ? '#484b50' : '#3a3d40' }}>{workOrder.account}</td>
                                    <td style={{ border: 'none', verticalAlign: 'middle', background: hoveredRow === workOrder.workOrderId ? '#484b50' : '#3a3d40' }}>{participantNames[workOrder.createdBy] || workOrder.createdBy}</td>
                                </tr>
                                <tr>
                                    <td colSpan={7} style={{ padding: 0, background: 'transparent', border: 'none' }}>
                                        {workOrder.steps.map((step, index) => {
                                            const isPending = !step.isActive && step.status === 'ready';
                                            const isReadyActive = step.isActive && step.status === 'ready';
                                            const isComplete = step.status === 'complete';
                                            const isInterrupted = step.status === 'interrupted';
                                            const isError = step.status === 'error';
                                            const stepTextColor = (isPending || isComplete) ? '#bbb' : '#fff';
                                            const indentColor = (isPending || isComplete) ? '#bbb' : '#fff';
                                            const badgeStyle = isPending || isComplete
                                                ? { color: '#444', background: '#ccc', border: '1px solid #bbb' }
                                                : isInterrupted
                                                    ? { color: '#fff', background: '#ff9800', border: '1px solid #ff9800' }
                                                    : isError
                                                        ? { color: '#fff', background: '#dc3545', border: '1px solid #dc3545' }
                                                        : {};
                                            const badgeBg = isReadyActive ? 'bg-primary' : isInterrupted ? '' : isError ? '' : getStatusBadgeClass(step.status, step.isActive);
                                            const messageColor = isComplete ? '#bbb' : '#fff';
                                            return (
                                                <div key={`${workOrder.workOrderId}-${step.name}`} style={{ background: '#2c3034', padding: '12px' }}>
                                                    <div className="d-flex align-items-center">
                                                        <div style={{ flex: 2 }} className="ps-5">
                                                            <div className="d-flex align-items-center">
                                                                <div className="me-2" style={{ color: isInterrupted ? '#fff' : indentColor }}>└─</div>
                                                                <div style={{ color: isInterrupted ? '#fff' : stepTextColor }}>{step.name}</div>
                                                            </div>
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <Button
                                                                variant={step.status === 'working' ? 'danger' : 'primary'}
                                                                size="sm"
                                                                onClick={e => { e.stopPropagation(); handleStepAction(workOrder.workOrderId, step.name, step.status !== 'working') }}
                                                                disabled={!(step.isActive || isError || isInterrupted)}
                                                            >
                                                                {(isInterrupted || isError) ? 'Restart' : step.status === 'working' ? 'Stop' : 'Start'}
                                                            </Button>
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <Badge bg={badgeBg} className="px-3 py-2" style={badgeStyle}>
                                                                {isPending ? 'pending' : step.status}
                                                            </Badge>
                                                        </div>
                                                        <div style={{ flex: 4, color: isInterrupted ? '#fff' : messageColor }}>
                                                            {step.message}
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </td>
                                </tr>
                            </React.Fragment>
                        ))}
                    </tbody>
                </Table>
            </div>
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