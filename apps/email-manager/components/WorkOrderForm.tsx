import React, { useEffect, useState, useRef } from 'react'
import { Form, Button, Spinner, Card } from 'react-bootstrap'
import { toast } from 'react-toastify'
import { callDbApi } from '@dharma/shared/src/clientApi'
import { FiTrash2 } from 'react-icons/fi'

interface WorkOrderFormProps {
    workOrderId?: string
    onSave: () => void
    onCancel: () => void
    userPid: string
}

export default function WorkOrderForm({ workOrderId, onSave, onCancel, userPid }: WorkOrderFormProps) {
    const [loading, setLoading] = useState(false)
    const [events, setEvents] = useState<any[]>([])
    const [eventCode, setEventCode] = useState('')
    const [subEvents, setSubEvents] = useState<string[]>([])
    const [subEvent, setSubEvent] = useState('')
    const [stageList, setStageList] = useState<string[]>([])
    const [stage, setStage] = useState('')
    const [languageList, setLanguageList] = useState<string[]>([])
    const [languages, setLanguages] = useState<{ [key: string]: boolean }>({})
    const [subject, setSubject] = useState('')
    const [accountList, setAccountList] = useState<string[]>([])
    const [account, setAccount] = useState('')
    const [optionsLoaded, setOptionsLoaded] = useState(false)
    const loadedSubEventRef = useRef<string | null>(null)

    // Fetch events and config on mount
    useEffect(() => {
        setLoading(true)
        Promise.all([
            callDbApi('getEvents', {}),
            callDbApi('getConfig', { key: 'emailAccountList' }),
            callDbApi('getConfig', { key: 'emailStageList' }),
            callDbApi('getConfig', { key: 'emailLanguageList' })
        ]).then(([eventsResp, accountResp, stageResp, langResp]) => {
            // Only show events with config.emailManager === true
            const filteredEvents = (eventsResp || []).filter((ev: any) => ev.config && ev.config.emailManager)
            setEvents(filteredEvents)
            setEventCode('') // No event selected by default
            setSubEvents([])
            setSubEvent('')
            setAccountList(accountResp?.value || [])
            setStageList(stageResp?.value || [])
            setLanguageList(langResp?.value || [])
            setAccount('')
            setStage('')
            setLanguages({})
            setOptionsLoaded(true)
        }).catch((err) => {
            toast.error('Failed to load form options')
            setOptionsLoaded(true)
        }).finally(() => setLoading(false))
    }, [])

    // Load work order if editing, but only after options are loaded
    useEffect(() => {
        if (workOrderId && optionsLoaded) {
            loadWorkOrder()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workOrderId, optionsLoaded])

    const loadWorkOrder = async () => {
        try {
            const response = await callDbApi('handleGetWorkOrder', { workOrderId: workOrderId })
            setEventCode(response.eventCode)
            loadedSubEventRef.current = response.subEvent
            setStage(response.stage)
            setSubject(response.subject)
            setAccount(response.account)
            setLanguages(response.languages || {})
        } catch (error) {
            console.error('Error loading work order:', error)
            toast.error('Failed to load work order')
        }
    }

    // Update sub-events when event changes
    useEffect(() => {
        const selectedEvent = events.find(ev => ev.aid === eventCode)
        if (selectedEvent) {
            const subEvNames = selectedEvent.subEvents ? Object.keys(selectedEvent.subEvents) : []
            setSubEvents(subEvNames)
            // Only set subEvent if loading from edit
            if (loadedSubEventRef.current && subEvNames.includes(loadedSubEventRef.current)) {
                setSubEvent(loadedSubEventRef.current)
                loadedSubEventRef.current = null
            } else if (subEvNames.length === 1) {
                setSubEvent(subEvNames[0])
            } else {
                setSubEvent('')
            }
        } else {
            setSubEvents([])
            setSubEvent('')
        }
    }, [eventCode, events])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            const workOrder = {
                eventCode,
                subEvent,
                stage,
                languages,
                subject,
                account,
                createdBy: userPid,
                steps: [
                    {
                        name: 'Prepare',
                        status: 'ready',
                        message: '',
                        isActive: true
                    },
                    {
                        name: 'Test',
                        status: 'ready',
                        message: '',
                        isActive: false
                    },
                    {
                        name: 'Send',
                        status: 'ready',
                        message: '',
                        isActive: false
                    }
                ]
            }

            if (workOrderId) {
                await callDbApi('handleUpdateWorkOrder', {
                    workOrderId: workOrderId,
                    ...workOrder
                })
                toast.success('Work order updated')
            } else {
                await callDbApi('handleCreateWorkOrder', workOrder)
                toast.success('Work order created')
            }
            onSave()
        } catch (err) {
            toast.error('Failed to save work order')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Form onSubmit={handleSubmit} className="text-light">
            <div className="d-flex justify-content-between align-items-center mb-3">
                {workOrderId && (
                    <Button
                        variant="danger"
                        onClick={async () => {
                            if (window.confirm('Are you sure you want to delete this work order?')) {
                                setLoading(true)
                                try {
                                    await callDbApi('handleDeleteWorkOrder', { workOrderId })
                                    toast.success('Work order deleted')
                                    onSave()
                                } catch (err) {
                                    toast.error('Failed to delete work order')
                                } finally {
                                    setLoading(false)
                                }
                            }
                        }}
                        style={{ borderRadius: '50%', width: 40, height: 40, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}
                        aria-label="Delete Work Order"
                        disabled={loading}
                    >
                        <FiTrash2 size={22} />
                    </Button>
                )}
                <div className="d-flex gap-2 align-items-center">
                    <Button variant="secondary" onClick={onCancel} disabled={loading}>
                        Cancel
                    </Button>
                    <Button variant="primary" type="submit" disabled={loading}>
                        {loading ? (
                            <>
                                <Spinner
                                    as="span"
                                    animation="border"
                                    size="sm"
                                    role="status"
                                    aria-hidden="true"
                                    className="me-2"
                                />
                                Saving...
                            </>
                        ) : (
                            'Save'
                        )}
                    </Button>
                </div>
            </div>
            <Form.Group className="mb-3">
                <Form.Label>Event Code</Form.Label>
                <Form.Select
                    value={eventCode}
                    onChange={e => setEventCode(e.target.value)}
                    required
                    className="bg-dark text-light border-secondary"
                >
                    <option value="" disabled>Select event</option>
                    {events.map(ev => (
                        <option key={ev.aid} value={ev.aid}>{ev.aid} - {ev.name}</option>
                    ))}
                </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Sub Event</Form.Label>
                <Form.Select
                    value={subEvent}
                    onChange={e => setSubEvent(e.target.value)}
                    required
                    disabled={subEvents.length === 1}
                    className="bg-dark text-light border-secondary"
                >
                    {subEvents.length !== 1 && <option value="" disabled>Select sub-event</option>}
                    {subEvents.map(subEv => (
                        <option key={subEv} value={subEv}>{subEv}</option>
                    ))}
                </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Stage</Form.Label>
                <Form.Select
                    value={stage}
                    onChange={e => setStage(e.target.value)}
                    required
                    className="bg-dark text-light border-secondary"
                >
                    <option value="" disabled>Select stage</option>
                    {stageList.map(st => (
                        <option key={st} value={st}>{st}</option>
                    ))}
                </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Languages</Form.Label>
                <div className="d-flex flex-wrap gap-3">
                    {languageList.map(lang => (
                        <Form.Check
                            key={lang}
                            type="checkbox"
                            id={`lang-${lang}`}
                            label={lang}
                            checked={!!languages[lang]}
                            onChange={e => setLanguages(langs => ({ ...langs, [lang]: e.target.checked }))}
                            className="bg-dark text-light border-secondary"
                        />
                    ))}
                </div>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Subject</Form.Label>
                <Form.Control
                    type="text"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    required
                    className="bg-dark text-light border-secondary"
                />
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Account</Form.Label>
                <Form.Select
                    value={account}
                    onChange={e => setAccount(e.target.value)}
                    required
                    className="bg-dark text-light border-secondary"
                >
                    <option value="" disabled>Select account</option>
                    {accountList.map(acc => (
                        <option key={acc} value={acc}>{acc}</option>
                    ))}
                </Form.Select>
            </Form.Group>
        </Form>
    )
} 